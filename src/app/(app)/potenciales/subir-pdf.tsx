"use client";

import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, CloudUpload, ExternalLink, FileText, Loader2, Pencil, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { RUBROS, type QuoteRow, type Rubro } from "@/lib/pipeline/types";
import type { DatosPdf, UsoNumero } from "@/lib/quotes/subir-pdf";
import type { BorradorAjustable } from "@/lib/quotes/refinar-core";
import { leerPdfManual, leerRevisionPdf, revisarNumeroCotizacion, subirPdfCotizacion, subirRevisionPdf } from "./dropbox-actions";
import { prepararRevision, refineQuoteDraft } from "./cotizador-actions";
import type { RevisionEnEdicion } from "./cotizador";

const input = "w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:border-slate-400 focus:outline-none disabled:bg-slate-50";
const rotulo = "text-[11px] font-semibold uppercase tracking-wider text-slate-500";
const MAX_BYTES = 5_500_000;

type Item = {
  key: string;
  nombre: string;
  tamano: number;
  base64: string;
  fase: "leyendo" | "revisar" | "subiendo" | "listo";
  datos: DatosPdf;
  usos: UsoNumero[];
  iaError: string | null;
  aviso: string | null;
  siguiente: string | null;
  error: string | null;
  resultado: { path: string | null; url: string | null; aviso: string | null } | null;
};

const vacio: DatosPdf = { quote_number: "", client_name: null, amount_usd: null, sent_date: null, description: null, rubro: null };

async function base64De(f: File): Promise<string> {
  const buf = new Uint8Array(await f.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode(...buf.subarray(i, i + 8192));
  return btoa(bin);
}

/**
 * Cotizaciones hechas a mano: el PDF va a la carpeta de cartas de Dropbox tal
 * cual y queda creada la cotización. Si el número que se ve en el PDF ya está
 * usado, se avisa — no se bloquea, porque una revisión con el mismo número es
 * legítima.
 *
 * Con `revisionDe`, el PDF es la revisión siguiente de esa cotización: mismo
 * número con la REV que toca, mismo cliente y contacto. Y en vez de subir un
 * PDF ya hecho, se puede editar ahí mismo (`onEditar`): se abre el cotizador
 * con la original y el comentario que se haya escrito ya aplicado.
 */
export function SubirPdfDialog({
  revisionDe,
  onClose,
  onCreated,
  onEditar,
}: {
  revisionDe?: QuoteRow;
  onClose: () => void;
  onCreated: (row: QuoteRow) => void;
  onEditar?: (r: RevisionEnEdicion) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [problema, setProblema] = useState<string | null>(null);
  const [comentario, setComentario] = useState("");
  const [armando, setArmando] = useState(false);
  const [errorArmar, setErrorArmar] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function editar(pdf?: { nombre: string; base64: string }) {
    if (!revisionDe || !onEditar) return;
    setArmando(true);
    setErrorArmar(null);
    const r = await prepararRevision(revisionDe.id, pdf);
    if ("error" in r) {
      setArmando(false);
      setErrorArmar(r.error);
      return;
    }
    let datos = r.data;
    let previo: BorradorAjustable | null = null;
    let resumen: string | null = null;
    let error: string | null = null;
    if (comentario.trim()) {
      const base: BorradorAjustable = {
        numero: datos.quote_number,
        cliente: datos.client_name,
        rubro: datos.rubro,
        descripcionCorta: datos.descripcion_corta,
        letter: datos.letter,
      };
      const a = await refineQuoteDraft(base, comentario.trim());
      // Sin el cambio la revisión igual se abre: el comentario se puede volver
      // a pedir desde el cotizador.
      if ("error" in a) error = `No se pudo aplicar el comentario: ${a.error}`;
      else {
        previo = base;
        resumen = a.data.resumen;
        datos = { ...datos, quote_number: a.data.numero, rubro: a.data.rubro, descripcion_corta: a.data.descripcionCorta, letter: a.data.letter };
      }
    }
    setArmando(false);
    onEditar({ datos, previo, resumen, error });
  }

  const cambiar = (key: string, patch: Partial<Item>) => setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  const cambiarDatos = (key: string, patch: Partial<DatosPdf>) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, datos: { ...it.datos, ...patch } } : it)));

  async function agregar(files: FileList | null) {
    if (!files?.length) return;
    setProblema(null);
    const malos: string[] = [];
    for (const f of Array.from(files).slice(0, revisionDe ? 1 : undefined)) {
      if (f.type !== "application/pdf" && !/\.pdf$/i.test(f.name)) {
        malos.push(`${f.name}: no es PDF`);
        continue;
      }
      if (f.size > MAX_BYTES) {
        malos.push(`${f.name}: pesa más de 5.5 MB`);
        continue;
      }
      const key = `${f.name}-${f.size}-${Date.now()}`;
      const base64 = await base64De(f);
      setItems((prev) => [
        ...prev,
        { key, nombre: f.name, tamano: f.size, base64, fase: "leyendo", datos: vacio, usos: [], iaError: null, aviso: null, siguiente: null, error: null, resultado: null },
      ]);
      const r = revisionDe ? await leerRevisionPdf(revisionDe.id, f.name, base64) : await leerPdfManual(f.name, base64);
      if ("error" in r) cambiar(key, { fase: "revisar", error: r.error });
      else
        cambiar(key, {
          fase: "revisar",
          datos: r.data.datos,
          usos: r.data.usos,
          iaError: r.data.iaError,
          aviso: r.data.aviso ?? null,
          siguiente: r.data.siguiente,
        });
    }
    if (malos.length) setProblema(malos.join(" · "));
  }

  async function revisarNumero(it: Item) {
    if (!it.datos.quote_number.trim()) return;
    const r = await revisarNumeroCotizacion(it.datos.quote_number, Boolean(revisionDe));
    if ("ok" in r) cambiar(it.key, { usos: r.data });
  }

  async function subir(it: Item) {
    cambiar(it.key, { fase: "subiendo", error: null });
    const r = revisionDe
      ? await subirRevisionPdf(revisionDe.id, it.nombre, it.base64, it.datos)
      : await subirPdfCotizacion(it.nombre, it.base64, it.datos);
    if ("error" in r) {
      cambiar(it.key, { fase: "revisar", error: r.error });
      return;
    }
    cambiar(it.key, { fase: "listo", resultado: { path: r.data.row.dropbox_path, url: r.data.row.dropbox_shared_url, aviso: r.data.aviso } });
    onCreated(r.data.row);
  }

  const listas = items.filter((it) => it.fase === "revisar" && it.datos.quote_number.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-blue-600 text-white">
              <Upload className="size-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                {revisionDe ? `Nueva revisión de ${revisionDe.quote_number}` : "Subir cotizaciones en PDF"}
              </h3>
              <p className="text-xs text-slate-500">
                {revisionDe
                  ? `Queda como la REV que sigue, para ${revisionDe.client_std_name ?? revisionDe.client_name ?? "el mismo cliente"}.`
                  : "Van a Dropbox tal cual, sin cambiarlas, y quedan creadas acá."}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100" aria-label="Cerrar">
            <X className="size-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {revisionDe && onEditar ? (
            <>
              <section className="rounded-xl border border-violet-200 bg-violet-50/50 p-3">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  <Pencil className="size-4 text-violet-600" /> Edítala acá
                </p>
                <p className="mt-0.5 text-xs text-slate-600">
                  Se abre en el cotizador con lo que tiene {revisionDe.quote_number} para cambiarla a mano o con un comentario a la IA, y
                  después la publicas a Dropbox.
                </p>
                <textarea
                  rows={2}
                  value={comentario}
                  onChange={(e) => setComentario(e.target.value)}
                  disabled={armando}
                  placeholder="¿Qué cambia en esta revisión? (opcional) Ej: bajar el renglón 2 a B/. 450"
                  className="mt-2 w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm focus:border-violet-400 focus:outline-none disabled:opacity-60"
                />
                <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                  {armando ? (
                    <span className="mr-auto text-[11px] text-slate-500">Si hay que leer un PDF con IA tarda unos segundos.</span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void editar()}
                    disabled={armando}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                  >
                    {armando ? <Loader2 className="size-4 animate-spin" /> : <Pencil className="size-4" />}
                    {armando ? "Preparando la revisión…" : "Editar y armar la revisión"}
                  </button>
                </div>
                {errorArmar ? <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{errorArmar}</p> : null}
              </section>
              <p className="text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400">o sube el PDF que ya hiciste</p>
            </>
          ) : null}
          {revisionDe && items.length > 0 ? null : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center gap-1 rounded-xl border-2 border-dashed border-slate-200 px-4 py-6 text-center hover:border-blue-300 hover:bg-blue-50/40"
            >
              <FileText className="size-6 text-blue-600" />
              <span className="text-sm font-semibold text-slate-800">{revisionDe ? "Elegir el PDF de la revisión" : "Elegir PDF"}</span>
              <span className="text-xs text-slate-500">{revisionDe ? "Hasta 5.5 MB" : "Uno o varios, hasta 5.5 MB cada uno"}</span>
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple={!revisionDe}
            className="hidden"
            onChange={(e) => {
              void agregar(e.target.files);
              e.target.value = "";
            }}
          />
          {problema ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{problema}</p> : null}

          {items.map((it) => (
            <div key={it.key} className={cn("rounded-xl border p-3", it.fase === "listo" ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200")}>
              <div className="flex items-start justify-between gap-2">
                <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-slate-900">
                  <FileText className="size-4 shrink-0 text-slate-400" />
                  <span className="truncate" title={it.nombre}>
                    {it.nombre}
                  </span>
                  <span className="shrink-0 text-[11px] font-normal text-slate-400">{(it.tamano / 1024).toFixed(0)} KB</span>
                </p>
                {it.fase !== "subiendo" && it.fase !== "listo" ? (
                  <button
                    type="button"
                    onClick={() => setItems((prev) => prev.filter((x) => x.key !== it.key))}
                    className="rounded-md p-1 text-slate-400 hover:bg-slate-100"
                    aria-label={`Quitar ${it.nombre}`}
                  >
                    <X className="size-4" />
                  </button>
                ) : null}
              </div>

              {it.fase === "leyendo" ? (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                  <Loader2 className="size-3.5 animate-spin" /> Leyendo la cotización y revisando el número…
                </p>
              ) : it.fase === "listo" && it.resultado ? (
                <div className="mt-2 space-y-1 text-xs">
                  <p className="flex items-center gap-1.5 font-semibold text-emerald-700">
                    <CheckCircle2 className="size-4" /> {it.datos.quote_number} creada y subida a Dropbox
                  </p>
                  {it.resultado.path ? <p className="truncate text-slate-500">{it.resultado.path}</p> : null}
                  {it.resultado.url ? (
                    <a href={it.resultado.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:underline">
                      <ExternalLink className="size-3.5" /> Ver el PDF en Dropbox
                    </a>
                  ) : null}
                  {it.resultado.aviso ? <p className="text-amber-700">{it.resultado.aviso}</p> : null}
                </div>
              ) : (
                <>
                  {it.iaError ? (
                    <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-600/20">
                      No se pudo leer con IA: {it.iaError} Completa los datos a mano; el PDF se sube igual.
                    </p>
                  ) : null}

                  {it.aviso ? (
                    <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-inset ring-amber-600/30">
                      <AlertTriangle className="mt-px size-3.5 shrink-0" /> {it.aviso}
                    </p>
                  ) : null}

                  {it.usos.length > 0 ? (
                    <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-inset ring-amber-600/30" role="alert">
                      <p className="flex items-center gap-1.5 font-semibold">
                        <AlertTriangle className="size-3.5 shrink-0" /> El número {it.datos.quote_number} ya está usado
                      </p>
                      <ul className="mt-1 space-y-0.5 pl-5">
                        {it.usos.map((u, i) => (
                          <li key={i} className="list-disc">
                            {u.donde === "plataforma" ? "En la plataforma" : "En Dropbox"}: <b>{u.numero}</b> — {u.detalle}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1 text-amber-800">
                        {revisionDe
                          ? `Esa revisión ya existe${it.siguiente ? ` — la que sigue es ${it.siguiente}` : ""}.`
                          : `Se puede subir igual (por ejemplo, si es una revisión). Si fue un error, corrige el número en el PDF${
                              it.siguiente ? ` — el próximo libre es ${it.siguiente}` : ""
                            }.`}
                      </p>
                    </div>
                  ) : null}

                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <label className="block">
                      <span className={rotulo}>{revisionDe ? "Número de la revisión" : "Número (como dice el PDF)"}</span>
                      <input
                        className={cn(input, !it.datos.quote_number.trim() && "border-red-300")}
                        value={it.datos.quote_number}
                        placeholder="COT DC 26-243"
                        onChange={(e) => cambiarDatos(it.key, { quote_number: e.target.value.toUpperCase() })}
                        onBlur={() => void revisarNumero(it)}
                        disabled={it.fase === "subiendo"}
                      />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className={rotulo}>{revisionDe ? "Cliente (el de la original)" : "Cliente"}</span>
                      <input
                        className={input}
                        value={it.datos.client_name ?? ""}
                        onChange={(e) => cambiarDatos(it.key, { client_name: e.target.value || null })}
                        disabled={it.fase === "subiendo" || Boolean(revisionDe)}
                      />
                    </label>
                    <label className="block">
                      <span className={rotulo}>Monto total (B/.)</span>
                      <input
                        type="number"
                        step="0.01"
                        className={cn(input, "text-right tabular-nums")}
                        value={it.datos.amount_usd ?? ""}
                        onChange={(e) => cambiarDatos(it.key, { amount_usd: e.target.value === "" ? null : Number(e.target.value) })}
                        disabled={it.fase === "subiendo"}
                      />
                    </label>
                    <label className="block">
                      <span className={rotulo}>Fecha</span>
                      <input
                        type="date"
                        className={input}
                        value={it.datos.sent_date ?? ""}
                        onChange={(e) => cambiarDatos(it.key, { sent_date: e.target.value || null })}
                        disabled={it.fase === "subiendo"}
                      />
                    </label>
                    <label className="block">
                      <span className={rotulo}>Rubro</span>
                      <select
                        className={input}
                        value={it.datos.rubro ?? ""}
                        onChange={(e) => cambiarDatos(it.key, { rubro: (e.target.value || null) as Rubro | null })}
                        disabled={it.fase === "subiendo"}
                      >
                        <option value="">—</option>
                        {(Object.keys(RUBROS) as Rubro[]).map((r) => (
                          <option key={r} value={r}>
                            {r} — {RUBROS[r].label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block sm:col-span-3">
                      <span className={rotulo}>Descripción</span>
                      <input
                        className={input}
                        value={it.datos.description ?? ""}
                        onChange={(e) => cambiarDatos(it.key, { description: e.target.value || null })}
                        disabled={it.fase === "subiendo"}
                      />
                    </label>
                  </div>

                  {!it.datos.quote_number.trim() ? (
                    <p className="mt-1.5 text-xs text-red-600">No encontré el número en el PDF: escríbelo como aparece en la cotización.</p>
                  ) : null}
                  {it.error ? <p className="mt-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{it.error}</p> : null}

                  <div className="mt-2.5 flex flex-wrap justify-end gap-2">
                    {revisionDe && onEditar ? (
                      <button
                        type="button"
                        onClick={() => void editar({ nombre: it.nombre, base64: it.base64 })}
                        disabled={it.fase === "subiendo" || armando}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-sm font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                        title="Pasar este PDF al cotizador para cambiarlo ahí, con el comentario de arriba si lo hay"
                      >
                        {armando ? <Loader2 className="size-4 animate-spin" /> : <Pencil className="size-4" />} Editar antes de subir
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void subir(it)}
                      disabled={it.fase === "subiendo" || !it.datos.quote_number.trim()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      {it.fase === "subiendo" ? <Loader2 className="size-4 animate-spin" /> : <CloudUpload className="size-4" />}
                      {it.fase === "subiendo" ? "Subiendo…" : it.usos.length > 0 ? "Subir igual a Dropbox" : "Subir a Dropbox"}
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-slate-100 px-5 py-3">
          <p className="text-[11px] text-slate-400">
            {revisionDe && onEditar
              ? "Un PDF subido va tal cual; una revisión editada acá se genera con el membrete al publicarla."
              : "El archivo no se modifica: el cliente recibe exactamente el PDF que hiciste."}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {listas.length > 1 ? (
              <button
                type="button"
                onClick={() => listas.forEach((it) => void subir(it))}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Subir todas ({listas.length})
              </button>
            ) : null}
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">
              Listo
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
