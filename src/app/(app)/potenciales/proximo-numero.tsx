"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Hash, Loader2, RefreshCw } from "lucide-react";
import { correlativo } from "@/lib/quotes/numeracion";
import { getProximoNumero } from "./dropbox-actions";
import type { EstadoNumeracion } from "@/lib/quotes/store";

/**
 * El número que le toca a la próxima cotización, sacado de la carpeta de
 * cartas en Dropbox. Se pide aparte de la página: leer la carpeta tarda, y la
 * lista de cotizaciones no tiene por qué esperarlo.
 */
export function ProximoNumero({ version = 0 }: { version?: number }) {
  const [estado, setEstado] = useState<EstadoNumeracion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [copiado, setCopiado] = useState(false);

  function aplicar(r: Awaited<ReturnType<typeof getProximoNumero>>) {
    setCargando(false);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    setError(null);
    setEstado(r.data);
  }

  // `version` cambia cuando se crea o se sube una cotización: el número que
  // estaba en pantalla ya se usó.
  useEffect(() => {
    let vivo = true;
    void getProximoNumero().then((r) => vivo && aplicar(r));
    return () => {
      vivo = false;
    };
  }, [version]);

  async function cargar() {
    setCargando(true);
    aplicar(await getProximoNumero());
  }

  function copiar() {
    if (!estado) return;
    void navigator.clipboard.writeText(estado.siguiente).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    });
  }

  const yy = estado?.siguiente.match(/\s(\d{2})-/)?.[1] ?? "";
  const nDropbox = estado?.ultimoDropbox ? correlativo(estado.ultimoDropbox.numero, yy) : null;
  const nBase = estado?.ultimoBase ? correlativo(estado.ultimoBase.numero, yy) : null;
  // La base va adelante de Dropbox: hay un número tomado por un borrador que
  // todavía no se publicó. Sin decirlo, el salto parece un error.
  const borradorAdelante = nBase !== null && (nDropbox === null || nBase > nDropbox) ? estado?.ultimoBase : null;

  const detalle = !estado
    ? null
    : !estado.dropboxLeido
      ? "No se pudo leer la carpeta de Dropbox: calculado con la plataforma"
      : [
          estado.ultimoDropbox ? `Último en Dropbox: ${estado.ultimoDropbox.archivo}` : "La carpeta del año en Dropbox está vacía",
          borradorAdelante ? `${borradorAdelante.numero} ya está tomado en la plataforma (${borradorAdelante.cliente ?? "sin cliente"})` : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <div className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-slate-200 bg-white py-1 pl-2.5 pr-1 text-sm" title={detalle ?? undefined}>
      <Hash className="size-4 shrink-0 text-blue-600" />
      <div className="min-w-0 leading-tight">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Próximo número</p>
        {cargando && !estado ? (
          <p className="flex items-center gap-1 text-xs text-slate-400">
            <Loader2 className="size-3 animate-spin" /> Leyendo Dropbox…
          </p>
        ) : error ? (
          <p className="text-xs text-red-600">{error}</p>
        ) : estado ? (
          <p className="font-semibold tabular-nums text-slate-900">{estado.siguiente}</p>
        ) : null}
        {detalle ? <p className="max-w-[260px] truncate text-[11px] text-slate-500">{detalle}</p> : null}
      </div>
      {estado ? (
        <button
          type="button"
          onClick={copiar}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label="Copiar el próximo número"
          title="Copiar"
        >
          {copiado ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
        </button>
      ) : null}
      <button
        type="button"
        onClick={cargar}
        disabled={cargando}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
        aria-label="Volver a leer Dropbox"
        title="Volver a leer Dropbox"
      >
        <RefreshCw className={cargando ? "size-3.5 animate-spin" : "size-3.5"} />
      </button>
    </div>
  );
}
