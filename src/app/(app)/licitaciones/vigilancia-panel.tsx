"use client";

import { useState, useTransition } from "react";
import { RefreshCw, TriangleAlert, Check, Clock } from "lucide-react";
import { revisarParticipadas, marcarCambioVisto } from "./vigilancia-actions";
import { cn } from "@/lib/utils";

export type Vigilada = {
  id: string;
  acto: string | null;
  objeto: string | null;
  entidad: string | null;
  cambio: string | null;
  cambiadoAt: string | null;
  revisadoAt: string | null;
  vistoAt: string | null;
};

// Hace cuánto, en palabras. Se calcula al vuelo en el cliente: es relativo al
// reloj de quien mira, y calcularlo en el servidor rompía la hidratación.
function hace(iso: string | null): string {
  if (!iso) return "nunca";
  const min = Math.max(0, Math.round((Date.now() - +new Date(iso)) / 60000));
  if (min < 2) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} día${d === 1 ? "" : "s"}`;
}

/**
 * Vigilancia de las licitaciones ya presentadas.
 *
 * Va arriba de todo y solo cuando hay algo que hacer: si nada cambió, se ve una
 * línea discreta con cuándo fue la última revisión. Un panel que grita siempre
 * deja de leerse, y este tiene que funcionar el día que sí importa.
 */
export function VigilanciaPanel({ vigiladas }: { vigiladas: Vigilada[] }) {
  const [vistosLocal, setVistosLocal] = useState<Record<string, boolean>>({});
  const filas = vigiladas.map((v) => (vistosLocal[v.id] ? { ...v, vistoAt: v.vistoAt ?? new Date().toISOString() } : v));
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [resumen, setResumen] = useState<string | null>(null);

  const conCambio = filas.filter((v) => v.cambio && !v.vistoAt);

  function revisar() {
    setError(null);
    setResumen(null);
    startTransition(async () => {
      const r = await revisarParticipadas();
      if (!r.ok) {
        setError(r.error);
        return;
      }
      if (r.revisadas === 0 && r.fallidas.length === 0) {
        setResumen("No hay licitaciones presentadas para revisar.");
        return;
      }
      const partes = [`${r.revisadas} revisada${r.revisadas === 1 ? "" : "s"}`];
      partes.push(r.conCambios > 0 ? `${r.conCambios} con novedades` : "sin novedades");
      if (r.fallidas.length > 0) partes.push(`${r.fallidas.length} no se pudo consultar`);
      setResumen(partes.join(" · "));
    });
  }

  function marcarVisto(id: string) {
    // Optimista: el acuse es un gesto de lectura, no un dato que haya que
    // esperar. Si falla se repone y se avisa.
    setVistosLocal((prev) => ({ ...prev, [id]: true }));
    startTransition(async () => {
      const r = await marcarCambioVisto(id);
      if (!r.ok) {
        setVistosLocal((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setError(r.error);
      }
    });
  }

  const ultimaRevision = filas.reduce<string | null>(
    (max, v) => (v.revisadoAt && (!max || v.revisadoAt > max) ? v.revisadoAt : max),
    null,
  );

  return (
    <section
      className={cn(
        "mb-4 rounded-card border shadow-[0_1px_2px_rgba(15,23,42,.04)]",
        conCambio.length > 0 ? "border-amber-300 bg-amber-50/60" : "border-line bg-surface",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              "flex size-[30px] shrink-0 items-center justify-center rounded-lg",
              conCambio.length > 0 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500",
            )}
          >
            {conCambio.length > 0 ? <TriangleAlert className="size-4" /> : <Clock className="size-4" />}
          </span>
          <div className="min-w-0">
            <h2 className="text-[13px] font-bold text-slate-900">
              {conCambio.length > 0
                ? `${conCambio.length} licitación${conCambio.length === 1 ? "" : "es"} con novedades en el portal`
                : "Vigilancia de participadas"}
            </h2>
            <p className="text-[11px] text-slate-600">
              {filas.length === 0
                ? "Sin licitaciones presentadas para vigilar"
                : conCambio.length > 0
                  ? "El portal se movió — revisá si piden subsanar algo"
                  : `${filas.length} en seguimiento · última revisión ${hace(ultimaRevision)}`}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={revisar}
          disabled={pendiente}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          <RefreshCw className={cn("size-3.5", pendiente && "animate-spin")} />
          {pendiente ? "Revisando…" : "Revisar en PanamaCompra"}
        </button>
      </div>

      {error ? (
        <p className="mx-5 mb-3 rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-700 ring-1 ring-inset ring-red-600/20">
          {error}
        </p>
      ) : null}
      {resumen && !error ? <p className="mx-5 mb-3 text-[11px] text-slate-600">{resumen}</p> : null}

      {conCambio.length > 0 ? (
        <ul className="border-t border-amber-200/70">
          {conCambio.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-200/50 px-5 py-3 last:border-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-slate-900" title={v.objeto ?? undefined}>
                  {v.objeto ?? v.acto ?? "Licitación"}
                </p>
                <p className="truncate text-[11px] text-slate-600">
                  {v.acto ? <span className="font-mono">{v.acto}</span> : null}
                  {v.entidad ? ` · ${v.entidad}` : ""}
                </p>
              </div>
              <p className="min-w-0 flex-1 text-[12px] font-medium text-amber-900">{v.cambio}</p>
              <span className="shrink-0 whitespace-nowrap text-[11px] text-slate-500">{hace(v.cambiadoAt)}</span>
              <button
                type="button"
                onClick={() => marcarVisto(v.id)}
                disabled={pendiente}
                title="Ya lo revisamos"
                className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50"
              >
                <Check className="size-3.5" /> Visto
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
