"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Loader2, Pencil, Printer, Trash2, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { fechaLarga, fmtBal, letterTotals, resolveTextos, type LetterData, type LetterFirma, type LetterTextos } from "@/lib/quotes/letter";
import { publishQuote } from "@/app/(app)/potenciales/cotizador-actions";
import { createSignature, deleteSignature, listSignatures, saveLetterEdits, type Signature } from "./actions";

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// Texto editable in situ. El valor se escribe al nodo SOLO cuando cambia desde
// afuera (no en cada tecla), así el cursor no salta mientras se escribe; lo que
// quedó se lee al salir del campo.
function Editable({
  value,
  onChange,
  edit,
  className,
  block,
}: {
  value: string;
  onChange: (v: string) => void;
  edit: boolean;
  className?: string;
  block?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && el.textContent !== value) el.textContent = value;
  }, [value]);

  const Tag = (block ? "div" : "span") as "div";
  // Fuera del modo edición un texto borrado no ocupa lugar (misma carta que el PDF).
  if (!edit) return value ? <Tag className={className}>{value}</Tag> : null;
  return (
    <Tag
      ref={ref as React.Ref<HTMLDivElement>}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      onBlur={(e) => onChange(e.currentTarget.textContent ?? "")}
      className={cn(
        "cursor-text rounded-sm outline-none ring-1 ring-inset ring-dashed ring-sky-300/70 hover:bg-sky-50/60 focus:bg-amber-50 focus:ring-amber-400",
        block ? "block min-h-[1.2em]" : "inline-block min-w-[2ch]",
        className,
      )}
    />
  );
}

export function CartaEditor({
  quoteId,
  quoteNumber,
  cliente,
  letter,
  firmaUrlInicial,
}: {
  quoteId: string;
  quoteNumber: string;
  cliente: string;
  letter: LetterData;
  firmaUrlInicial: string | null;
}) {
  const [edit, setEdit] = useState(false);
  const [textos, setTextos] = useState<LetterTextos>(letter.textos ?? {});
  const [firma, setFirma] = useState<LetterFirma | null>(letter.firma ?? null);
  const [firmaUrl, setFirmaUrl] = useState<string | null>(firmaUrlInicial);
  const [sucio, setSucio] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "err"; texto: string } | null>(null);
  const [pub, setPub] = useState<{ url: string | null; waText: string; aviso: string | null } | null>(null);
  const [publicando, setPublicando] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  const T = resolveTextos({ ...letter, textos }, { quoteNumber });
  const { subtotal, itbms, total } = letterTotals(letter);

  // Se compara contra el texto RESUELTO (lo que el usuario ve), no contra el
  // override: así salir de un campo sin tocarlo no ensucia la carta ni guarda un
  // override redundante igual al texto por defecto. Sin memoizar a propósito:
  // la comparación necesita el T de ESTE render.
  function setT(k: keyof LetterTextos, v: string) {
    if (T[k] === v) return;
    setTextos((prev) => ({ ...prev, [k]: v }));
    setSucio(true);
  }

  // Aviso del navegador si se sale con cambios sin guardar.
  useEffect(() => {
    if (!sucio) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [sucio]);

  async function guardar() {
    setGuardando(true);
    setMsg(null);
    try {
      const r = await saveLetterEdits(quoteId, textos, firma);
      if ("error" in r) setMsg({ tipo: "err", texto: r.error });
      else {
        setSucio(false);
        setMsg({ tipo: "ok", texto: "Cambios guardados" });
      }
    } catch (e) {
      setMsg({ tipo: "err", texto: e instanceof Error ? e.message : "No se pudo guardar" });
    } finally {
      setGuardando(false);
    }
  }

  // Publicar = generar el PDF con lo que se ve y subirlo a Dropbox. Si hay
  // cambios sin guardar se guardan ANTES, si no el PDF saldría con la versión vieja.
  async function publicar() {
    setPublicando(true);
    setMsg(null);
    try {
      if (sucio) {
        const s = await saveLetterEdits(quoteId, textos, firma);
        if ("error" in s) {
          setMsg({ tipo: "err", texto: s.error });
          return;
        }
        setSucio(false);
      }
      const r = await publishQuote(quoteId);
      if ("error" in r) setMsg({ tipo: "err", texto: r.error });
      else setPub({ url: r.data.url, waText: r.data.waText, aviso: r.data.linkWarning });
    } catch (e) {
      setMsg({ tipo: "err", texto: e instanceof Error ? e.message : "No se pudo publicar" });
    } finally {
      setPublicando(false);
    }
  }

  // ── Arrastrar / redimensionar la firma ────────────────────────────────────
  function arrastrar(e: React.PointerEvent, modo: "mover" | "escalar") {
    if (!edit || !firma) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = sheetRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const f0 = firma;
    const mover = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / rect.width;
      const dy = (ev.clientY - y0) / rect.height;
      setFirma(() =>
        modo === "mover"
          ? { ...f0, x: clamp01(f0.x + dx), y: clamp01(f0.y + dy) }
          : { ...f0, w: Math.max(0.04, Math.min(0.9, f0.w + dx)) },
      );
      setSucio(true);
    };
    const soltar = () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  }

  return (
    <>
      <style>{`
        @page { size: letter; margin: 0; }
        @media print {
          .no-print { display: none !important; }
          .sheet { box-shadow: none !important; margin: 0 !important; width: 8.5in !important; min-height: 11in !important; }
          [contenteditable] { --tw-ring-color: transparent !important; background: transparent !important; }
        }
      `}</style>

      <div className="no-print mx-auto mb-4 flex max-w-[8.5in] flex-wrap items-center justify-between gap-2">
        <Link
          href="/potenciales"
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
        >
          <ArrowLeft className="size-4" /> Cotizaciones
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setEdit((v) => !v)}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold",
              edit ? "bg-amber-500 text-white hover:bg-amber-600" : "border border-slate-200 text-slate-700 hover:bg-slate-50",
            )}
          >
            {edit ? <Check className="size-4" /> : <Pencil className="size-4" />}
            {edit ? "Listo de editar" : "Editar texto"}
          </button>
          {sucio ? (
            <button
              type="button"
              onClick={() => void guardar()}
              disabled={guardando}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {guardando ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Guardar cambios
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Printer className="size-4" /> Imprimir
          </button>
          <button
            type="button"
            onClick={() => void publicar()}
            disabled={publicando}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {publicando ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {publicando ? "Generando y subiendo…" : "Subir PDF a Dropbox"}
          </button>
        </div>
      </div>

      {msg ? (
        <div
          className={cn(
            "no-print mx-auto mb-3 max-w-[8.5in] rounded-lg px-3 py-2 text-sm ring-1 ring-inset",
            msg.tipo === "ok" ? "bg-emerald-50 text-emerald-800 ring-emerald-600/20" : "bg-red-50 text-red-700 ring-red-600/20",
          )}
        >
          {msg.texto}
        </div>
      ) : null}

      {pub ? (
        <div className="no-print mx-auto mb-3 max-w-[8.5in] rounded-xl bg-emerald-50 p-4 ring-1 ring-inset ring-emerald-600/20">
          <p className="text-sm font-semibold text-emerald-800">PDF subido a Dropbox</p>
          {pub.aviso ? <p className="mt-1 text-xs text-amber-700">{pub.aviso}</p> : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {pub.url ? (
              <>
                <a
                  href={pub.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                >
                  Abrir PDF
                </a>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard?.writeText(pub.url ?? "")}
                  className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                >
                  Copiar link
                </button>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(pub.waText)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                >
                  Enviar por WhatsApp
                </a>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {edit ? <PanelFirma firma={firma} setFirma={setFirma} setFirmaUrl={setFirmaUrl} setSucio={setSucio} /> : null}

      <div
        ref={sheetRef}
        className="sheet relative mx-auto w-[8.5in] min-h-[11in] bg-white text-[13px] leading-relaxed text-slate-900 shadow-xl"
        style={{
          backgroundImage: "url(/dicec-membrete.png)",
          backgroundSize: "100% 100%",
          backgroundRepeat: "no-repeat",
        }}
      >
        <div className="px-[1in] pb-[1.1in] pt-[1.55in]">
          <div className="text-right">{fechaLarga(letter.fecha)}</div>

          <div className="mt-6 font-semibold">
            {cliente}
            {letter.ubicacion ? (
              <>
                <br />
                <span className="font-normal">{letter.ubicacion}</span>
              </>
            ) : null}
            <br />
            <Editable value={T.saludo} onChange={(v) => setT("saludo", v)} edit={edit} className="font-normal" />
          </div>

          <div className="mt-5">
            <Editable value={T.ref_label} onChange={(v) => setT("ref_label", v)} edit={edit} className="underline" />
            {T.ref_label ? ": " : null}
            <Editable value={T.ref_texto} onChange={(v) => setT("ref_texto", v)} edit={edit} className="font-bold" />
          </div>

          <Editable value={T.intro} onChange={(v) => setT("intro", v)} edit={edit} block className="mt-4" />

          <table className="mt-4 w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b-2 border-slate-800 text-left">
                <th className="w-[0.7in] py-1.5 pr-2 font-semibold">
                  <Editable value={T.th_cant} onChange={(v) => setT("th_cant", v)} edit={edit} />
                </th>
                <th className="py-1.5 pr-2 font-semibold">
                  <Editable value={T.th_desc} onChange={(v) => setT("th_desc", v)} edit={edit} />
                </th>
                <th className="w-[1.1in] py-1.5 pr-2 text-right font-semibold">
                  <Editable value={T.th_precio} onChange={(v) => setT("th_precio", v)} edit={edit} />
                </th>
                <th className="w-[1.1in] py-1.5 text-right font-semibold">
                  <Editable value={T.th_total} onChange={(v) => setT("th_total", v)} edit={edit} />
                </th>
              </tr>
            </thead>
            <tbody>
              {letter.items.map((it, i) => (
                <tr key={i} className="border-b border-slate-200 align-top">
                  <td className="py-1.5 pr-2 tabular-nums">{it.cant}</td>
                  <td className="py-1.5 pr-2">{it.desc}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">B/. {fmtBal(it.precio)}</td>
                  <td className="py-1.5 text-right tabular-nums">B/. {fmtBal(it.cant * it.precio)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="ml-auto mt-3 w-[3.2in] text-[12.5px]">
            <div className="flex justify-between py-0.5">
              <Editable value={T.lbl_subtotal} onChange={(v) => setT("lbl_subtotal", v)} edit={edit} />
              <span className="tabular-nums">B/. {fmtBal(subtotal)}</span>
            </div>
            {letter.aplica_itbms ? (
              <div className="flex justify-between py-0.5">
                <Editable value={T.lbl_itbms} onChange={(v) => setT("lbl_itbms", v)} edit={edit} />
                <span className="tabular-nums">B/. {fmtBal(itbms)}</span>
              </div>
            ) : null}
            <div className="flex justify-between border-t-2 border-slate-800 py-1 font-semibold">
              <Editable value={T.lbl_total} onChange={(v) => setT("lbl_total", v)} edit={edit} />
              <span className="tabular-nums">B/. {fmtBal(total)}</span>
            </div>
          </div>

          <p className="mt-6">
            <Editable value={T.oferta} onChange={(v) => setT("oferta", v)} edit={edit} />{" "}
            <i className="font-semibold">B/. {fmtBal(total)}</i>
          </p>

          {T.validez_texto || letter.condiciones || edit ? (
            <div className="mt-3 space-y-1">
              <Editable value={T.validez_texto} onChange={(v) => setT("validez_texto", v)} edit={edit} block />
              {letter.condiciones
                ? letter.condiciones.split("\n").map((ln, i) => (ln.trim() ? <div key={i}>{ln}</div> : null))
                : null}
            </div>
          ) : null}

          {letter.elaborado ? (
            <div className="mt-14">
              <div className="w-[2.6in] border-t border-slate-800 pt-1">
                {letter.elaborado}
                <br />
                <Editable value={T.empresa} onChange={(v) => setT("empresa", v)} edit={edit} />
              </div>
            </div>
          ) : null}
        </div>

        {/* Firma en fracciones de la hoja — mismas coordenadas que usa el PDF. */}
        {firma && firmaUrl ? (
          <div
            className={cn("absolute", edit ? "cursor-move ring-1 ring-dashed ring-sky-400" : "pointer-events-none")}
            style={{ left: `${firma.x * 100}%`, top: `${firma.y * 100}%`, width: `${firma.w * 100}%` }}
            onPointerDown={(e) => arrastrar(e, "mover")}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={firmaUrl} alt="Firma" className="pointer-events-none w-full select-none" draggable={false} />
            {edit ? (
              <span
                onPointerDown={(e) => arrastrar(e, "escalar")}
                title="Arrastra para cambiar el tamaño"
                className="no-print absolute -bottom-1.5 -right-1.5 size-3.5 cursor-nwse-resize rounded-full bg-sky-500 ring-2 ring-white"
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}

// ── Panel de firmas: biblioteca reusable + subir nueva ──────────────────────
function PanelFirma({
  firma,
  setFirma,
  setFirmaUrl,
  setSucio,
}: {
  firma: LetterFirma | null;
  setFirma: (f: LetterFirma | null) => void;
  setFirmaUrl: (u: string | null) => void;
  setSucio: (v: boolean) => void;
}) {
  const [sigs, setSigs] = useState<Signature[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      const r = await listSignatures();
      if ("error" in r) setError(r.error);
      else setSigs(r.data);
    })();
  }, []);

  function elegir(s: Signature) {
    // Posición por defecto: sobre la línea de firma, abajo a la izquierda.
    setFirma(firma?.id === s.id ? firma : { id: s.id, x: 0.12, y: 0.72, w: 0.22 });
    setFirmaUrl(s.data_url);
    setSucio(true);
  }

  async function subir(file: File) {
    setSubiendo(true);
    setError(null);
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.onerror = () => rej(new Error("No se pudo leer el archivo"));
        fr.readAsDataURL(file);
      });
      const label = file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "Firma";
      const r = await createSignature(label, dataUrl);
      if ("error" in r) setError(r.error);
      else {
        setSigs((prev) => [...(prev ?? []), r.data]);
        elegir(r.data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo subir");
    } finally {
      setSubiendo(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function borrar(id: string) {
    const r = await deleteSignature(id);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    setSigs((prev) => (prev ?? []).filter((s) => s.id !== id));
    if (firma?.id === id) {
      setFirma(null);
      setFirmaUrl(null);
      setSucio(true);
    }
  }

  return (
    <div className="no-print mx-auto mb-3 max-w-[8.5in] rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Firma</p>
        <div className="flex items-center gap-2">
          {firma ? (
            <button
              type="button"
              onClick={() => {
                setFirma(null);
                setFirmaUrl(null);
                setSucio(true);
              }}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100"
            >
              <X className="size-3.5" /> Quitar de esta carta
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={subiendo}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {subiendo ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            Subir firma PNG
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void subir(f);
            }}
          />
        </div>
      </div>

      {error ? <p className="mt-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">{error}</p> : null}

      {sigs === null ? (
        <p className="mt-2 text-[11px] text-slate-400">Cargando firmas…</p>
      ) : sigs.length === 0 ? (
        <p className="mt-2 text-[11px] text-slate-400">
          Todavía no hay firmas guardadas. Sube un PNG (idealmente con fondo transparente) y queda disponible para todas las cotizaciones.
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {sigs.map((s) => (
            <div
              key={s.id}
              className={cn(
                "group relative rounded-lg border p-1.5",
                firma?.id === s.id ? "border-sky-400 bg-sky-50" : "border-slate-200 hover:bg-slate-50",
              )}
            >
              <button type="button" onClick={() => elegir(s)} className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.data_url} alt={s.label} className="h-10 w-auto max-w-[9rem] object-contain" />
                <span className="mt-0.5 block max-w-[9rem] truncate text-[10px] text-slate-500">{s.label}</span>
              </button>
              <button
                type="button"
                onClick={() => void borrar(s.id)}
                title="Eliminar firma de la biblioteca"
                className="absolute -right-1.5 -top-1.5 hidden rounded-full bg-white p-0.5 text-slate-400 shadow ring-1 ring-slate-200 hover:text-red-600 group-hover:block"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      {firma ? (
        <p className="mt-2 text-[11px] text-slate-400">
          Arrastra la firma sobre la carta para moverla y usa el punto azul de la esquina para cambiarle el tamaño.
        </p>
      ) : null}
    </div>
  );
}
