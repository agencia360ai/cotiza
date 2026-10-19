"use client";

import { useState } from "react";
import { ImagePlus, Loader2, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { LIMITES, type Propuesta, type PropuestaImagen } from "@/lib/quotes/propuesta";

const input =
  "w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:border-slate-400 focus:outline-none disabled:bg-slate-50";
const rotulo = "text-[11px] font-semibold uppercase tracking-wider text-slate-500";

export type ImagenDisponible = { nombre: string; base64: string; mime: "image/png" | "image/jpeg"; preview: string };

type Props = {
  value: Propuesta;
  onChange: (p: Propuesta) => void;
  // Imágenes adjuntadas al pedido que se pueden poner en el plano.
  disponibles: ImagenDisponible[];
  subirImagen: (base64: string, mime: string) => Promise<{ error: string } | { ok: true; data: { path: string; mime: "image/png" | "image/jpeg" } }>;
  // Miniatura de cada imagen subida en esta sesión, por path. Lo guardado antes
  // no trae los bytes al navegador: se ve en la vista previa del PDF.
  previews: Record<string, string>;
  onPreview: (path: string, dataUrl: string) => void;
};

/** Los campos de la Propuesta que no son renglones ni totales. */
export function PropuestaEditor({ value: p, onChange, disponibles, subirImagen, previews, onPreview }: Props) {
  const set = <K extends keyof Propuesta>(k: K, v: Propuesta[K]) => onChange({ ...p, [k]: v });
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const imagenes = p.plano?.imagenes ?? [];
  const setImagenes = (imgs: PropuestaImagen[]) =>
    set("plano", imgs.length ? { titulo: p.plano?.titulo || "Plano de aire acondicionado", fuente: p.plano?.fuente ?? null, imagenes: imgs } : null);

  async function usar(img: { nombre: string; base64: string; mime: string; preview: string }) {
    if (imagenes.length >= LIMITES.imagenes) return;
    setSubiendo(img.nombre);
    setError(null);
    const r = await subirImagen(img.base64, img.mime);
    setSubiendo(null);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    onPreview(r.data.path, img.preview);
    setImagenes([...imagenes, { path: r.data.path, mime: r.data.mime, nota: null }]);
  }

  async function desdeArchivo(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    if (f.type !== "image/png" && f.type !== "image/jpeg") {
      setError("El plano tiene que ser PNG o JPG (de un PDF, sacale una captura).");
      return;
    }
    const buf = new Uint8Array(await f.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode(...buf.subarray(i, i + 8192));
    const base64 = btoa(bin);
    await usar({ nombre: f.name, base64, mime: f.type, preview: `data:${f.type};base64,${base64}` });
  }

  const lista = <T,>(arr: T[], i: number, v: T) => arr.map((x, j) => (j === i ? v : x));

  return (
    <div className="space-y-3 rounded-xl border border-sky-200 bg-sky-50/40 p-3">
      <p className="text-xs font-bold uppercase tracking-wider text-sky-800">Propuesta · encabezado y condiciones</p>

      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block sm:col-span-2">
          <span className={rotulo}>Título grande</span>
          <input className={input} value={p.titulo} onChange={(e) => set("titulo", e.target.value)} placeholder="NAZ Beauty Shop" />
        </label>
        <label className="block">
          <span className={rotulo}>Rótulo</span>
          <input className={input} value={p.etiqueta} onChange={(e) => set("etiqueta", e.target.value)} />
        </label>
        <label className="block sm:col-span-3">
          <span className={rotulo}>Subtítulo</span>
          <input
            className={input}
            value={p.subtitulo ?? ""}
            onChange={(e) => set("subtitulo", e.target.value || null)}
            placeholder="Climatización y extracción de baños · Costa del Este"
          />
        </label>
      </div>

      <Pares
        titulo="Datos del encabezado"
        max={LIMITES.datos}
        filas={p.datos.map((d) => [d.label, d.valor])}
        placeholders={["Cliente", "NAZ & Co., S.A."]}
        anchoPrimero="w-36"
        onChange={(filas) => set("datos", filas.map(([label, valor]) => ({ label, valor })))}
      />
      <Pares
        titulo="Cifras clave"
        max={LIMITES.cifras}
        filas={p.cifras.map((c) => [c.valor, c.texto])}
        placeholders={["18 TR", "Autocontenida 15 TR + 3 splits de 1 TR"]}
        anchoPrimero="w-28"
        onChange={(filas) => set("cifras", filas.map(([valor, texto]) => ({ valor, texto })))}
      />

      <div className="grid gap-2 sm:grid-cols-4">
        <label className="block">
          <span className={rotulo}>Rótulo del precio</span>
          <input className={input} value={p.inversion} onChange={(e) => set("inversion", e.target.value)} />
        </label>
        <label className="block">
          <span className={rotulo}>Plazo · rótulo</span>
          <input
            className={input}
            value={p.plazo?.label ?? ""}
            placeholder="Instalación"
            onChange={(e) => set("plazo", { label: e.target.value, valor: p.plazo?.valor ?? "", detalle: p.plazo?.detalle ?? null })}
          />
        </label>
        <label className="block">
          <span className={rotulo}>Plazo</span>
          <input
            className={input}
            value={p.plazo?.valor ?? ""}
            placeholder="12 días hábiles"
            onChange={(e) =>
              set("plazo", e.target.value || p.plazo?.detalle ? { label: p.plazo?.label || "Instalación", valor: e.target.value, detalle: p.plazo?.detalle ?? null } : null)
            }
          />
        </label>
        <label className="block">
          <span className={rotulo}>Plazo · detalle</span>
          <input
            className={input}
            value={p.plazo?.detalle ?? ""}
            placeholder="Equipos en sitio: 3–4 semanas"
            onChange={(e) => set("plazo", { label: p.plazo?.label || "Instalación", valor: p.plazo?.valor ?? "", detalle: e.target.value || null })}
          />
        </label>
      </div>

      <label className="block">
        <span className={rotulo}>Encabezado de la tabla de partidas</span>
        <input className={input} value={p.partidas_titulo} onChange={(e) => set("partidas_titulo", e.target.value)} />
      </label>

      <Pares
        titulo="Condiciones"
        max={LIMITES.condiciones}
        filas={p.condiciones.map((c) => [c.label, c.texto])}
        placeholders={["Pago", "50% con la orden de compra · 50% contra entrega."]}
        anchoPrimero="w-28"
        largo
        onChange={(filas) => set("condiciones", filas.map(([label, texto]) => ({ label, texto })))}
      />
      <p className="-mt-2 text-[11px] text-slate-500">La vigencia sale de &quot;Validez (días)&quot; si no la escribís acá.</p>

      <label className="block">
        <span className={rotulo}>Contacto (al pie)</span>
        <input
          className={input}
          value={p.contacto ?? ""}
          onChange={(e) => set("contacto", e.target.value || null)}
          placeholder="Nombre · correo · WhatsApp"
        />
      </label>

      <div className="rounded-lg border border-slate-200 bg-white p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={rotulo}>Plano en la primera página (hasta {LIMITES.imagenes} imágenes)</span>
          {imagenes.length < LIMITES.imagenes ? (
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-50">
              <ImagePlus className="size-3.5" /> Subir imagen
              <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => desdeArchivo(e.target.files)} />
            </label>
          ) : null}
        </div>
        {imagenes.length > 0 ? (
          <>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className={rotulo}>Título del plano</span>
                <input
                  className={input}
                  value={p.plano?.titulo ?? ""}
                  onChange={(e) => p.plano && set("plano", { ...p.plano, titulo: e.target.value })}
                />
              </label>
              <label className="block">
                <span className={rotulo}>Fuente</span>
                <input
                  className={input}
                  value={p.plano?.fuente ?? ""}
                  placeholder="Planos AA · FLT Estudio · oct 2026"
                  onChange={(e) => p.plano && set("plano", { ...p.plano, fuente: e.target.value || null })}
                />
              </label>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {imagenes.map((im, i) => (
                <div key={im.path} className="flex items-start gap-2 rounded-lg border border-slate-200 p-1.5">
                  {previews[im.path] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={previews[im.path]} alt="" className="size-14 shrink-0 rounded object-contain" />
                  ) : (
                    <div className="flex size-14 shrink-0 items-center justify-center rounded bg-slate-100 text-[10px] text-slate-400">guardada</div>
                  )}
                  <input
                    className={cn(input, "text-xs")}
                    value={im.nota ?? ""}
                    placeholder="Nota debajo (opcional)"
                    onChange={(e) => setImagenes(lista(imagenes, i, { ...im, nota: e.target.value || null }))}
                  />
                  <button
                    type="button"
                    onClick={() => setImagenes(imagenes.filter((_, j) => j !== i))}
                    className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"
                    aria-label="Quitar imagen"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="mt-1 text-[11px] text-slate-500">Sin plano, el alcance y el precio empiezan en la primera hoja.</p>
        )}
        {disponibles.length > 0 && imagenes.length < LIMITES.imagenes ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {disponibles.map((d) => (
              <button
                key={d.nombre + d.base64.length}
                type="button"
                disabled={!!subiendo}
                onClick={() => usar(d)}
                className="flex items-center gap-1.5 rounded-lg border border-dashed border-sky-300 px-2 py-1 text-xs text-sky-800 hover:bg-sky-50 disabled:opacity-50"
                title={d.nombre}
              >
                {subiendo === d.nombre ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={d.preview} alt="" className="size-6 rounded object-cover" />
                )}
                Usar «{d.nombre.length > 28 ? `${d.nombre.slice(0, 26)}…` : d.nombre}»
              </button>
            ))}
          </div>
        ) : null}
        {error ? <p className="mt-1.5 text-xs text-red-600">{error}</p> : null}
      </div>
    </div>
  );
}

// Lista de pares editables (rótulo + valor), con agregar y quitar.
function Pares({
  titulo,
  max,
  filas,
  placeholders,
  anchoPrimero,
  largo,
  onChange,
}: {
  titulo: string;
  max: number;
  filas: [string, string][];
  placeholders: [string, string];
  anchoPrimero: string;
  largo?: boolean;
  onChange: (filas: [string, string][]) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className={rotulo}>
          {titulo} <span className="font-normal normal-case text-slate-400">· hasta {max}</span>
        </span>
        {filas.length < max ? (
          <button
            type="button"
            onClick={() => onChange([...filas, ["", ""]])}
            className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold text-sky-700 hover:bg-sky-50"
          >
            <Plus className="size-3.5" /> Agregar
          </button>
        ) : null}
      </div>
      <div className="mt-1 space-y-1.5">
        {filas.map(([a, b], i) => (
          <div key={i} className="flex items-start gap-1.5">
            <input
              className={cn(input, anchoPrimero, "shrink-0")}
              value={a}
              placeholder={placeholders[0]}
              onChange={(e) => onChange(filas.map((f, j) => (j === i ? [e.target.value, f[1]] : f)))}
            />
            {largo ? (
              <textarea
                rows={1}
                className={cn(input, "resize-y")}
                value={b}
                placeholder={placeholders[1]}
                onChange={(e) => onChange(filas.map((f, j) => (j === i ? [f[0], e.target.value] : f)))}
              />
            ) : (
              <input
                className={input}
                value={b}
                placeholder={placeholders[1]}
                onChange={(e) => onChange(filas.map((f, j) => (j === i ? [f[0], e.target.value] : f)))}
              />
            )}
            <button
              type="button"
              onClick={() => onChange(filas.filter((_, j) => j !== i))}
              className="mt-1 rounded-md p-1 text-slate-300 hover:bg-red-50 hover:text-red-500"
              aria-label="Quitar"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
        {filas.length === 0 ? <p className="text-[11px] text-slate-400">Ninguno.</p> : null}
      </div>
    </div>
  );
}
