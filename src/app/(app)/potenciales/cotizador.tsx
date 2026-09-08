"use client";

import { useMemo, useState } from "react";
import { useEffect, useRef } from "react";
import {
  X,
  Loader2,
  Sparkles,
  Plus,
  Trash2,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  CloudUpload,
  MessageCircle,
  Mail,
  AlertTriangle,
  Mic,
  Camera,
  Paperclip,
  FileText,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { letterTotals, fmtBal, type LetterData, type LetterItem } from "@/lib/quotes/letter";
import {
  generateQuoteDraft,
  refineQuoteDraft,
  saveGeneratedQuote,
  updateGeneratedQuote,
  publishQuote,
  type CotizadorDraft,
  type SaveCotizacionInput,
  type QuoteLetterBundle,
} from "./cotizador-actions";
import type { QuoteImage, QuoteAdjunto } from "@/lib/ai/generate-quote";
import type { PublishOut } from "@/lib/quotes/store";
import type { BorradorAjustable, AjusteAplicado } from "@/lib/quotes/refinar-core";
import type { QuoteRow } from "@/lib/pipeline/types";
import { RUBROS, type Rubro } from "@/lib/pipeline/types";

type ApiResult<T> = { error: string } | { ok: true; data: T };
export type CotizadorApi = {
  generate: (brief: string, adjuntos?: QuoteAdjunto[]) => Promise<ApiResult<CotizadorDraft>>;
  refine: (actual: BorradorAjustable, instruccion: string, adjuntos?: QuoteAdjunto[]) => Promise<ApiResult<AjusteAplicado>>;
  save: (input: SaveCotizacionInput) => Promise<ApiResult<QuoteRow>>;
  publish: (quoteId: string) => Promise<ApiResult<PublishOut>>;
  update?: (quoteId: string, input: SaveCotizacionInput) => Promise<ApiResult<QuoteRow>>;
};

const APP_API: CotizadorApi = {
  generate: generateQuoteDraft,
  refine: refineQuoteDraft,
  save: saveGeneratedQuote,
  publish: publishQuote,
  update: updateGeneratedQuote,
};

// Foto → JPEG achicado (máx 1600px) para mandarlo a la IA sin pasarse del body.
async function downscaleImage(file: File, maxDim = 1600): Promise<{ img: QuoteImage; preview: string }> {
  const url = URL.createObjectURL(file);
  try {
    const el = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(el.width, el.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(el.width * scale));
    canvas.height = Math.max(1, Math.round(el.height * scale));
    canvas.getContext("2d")!.drawImage(el, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    return { img: { data: dataUrl.split(",")[1], mime: "image/jpeg" }, preview: dataUrl };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Un adjunto listo para mandar, más lo que la UI necesita para mostrarlo.
type Adjunto = { a: QuoteAdjunto; preview: string | null; bytes: number };

const MAX_ADJUNTOS = 5;
// El límite del server action es 8 MB y base64 infla ~33%, así que el tope de
// bytes reales tiene que quedar bien por debajo o el envío falla sin mensaje.
const MAX_BYTES = 5_000_000;

// Los que Claude lee como texto plano tal cual vienen.
const TEXTO = /^(text\/|application\/(json|csv))/i;

function base64De(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  // De a pedazos: `String.fromCharCode(...bytes)` con un PDF de megas revienta
  // el stack por cantidad de argumentos.
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(bin);
}

async function leerAdjunto(file: File): Promise<Adjunto> {
  if (file.type.startsWith("image/")) {
    const { img, preview } = await downscaleImage(file);
    // El peso que importa es el del JPEG achicado, no el del original.
    return { a: { kind: "image", name: file.name, data: img.data, mime: img.mime }, preview, bytes: img.data.length * 0.75 };
  }
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    const data = base64De(await file.arrayBuffer());
    return { a: { kind: "pdf", name: file.name, data }, preview: null, bytes: file.size };
  }
  if (TEXTO.test(file.type) || /\.(txt|csv|md|json)$/i.test(file.name)) {
    const text = await file.text();
    return { a: { kind: "text", name: file.name, text }, preview: null, bytes: file.size };
  }
  // Word y Excel se convierten a texto ACÁ, en el navegador: un .docx de 5 MB
  // se vuelve ~20 KB antes de salir, así que no gasta el límite del envío.
  if (/\.docx$/i.test(file.name)) {
    const { docxATexto } = await import("@/lib/office/texto");
    const text = await docxATexto(await file.arrayBuffer());
    if (!text.trim()) throw new Error("el documento no tiene texto");
    return { a: { kind: "text", name: file.name, text }, preview: null, bytes: text.length };
  }
  if (/\.xlsx$/i.test(file.name)) {
    const { xlsxATexto } = await import("@/lib/office/texto");
    const text = await xlsxATexto(await file.arrayBuffer());
    if (!text.trim()) throw new Error("la planilla no tiene datos");
    return { a: { kind: "text", name: file.name, text }, preview: null, bytes: text.length };
  }
  // .doc y .xls viejos son binarios propietarios, no ZIP: no hay nada que
  // desempaquetar. Se dice cuál es la salida en vez de "formato no soportado".
  if (/\.(doc|xls|ppt)$/i.test(file.name)) {
    throw new Error("formato viejo — guardalo como .docx/.xlsx o PDF");
  }
  throw new Error("formato no soportado (imagen, PDF, Word, Excel o texto)");
}

// Dictado por voz. Vive suelto porque lo usan el brief y el ajuste, y montar
// dos reconocedores a la vez hace que se pisen los resultados.
function useDictado(onTexto: (t: string) => void) {
  const [escuchando, setEscuchando] = useState(false);
  const [soportado, setSoportado] = useState(true);
  const ref = useRef<{ start: () => void; stop: () => void } | null>(null);
  const cb = useRef(onTexto);
  // En un efecto, no en el render: el reconocedor se monta una sola vez y
  // necesita el callback de AHORA, pero escribir un ref durante el render es
  // un efecto secundario y React lo marca como tal.
  useEffect(() => {
    cb.current = onTexto;
  });

  useEffect(() => {
    type SR = new () => {
      continuous: boolean;
      interimResults: boolean;
      lang: string;
      onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal?: boolean; 0: { transcript: string } }> }) => void) | null;
      onend: (() => void) | null;
      onerror: ((e: unknown) => void) | null;
      start: () => void;
      stop: () => void;
    };
    const win = window as unknown as { SpeechRecognition?: SR; webkitSpeechRecognition?: SR };
    const Ctor = win.SpeechRecognition ?? win.webkitSpeechRecognition;
    if (!Ctor) {
      setSoportado(false);
      return;
    }
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = "es-PA";
    rec.onresult = (e) => {
      let chunk = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i] as { isFinal?: boolean; 0: { transcript: string } };
        if (r.isFinal === false) continue;
        chunk += r[0].transcript;
      }
      if (chunk) cb.current(chunk.trim());
    };
    rec.onend = () => setEscuchando(false);
    rec.onerror = () => setEscuchando(false);
    ref.current = rec;
    return () => {
      try {
        rec.stop();
      } catch {}
    };
  }, []);

  return {
    soportado,
    escuchando,
    alternar: () => {
      const rec = ref.current;
      if (!rec) return;
      if (escuchando) rec.stop();
      else {
        rec.start();
        setEscuchando(true);
      }
    },
  };
}

const EJEMPLOS_AJUSTE = [
  "Separá el mantenimiento mensual de los add-ons de una sola vez",
  "Pasalo a rubro DC y ajustá la descripción corta",
  "Subí todos los precios 8% y redondeá a múltiplos de 5",
  "Donde dice Precio poné Tarifa mensual",
];

/**
 * Ajustar el borrador hablándole en castellano, antes de guardar.
 *
 * Está arriba del formulario y no abajo porque es la forma RÁPIDA de cambiar
 * cosas: mover seis renglones a mano es lo que se hace cuando el pedido es muy
 * puntual, no lo primero que uno intenta.
 */
function AjustarConIA({
  pendiente,
  resumen,
  hayDeshacer,
  onDeshacer,
  onAjustar,
}: {
  pendiente: boolean;
  resumen: string | null;
  hayDeshacer: boolean;
  onDeshacer: () => void;
  onAjustar: (instruccion: string, adjuntos: QuoteAdjunto[]) => Promise<boolean>;
}) {
  const [texto, setTexto] = useState("");
  const [archivos, setArchivos] = useState<Adjunto[]>([]);
  const [problema, setProblema] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const voz = useDictado((t) => setTexto((p) => (p ? p + " " : "") + t));

  async function sumar(files: FileList | null) {
    if (!files?.length) return;
    setProblema(null);
    const nuevos: Adjunto[] = [];
    const malos: string[] = [];
    for (const f of Array.from(files).slice(0, MAX_ADJUNTOS - archivos.length)) {
      try {
        nuevos.push(await leerAdjunto(f));
      } catch (e) {
        malos.push(`${f.name}: ${e instanceof Error ? e.message : "no se pudo leer"}`);
      }
    }
    if ([...archivos, ...nuevos].reduce((a, x) => a + x.bytes, 0) > MAX_BYTES) {
      setProblema(`Los archivos pasan los ${MAX_BYTES / 1e6} MB`);
      return;
    }
    if (nuevos.length) setArchivos((p) => [...p, ...nuevos]);
    if (malos.length) setProblema(malos.join(" · "));
  }

  async function enviar() {
    if (!texto.trim() && archivos.length === 0) return;
    const ok = await onAjustar(texto.trim(), archivos.map((a) => a.a));
    // Solo se limpia si funcionó: tras un error el pedido sigue ahí para
    // corregirlo, en vez de obligar a reescribirlo entero.
    if (ok) {
      setTexto("");
      setArchivos([]);
    }
  }

  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-violet-800">
          <Sparkles className="size-3.5" /> Ajustar con IA
        </span>
        {hayDeshacer ? (
          <button
            type="button"
            onClick={onDeshacer}
            disabled={pendiente}
            className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-white disabled:opacity-50"
          >
            <Undo2 className="size-3.5" /> Deshacer
          </button>
        ) : null}
      </div>

      <textarea
        rows={2}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          // Enter manda; Shift+Enter hace salto. Es un pedido corto, no un
          // documento: pedir un clic para cada ajuste corta el ida y vuelta.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void enviar();
          }
        }}
        disabled={pendiente}
        placeholder={`Decí qué cambiar. Ej: "${EJEMPLOS_AJUSTE[0]}"`}
        className="w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm focus:border-violet-400 focus:outline-none disabled:opacity-60"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {voz.soportado ? (
          <button
            type="button"
            onClick={voz.alternar}
            disabled={pendiente}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors",
              voz.escuchando ? "bg-red-500 text-white ring-4 ring-red-500/20" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
            )}
          >
            <Mic className="size-3.5" />
            {voz.escuchando ? "Escuchando…" : "Voz"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={pendiente || archivos.length >= MAX_ADJUNTOS}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <Paperclip className="size-3.5" /> Foto o archivo
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,application/pdf,.pdf,.docx,.xlsx,text/plain,.txt,.csv,.md,.json"
          className="hidden"
          onChange={(e) => {
            void sumar(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => void enviar()}
          disabled={pendiente || (!texto.trim() && archivos.length === 0)}
          className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {pendiente ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          {pendiente ? "Ajustando…" : "Ajustar"}
        </button>
      </div>

      {archivos.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {archivos.map((ad, i) => (
            <li key={`${ad.a.name}-${i}`} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1">
              <FileText className="size-3 text-slate-400" />
              <span className="max-w-[140px] truncate text-[11px] text-slate-700">{ad.a.name}</span>
              <button
                type="button"
                onClick={() => setArchivos((p) => p.filter((_, j) => j !== i))}
                aria-label={`Quitar ${ad.a.name}`}
                className="cursor-pointer text-slate-400 hover:text-slate-700"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {problema ? <p className="mt-2 text-[11px] text-red-600">{problema}</p> : null}

      {resumen ? (
        <p className="mt-2 rounded-lg bg-white px-2.5 py-1.5 text-[11px] text-slate-600 ring-1 ring-inset ring-violet-200">
          <span className="font-semibold text-violet-700">Se ajustó:</span> {resumen}
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {EJEMPLOS_AJUSTE.slice(1).map((ej) => (
            <button
              key={ej}
              type="button"
              onClick={() => setTexto(ej)}
              disabled={pendiente}
              className="cursor-pointer rounded-full bg-white px-2 py-1 text-[10px] text-slate-500 ring-1 ring-inset ring-slate-200 hover:text-slate-800 disabled:opacity-50"
            >
              {ej}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none disabled:bg-slate-50";

const EXAMPLE =
  "Ej: Reemplazo de compresor Copeland 5HP para el cuarto frío de Esa Flaca Rica – David, incluye mano de obra y materiales, 2,850 más ITBMS, validez 15 días. Elaborado por J. Guerra.";

type Phase = "brief" | "generating" | "review" | "saving" | "done";

export function CotizadorDialog({
  onClose,
  onCreated,
  onUpdated,
  api = APP_API,
  embedded = false,
  initial,
}: {
  onClose: () => void;
  onCreated: (row: QuoteRow) => void;
  onUpdated?: (row: QuoteRow) => void;
  api?: CotizadorApi;
  embedded?: boolean;
  // Editar un borrador existente: arranca en review con la carta cargada.
  initial?: QuoteLetterBundle;
}) {
  const [phase, setPhase] = useState<Phase>(initial ? "review" : "brief");
  const [brief, setBrief] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Campos editables del review
  const [numero, setNumero] = useState("");
  const [cliente, setCliente] = useState("");
  const [clienteExistente, setClienteExistente] = useState<string | null>(null);
  const [rubro, setRubro] = useState<Rubro>("DS");
  const [descCorta, setDescCorta] = useState("");
  const [letter, setLetter] = useState<LetterData>({
    fecha: new Date().toISOString().slice(0, 10),
    ubicacion: null,
    tipo: "realizar",
    items: [],
    aplica_itbms: true,
    tasa: 7,
    validez: 30,
    condiciones: null,
    elaborado: null,
  });
  const [savedRow, setSavedRow] = useState<QuoteRow | null>(null);
  const [adjuntos, setAdjuntos] = useState<Adjunto[]>([]);
  // Ajuste con IA sobre el borrador en pantalla. El historial es lo que hace
  // que probar sea barato: si el ajuste sale mal se vuelve atrás sin perder
  // nada, así que se puede pedir un cambio arriesgado sin miedo.
  const [ajustando, setAjustando] = useState(false);
  const [ultimoAjuste, setUltimoAjuste] = useState<string | null>(null);
  const [historial, setHistorial] = useState<BorradorAjustable[]>([]);
  const voz = useDictado((t) => setBrief((prev) => (prev ? prev + " " : "") + t));
  const fotoRef = useRef<HTMLInputElement | null>(null);
  const archivoRef = useRef<HTMLInputElement | null>(null);

  // Sembrar desde un borrador existente (modo edición).
  useEffect(() => {
    if (!initial) return;
    setNumero(initial.quote_number);
    setCliente(initial.client_name);
    setClienteExistente(initial.client_std_name);
    setRubro(initial.rubro);
    setDescCorta(initial.descripcion_corta);
    setLetter(initial.letter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function agregarArchivos(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    const nuevos: Adjunto[] = [];
    const problemas: string[] = [];
    for (const file of Array.from(files)) {
      if (adjuntos.length + nuevos.length >= MAX_ADJUNTOS) {
        problemas.push(`no entran más de ${MAX_ADJUNTOS} archivos`);
        break;
      }
      try {
        nuevos.push(await leerAdjunto(file));
      } catch (e) {
        problemas.push(`${file.name}: ${e instanceof Error ? e.message : "no se pudo leer"}`);
      }
    }
    // El peso se controla sobre el TOTAL, no por archivo: tres PDF de 2 MB
    // pasan uno por uno y revientan el límite del server action juntos.
    const total = [...adjuntos, ...nuevos].reduce((a, x) => a + x.bytes, 0);
    if (total > MAX_BYTES) {
      setError(`Los archivos suman ${(total / 1e6).toFixed(1)} MB y el máximo es ${MAX_BYTES / 1e6} MB. Quitá alguno.`);
      return;
    }
    if (nuevos.length) setAdjuntos((prev) => [...prev, ...nuevos]);
    if (problemas.length) setError(problemas.join(" · "));
  }

  function quitarAdjunto(i: number) {
    setAdjuntos((prev) => prev.filter((_, j) => j !== i));
  }
  const [pub, setPub] = useState<{ state: "idle" | "working" | "ok"; result: PublishOut | null; error: string | null }>({
    state: "idle",
    result: null,
    error: null,
  });

  const totals = useMemo(() => letterTotals(letter), [letter]);

  function setL<K extends keyof LetterData>(k: K, v: LetterData[K]) {
    setLetter((prev) => ({ ...prev, [k]: v }));
  }
  function setItem(i: number, patch: Partial<LetterItem>) {
    setLetter((prev) => ({ ...prev, items: prev.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));
  }

  async function generar() {
    setPhase("generating");
    setError(null);
    const r = await api.generate(brief, adjuntos.map((a) => a.a));
    if ("error" in r) {
      setError(r.error);
      setPhase("brief");
      return;
    }
    const g = r.data.generated;
    setNumero(r.data.suggestedNumber);
    setCliente(r.data.matchedClientName ?? g.client_name);
    setClienteExistente(r.data.matchedClientName);
    setRubro(g.rubro);
    setDescCorta(g.descripcion_corta);
    setLetter({
      fecha: new Date().toISOString().slice(0, 10),
      ubicacion: g.ubicacion,
      tipo: g.tipo,
      items: g.items.map((it) => ({ cant: it.cant, desc: it.desc, precio: it.precio })),
      aplica_itbms: g.aplica_itbms,
      tasa: 7,
      validez: g.validez_dias ?? 30,
      condiciones: g.condiciones,
      elaborado: letter.elaborado,
    });
    setPhase("review");
  }

  function borradorActual(): BorradorAjustable {
    return { numero, cliente, rubro, descripcionCorta: descCorta, letter };
  }

  function aplicar(b: BorradorAjustable) {
    setNumero(b.numero);
    setCliente(b.cliente);
    setRubro(b.rubro);
    setDescCorta(b.descripcionCorta);
    setLetter(b.letter);
  }

  async function ajustarConIA(instruccion: string, extra: QuoteAdjunto[]) {
    setAjustando(true);
    setError(null);
    const previo = borradorActual();
    const r = await api.refine(previo, instruccion, extra);
    setAjustando(false);
    if ("error" in r) {
      setError(r.error);
      return false;
    }
    setHistorial((h) => [...h, previo]);
    aplicar(r.data);
    setUltimoAjuste(r.data.resumen);
    return true;
  }

  function deshacer() {
    setHistorial((h) => {
      const previo = h[h.length - 1];
      if (previo) {
        aplicar(previo);
        setUltimoAjuste(null);
      }
      return h.slice(0, -1);
    });
  }

  async function guardar() {
    setPhase("saving");
    setError(null);
    const payload = {
      quote_number: numero,
      client_name: cliente,
      rubro,
      descripcion_corta: descCorta,
      letter,
    };
    const r = initial && api.update ? await api.update(initial.id, payload) : await api.save(payload);
    if ("error" in r) {
      setError(r.error);
      setPhase("review");
      return;
    }
    if (initial) onUpdated?.(r.data);
    else onCreated(r.data);
    setSavedRow(r.data);
    setPhase("done");
  }

  async function publicar() {
    if (!savedRow) return;
    setPub({ state: "working", result: null, error: null });
    const r = await api.publish(savedRow.id);
    if ("error" in r) {
      setPub({ state: "idle", result: null, error: r.error });
      return;
    }
    setPub({ state: "ok", result: r.data, error: null });
    const updated: QuoteRow = { ...savedRow, status: "enviada", dropbox_shared_url: r.data.url, dropbox_path: r.data.path };
    setSavedRow(updated);
    onUpdated?.(updated);
  }

  const card = (
      <div
        className={cn(
          "flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white",
          embedded ? "border border-slate-200 shadow-sm" : "max-h-[90vh] shadow-2xl",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-blue-600 text-white">
              <Sparkles className="size-4" />
            </div>
            <h3 className="text-base font-semibold text-slate-900">Cotizador IA</h3>
          </div>
          {!embedded ? (
            <button
              type="button"
              onClick={onClose}
              className="flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
              aria-label="Cerrar"
            >
              <X className="size-5" />
            </button>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {phase === "brief" || phase === "generating" ? (
            <div>
              <p className="text-sm text-slate-600">
                Describe el trabajo en una línea — la IA arma la cotización completa en el formato de DICEC: cliente,
                renglones, precios, ITBMS y condiciones. Después la revisas y ajustas antes de guardar.
              </p>
              <textarea
                rows={4}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder={EXAMPLE}
                className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:border-violet-400 focus:outline-none"
                disabled={phase === "generating"}
              />

              {/* Voz + foto — cotizar on the go */}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {voz.soportado ? (
                  <button
                    type="button"
                    onClick={voz.alternar}
                    disabled={phase === "generating"}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors",
                      voz.escuchando
                        ? "bg-red-500 text-white ring-4 ring-red-500/20"
                        : "border border-slate-200 text-slate-700 hover:bg-slate-50",
                    )}
                  >
                    <Mic className="size-4" />
                    {voz.escuchando ? "Escuchando… toca para parar" : "Dictar por voz"}
                  </button>
                ) : null}
                {/* La cámara va aparte del selector de archivos: en el celular
                    `capture` abre la cámara directo, que es lo que quiere el
                    técnico parado frente al equipo. Mezclarlo con "adjuntar"
                    obligaría a elegir entre cámara y galería cada vez. */}
                <button
                  type="button"
                  onClick={() => fotoRef.current?.click()}
                  disabled={phase === "generating" || adjuntos.length >= MAX_ADJUNTOS}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <Camera className="size-4" />
                  Foto (notas, placa, equipo)
                </button>
                <input
                  ref={fotoRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    void agregarArchivos(e.target.files);
                    e.target.value = ""; // permite volver a elegir el mismo archivo
                  }}
                />
                <button
                  type="button"
                  onClick={() => archivoRef.current?.click()}
                  disabled={phase === "generating" || adjuntos.length >= MAX_ADJUNTOS}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <Paperclip className="size-4" />
                  Adjuntar archivos
                </button>
                <input
                  ref={archivoRef}
                  type="file"
                  multiple
                  accept="image/*,application/pdf,.pdf,.docx,.xlsx,text/plain,.txt,.csv,.md,.json"
                  className="hidden"
                  onChange={(e) => {
                    void agregarArchivos(e.target.files);
                    e.target.value = "";
                  }}
                />
                {adjuntos.length > 0 ? (
                  <span className="text-[11px] text-slate-400">
                    {adjuntos.length} de {MAX_ADJUNTOS}
                  </span>
                ) : null}
              </div>

              {adjuntos.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {adjuntos.map((ad, i) => (
                    <li
                      key={`${ad.a.name}-${i}`}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 py-1 pl-1 pr-2"
                    >
                      {ad.preview ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={ad.preview} alt="" className="size-8 rounded object-cover ring-1 ring-slate-200" />
                      ) : (
                        <span className="flex size-8 items-center justify-center rounded bg-white text-slate-400 ring-1 ring-slate-200">
                          <FileText className="size-4" />
                        </span>
                      )}
                      <span className="max-w-[160px] truncate text-[11px] font-medium text-slate-700" title={ad.a.name}>
                        {ad.a.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => quitarAdjunto(i)}
                        aria-label={`Quitar ${ad.a.name}`}
                        className="cursor-pointer rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                      >
                        <X className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              {error ? <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
              <button
                type="button"
                onClick={generar}
                disabled={phase === "generating" || (!brief.trim() && adjuntos.length === 0)}
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {phase === "generating" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {phase === "generating" ? "Generando…" : "Generar con IA"}
              </button>
            </div>
          ) : phase === "done" ? (
            <div className="py-6 text-center">
              <CheckCircle2 className="mx-auto size-10 text-emerald-500" />
              <p className="mt-3 text-sm font-semibold text-slate-900">
                Cotización {numero} guardada {savedRow?.status === "borrador" ? "como borrador" : ""}
              </p>

              {pub.state === "ok" && pub.result ? (
                <div className="mx-auto mt-4 max-w-md">
                  <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                    PDF subido a Dropbox: <b>{pub.result.fileName}</b>
                  </p>
                  {pub.result.linkWarning ? (
                    <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-left text-xs text-amber-700 ring-1 ring-inset ring-amber-600/20">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      {pub.result.linkWarning}
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                    {pub.result.url ? (
                      <>
                        <a
                          href={`https://wa.me/?text=${encodeURIComponent(pub.result.waText)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                        >
                          <MessageCircle className="size-4" /> WhatsApp
                        </a>
                        <a
                          href={`mailto:?subject=${encodeURIComponent(`Cotización ${numero} - ${cliente}`)}&body=${encodeURIComponent(pub.result.waText)}`}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                        >
                          <Mail className="size-4" /> Email
                        </a>
                        <a
                          href={pub.result.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          <ExternalLink className="size-4" /> Ver PDF
                        </a>
                      </>
                    ) : null}
                    <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">
                      Listo
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mx-auto mt-2 max-w-md">
                  <p className="text-xs text-slate-500">
                    Publicá para generar el PDF con membrete y subirlo a la carpeta de cartas en Dropbox.
                  </p>
                  {pub.error ? <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{pub.error}</p> : null}
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={publicar}
                      disabled={pub.state === "working"}
                      className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      {pub.state === "working" ? <Loader2 className="size-4 animate-spin" /> : <CloudUpload className="size-4" />}
                      {pub.state === "working" ? "Generando PDF y subiendo…" : "Publicar PDF a Dropbox"}
                    </button>
                    {!embedded && savedRow ? (
                      <a
                        href={`/carta/${savedRow.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <ExternalLink className="size-4" /> Ver carta
                      </a>
                    ) : null}
                    <button
                      type="button"
                      onClick={onClose}
                      disabled={pub.state === "working"}
                      className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                    >
                      Dejar como borrador
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <AjustarConIA
                pendiente={ajustando}
                resumen={ultimoAjuste}
                hayDeshacer={historial.length > 0}
                onDeshacer={deshacer}
                onAjustar={ajustarConIA}
              />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <label className="col-span-1 block">
                  <span className="text-xs font-semibold text-slate-500">Número</span>
                  <input className={inputCls} value={numero} onChange={(e) => setNumero(e.target.value)} />
                </label>
                <label className="col-span-1 block">
                  <span className="text-xs font-semibold text-slate-500">Fecha</span>
                  <input type="date" className={inputCls} value={letter.fecha} onChange={(e) => setL("fecha", e.target.value)} />
                </label>
                <label className="col-span-1 block">
                  <span className="text-xs font-semibold text-slate-500">Rubro</span>
                  <select className={inputCls} value={rubro} onChange={(e) => setRubro(e.target.value as Rubro)}>
                    {(Object.keys(RUBROS) as Rubro[]).map((r) => (
                      <option key={r} value={r}>
                        {r} — {RUBROS[r].label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="col-span-1 block">
                  <span className="text-xs font-semibold text-slate-500">Tipo</span>
                  <select
                    className={inputCls}
                    value={letter.tipo}
                    onChange={(e) => setL("tipo", e.target.value as LetterData["tipo"])}
                  >
                    <option value="realizar">Trabajos a realizar</option>
                    <option value="realizados">Trabajos realizados</option>
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-semibold text-slate-500">
                    Cliente{" "}
                    {clienteExistente ? (
                      <span className="font-medium text-emerald-600">· existente ✓</span>
                    ) : (
                      <span className="font-medium text-amber-600">· nuevo (texto libre)</span>
                    )}
                  </span>
                  <input className={inputCls} value={cliente} onChange={(e) => setCliente(e.target.value)} />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-500">Ubicación (encabezado)</span>
                  <input
                    className={inputCls}
                    value={letter.ubicacion ?? ""}
                    onChange={(e) => setL("ubicacion", e.target.value || null)}
                  />
                </label>
              </div>

              {/* Renglones */}
              <div className="rounded-xl border border-slate-200">
                <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Renglones</span>
                  <button
                    type="button"
                    onClick={() => setLetter((p) => ({ ...p, items: [...p.items, { cant: 1, desc: "", precio: 0 }] }))}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-50"
                  >
                    <Plus className="size-3.5" /> Agregar
                  </button>
                </div>
                <div className="divide-y divide-slate-50">
                  {letter.items.map((it, i) => (
                    <div key={i} className="flex items-start gap-2 px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        className={cn(inputCls, "w-16 shrink-0 text-center")}
                        value={it.cant}
                        onChange={(e) => setItem(i, { cant: Number(e.target.value) })}
                        title="Cantidad"
                      />
                      <textarea
                        rows={2}
                        className={cn(inputCls, "flex-1 resize-y")}
                        value={it.desc}
                        onChange={(e) => setItem(i, { desc: e.target.value })}
                        placeholder="Descripción del renglón"
                      />
                      <div className="w-28 shrink-0">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className={cn(inputCls, "text-right")}
                          value={it.precio}
                          onChange={(e) => setItem(i, { precio: Number(e.target.value) })}
                          title="Precio unitario (sin ITBMS)"
                        />
                        <p className="mt-0.5 text-right text-[10px] tabular-nums text-slate-400">
                          = B/. {fmtBal((Number(it.cant) || 0) * (Number(it.precio) || 0))}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setLetter((p) => ({ ...p, items: p.items.filter((_, j) => j !== i) }))}
                        className="mt-1 shrink-0 rounded-md p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500"
                        title="Quitar renglón"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  ))}
                  {letter.items.length === 0 ? (
                    <p className="px-3 py-4 text-center text-xs text-slate-400">Sin renglones — agrega al menos uno.</p>
                  ) : null}
                </div>
                <div className="border-t border-slate-100 px-3 py-2 text-right text-sm">
                  <span className="mr-4 text-xs text-slate-500">
                    Subtotal <b className="tabular-nums text-slate-800">B/. {fmtBal(totals.subtotal)}</b>
                  </span>
                  {letter.aplica_itbms ? (
                    <span className="mr-4 text-xs text-slate-500">
                      ITBMS {letter.tasa}% <b className="tabular-nums text-slate-800">B/. {fmtBal(totals.itbms)}</b>
                    </span>
                  ) : null}
                  <span className="text-sm font-semibold text-slate-900">
                    Total <span className="tabular-nums">B/. {fmtBal(totals.total)}</span>
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <label className="flex items-center gap-2 pt-4 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={letter.aplica_itbms}
                    onChange={(e) => setL("aplica_itbms", e.target.checked)}
                  />
                  ITBMS {letter.tasa}%
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-500">Validez (días)</span>
                  <input
                    type="number"
                    min={0}
                    className={inputCls}
                    value={letter.validez ?? ""}
                    onChange={(e) => setL("validez", e.target.value === "" ? null : Number(e.target.value))}
                  />
                </label>
                <label className="col-span-2 block">
                  <span className="text-xs font-semibold text-slate-500">Elaborado por (firma)</span>
                  <input
                    className={inputCls}
                    value={letter.elaborado ?? ""}
                    onChange={(e) => setL("elaborado", e.target.value || null)}
                    placeholder="Nombre que firma la carta"
                  />
                </label>
              </div>

              <label className="block">
                <span className="text-xs font-semibold text-slate-500">Condiciones (una por línea)</span>
                <textarea
                  rows={2}
                  className={inputCls}
                  value={letter.condiciones ?? ""}
                  onChange={(e) => setL("condiciones", e.target.value || null)}
                  placeholder="Anticipo del 50% para iniciar.&#10;Tiempo de entrega: 15 días hábiles."
                />
              </label>

              <label className="block">
                <span className="text-xs font-semibold text-slate-500">Descripción corta (para el dashboard)</span>
                <input className={inputCls} value={descCorta} onChange={(e) => setDescCorta(e.target.value)} />
              </label>

              {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
            </div>
          )}
        </div>

        {phase === "review" || phase === "saving" ? (
          <footer className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
            {!initial ? (
              <button
                type="button"
                onClick={() => setPhase("brief")}
                disabled={phase === "saving"}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                <ArrowLeft className="size-4" /> Volver
              </button>
            ) : (
              <span className="text-xs text-slate-400">Editando borrador — al guardar sigue como borrador hasta publicar.</span>
            )}
            <div className="flex items-center gap-3">
              {!initial ? (
                <span className="hidden text-[11px] text-slate-400 sm:block">
                  Queda como borrador — cualquier admin puede terminarla y publicarla.
                </span>
              ) : null}
              <button
                type="button"
                onClick={guardar}
                disabled={phase === "saving" || letter.items.length === 0 || !numero.trim() || !cliente.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {phase === "saving" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                {initial ? "Guardar cambios" : "Guardar borrador"}
              </button>
            </div>
          </footer>
        ) : null}
      </div>
  );

  if (embedded) return card;
  // Sin cierre al clickear afuera: solo la X (evita perder una cotización a medias).
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">{card}</div>;
}
