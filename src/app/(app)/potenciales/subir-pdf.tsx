"use client";

import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, CloudUpload, ExternalLink, FileText, Loader2, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { RUBROS, type QuoteRow, type Rubro } from "@/lib/pipeline/types";
import type { DatosPdf, UsoNumero } from "@/lib/quotes/subir-pdf";
import { leerPdfManual, revisarNumeroCotizacion, subirPdfCotizacion } from "./dropbox-actions";

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
 */
export function SubirPdfDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (row: QuoteRow) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [problema, setProblema] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const cambiar = (key: string, patch: Partial<Item>) => setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  const cambiarDatos = (key: string, patch: Partial<DatosPdf>) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, datos: { ...it.datos, ...patch } } : it)));

  async function agregar(files: FileList | null) {
    if (!files?.length) return;
    setProblema(null);
    const malos: string[] = [];
    for (const f of Array.from(files)) {
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
        { key, nombre: f.name, tamano: f.size, base64, fase: "leyendo", datos: vacio, usos: [], iaError: null, siguiente: null, error: null, resultado: null },
      ]);
      const r = await leerPdfManual(f.name, base64);
      if ("error" in r) cambiar(key, { fase: "revisar", error: r.error });
      else cambiar(key, { fase: "revisar", datos: r.data.datos, usos: r.data.usos, iaError: r.data.iaError, siguiente: r.data.siguiente });
    }
    if (malos.length) setProblema(malos.join(" · "));
  }

  async function revisarNumero(it: Item) {
    if (!it.datos.quote_number.trim()) return;
    const r = await revisarNumeroCotizacion(it.datos.quote_number);
    if ("ok" in r) cambiar(it.key, { usos: r.data });
  }

  async function subir(it: Item) {
    cambiar(it.key, { fase: "subiendo", error: null });
    const r = await subirPdfCotizacion(it.nombre, it.base64, it.datos);
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
              <h3 className="text-base font-semibold text-slate-900">Subir cotizaciones en PDF</h3>
              <p className="text-xs text-slate-500">Van a Dropbox tal cual, sin cambiarlas, y quedan creadas acá.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100" aria-label="Cerrar">
            <X className="size-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center gap-1 rounded-xl border-2 border-dashed border-slate-200 px-4 py-6 text-center hover:border-blue-300 hover:bg-blue-50/40"
          >
            <FileText className="size-6 text-blue-600" />
            <span className="text-sm font-semibold text-slate-800">Elegir PDF</span>
            <span className="text-xs text-slate-500">Uno o varios, hasta 5.5 MB cada uno</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
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
                      No se pudo leer con IA: {it.iaError} Completá los datos a mano; el PDF se sube igual.
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
                        Se puede subir igual (por ejemplo, si es una revisión). Si fue un error, corregí el número en el PDF
                        {it.siguiente ? ` — el próximo libre es ${it.siguiente}` : ""}.
                      </p>
                    </div>
                  ) : null}

                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <label className="block">
                      <span className={rotulo}>Número (como dice el PDF)</span>
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
                      <span className={rotulo}>Cliente</span>
                      <input
                        className={input}
                        value={it.datos.client_name ?? ""}
                        onChange={(e) => cambiarDatos(it.key, { client_name: e.target.value || null })}
                        disabled={it.fase === "subiendo"}
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
                    <p className="mt-1.5 text-xs text-red-600">No encontré el número en el PDF: escribilo como aparece en la cotización.</p>
                  ) : null}
                  {it.error ? <p className="mt-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{it.error}</p> : null}

                  <div className="mt-2.5 flex justify-end">
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
          <p className="text-[11px] text-slate-400">El archivo no se modifica: el cliente recibe exactamente el PDF que hiciste.</p>
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
