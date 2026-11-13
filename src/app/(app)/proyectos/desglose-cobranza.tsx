"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { bal, balCompact } from "./formato";

// El detalle de la tarjeta de cobranza: de dónde sale cada número.
//
// Se arma con lo mismo que suma la tarjeta (los proyectos de la vista, en el
// rango), así que los totales de acá y los de la tarjeta son, por
// construcción, iguales. Sin consultas nuevas: abrirlo es instantáneo.

export type FilaCobranza = {
  id: string;
  nombre: string;
  cliente: string;
  /** Pagado de las facturas normales del rango, con ITBMS. */
  cobrado: number;
  /** Saldo de esas facturas, con ITBMS. */
  porCobrar: number;
  /** Anticipos: lo pagado de cada factura EST/P26 del proyecto. */
  anticipos: { numero: string; monto: number }[];
};

type Pestana = "cobrado" | "porcobrar";

export function DesgloseCobranza({
  filas,
  rango,
  inicial,
  onElegir,
  onCerrar,
}: {
  filas: FilaCobranza[];
  rango: string;
  inicial: Pestana;
  /** Tocar un proyecto lo busca en la tabla. */
  onElegir: (f: FilaCobranza) => void;
  onCerrar: () => void;
}) {
  const [pestana, setPestana] = useState<Pestana>(inicial);
  const panel = useRef<HTMLDivElement | null>(null);
  // En un ref: si el efecto dependiera de la función, cada render del tablero
  // lo reharía y le robaría el foco a lo que se esté tocando adentro.
  const cerrar = useRef(onCerrar);
  useEffect(() => {
    cerrar.current = onCerrar;
  });

  useEffect(() => {
    panel.current?.focus();
    const esc = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") cerrar.current();
    };
    document.addEventListener("keydown", esc);
    // La página de atrás no se mueve mientras está abierto.
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", esc);
      document.body.style.overflow = antes;
    };
  }, []);

  const pagadas = filas.filter((f) => f.cobrado > 0.5).sort((a, b) => b.cobrado - a.cobrado);
  const anticipos = filas
    .flatMap((f) => f.anticipos.map((a) => ({ ...a, fila: f })))
    .filter((a) => a.monto > 0.5)
    .sort((a, b) => b.monto - a.monto);
  const conSaldo = filas.filter((f) => f.porCobrar > 0.5).sort((a, b) => b.porCobrar - a.porCobrar);
  const totPagadas = pagadas.reduce((s, f) => s + f.cobrado, 0);
  const totAnticipos = anticipos.reduce((s, a) => s + a.monto, 0);
  const totSaldo = conSaldo.reduce((s, f) => s + f.porCobrar, 0);
  const cobrado = totPagadas + totAnticipos;

  // En el <body> y no donde se lo llama: el contenido de la página es su propia
  // capa, y desde ahí el encabezado del celular quedaba por encima del panel.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-6" onMouseDown={onCerrar}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="desglose-cobranza-titulo"
        tabIndex={-1}
        onMouseDown={(ev) => ev.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl outline-none sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 id="desglose-cobranza-titulo" className="text-base font-semibold text-slate-900">
              Cobranza <span className="font-normal text-slate-400">· {rango}</span>
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Pagos registrados en QuickBooks, con ITBMS. Toca un proyecto para verlo en la tabla.
            </p>
          </div>
          <button type="button" onClick={onCerrar} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Cerrar">
            <X className="size-4" />
          </button>
        </div>

        {/* La misma cuenta de la tarjeta, arriba de todo. */}
        <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100 bg-slate-50/60 text-center">
          <Cifra titulo="Cobrado" valor={cobrado} clase="text-emerald-700" />
          <Cifra titulo="Por cobrar" valor={totSaldo} clase="text-amber-700" />
          <Cifra titulo="Total con ITBMS" valor={cobrado + totSaldo} clase="text-slate-900" />
        </div>

        <div className="flex gap-1 border-b border-slate-100 px-5 pt-3" role="tablist">
          {(
            [
              ["cobrado", `Cobrado · ${pagadas.length + anticipos.length}`],
              ["porcobrar", `Por cobrar · ${conSaldo.length}`],
            ] as const
          ).map(([k, nombre]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={pestana === k}
              onClick={() => setPestana(k)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-xs font-semibold transition-colors",
                pestana === k ? "border-slate-900 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-700",
              )}
            >
              {nombre}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {pestana === "cobrado" ? (
            <>
              <Seccion titulo="Facturas pagadas" total={totPagadas} detalle={`${pagadas.length} proyecto${pagadas.length === 1 ? "" : "s"}`}>
                {pagadas.map((f) => (
                  <Fila key={f.id} f={f} monto={f.cobrado} max={pagadas[0]?.cobrado ?? 1} color="bg-emerald-500" onElegir={onElegir} />
                ))}
              </Seccion>
              {anticipos.length > 0 ? (
                <Seccion
                  titulo="Anticipos (EST y P26)"
                  total={totAnticipos}
                  detalle={`${anticipos.length} factura${anticipos.length === 1 ? "" : "s"}`}
                >
                  {anticipos.map((a) => (
                    <Fila
                      key={`${a.fila.id}-${a.numero}`}
                      f={a.fila}
                      etiqueta={a.numero}
                      monto={a.monto}
                      max={anticipos[0]?.monto ?? 1}
                      color="bg-emerald-300"
                      onElegir={onElegir}
                    />
                  ))}
                </Seccion>
              ) : null}
            </>
          ) : (
            <Seccion titulo="Facturas sin pagar" total={totSaldo} detalle={`${conSaldo.length} proyecto${conSaldo.length === 1 ? "" : "s"}`}>
              {conSaldo.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-400">Nada por cobrar en esta vista.</p>
              ) : (
                conSaldo.map((f) => (
                  <Fila
                    key={f.id}
                    f={f}
                    monto={f.porCobrar}
                    max={conSaldo[0]?.porCobrar ?? 1}
                    color="bg-amber-400"
                    nota={f.cobrado > 0.5 ? `${Math.round((f.cobrado / (f.cobrado + f.porCobrar)) * 100)}% cobrado` : "nada cobrado"}
                    onElegir={onElegir}
                  />
                ))
              )}
            </Seccion>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Cifra({ titulo, valor, clase }: { titulo: string; valor: number; clase: string }) {
  return (
    <div className="min-w-0 px-2 py-3 sm:px-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.09em] text-slate-500">{titulo}</p>
      <p className={cn("mt-0.5 whitespace-nowrap text-[15px] font-bold tabular-nums sm:text-xl", clase)}>{bal(valor)}</p>
    </div>
  );
}

function Seccion({ titulo, total, detalle, children }: { titulo: string; total: number; detalle: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 last:mb-0">
      <div className="mb-2 flex items-baseline justify-between gap-3 border-b border-slate-100 pb-1.5">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.09em] text-slate-500">
          {titulo} <span className="font-medium normal-case tracking-normal text-slate-400">· {detalle}</span>
        </h3>
        <span className="text-sm font-semibold tabular-nums text-slate-900">{bal(total)}</span>
      </div>
      <ul className="space-y-0.5">{children}</ul>
    </section>
  );
}

function Fila({
  f,
  monto,
  max,
  color,
  etiqueta,
  nota,
  onElegir,
}: {
  f: FilaCobranza;
  monto: number;
  max: number;
  color: string;
  etiqueta?: string;
  nota?: string;
  onElegir: (f: FilaCobranza) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onElegir(f)}
        className="group grid w-full grid-cols-[1fr_auto] items-center gap-x-3 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50"
      >
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium text-slate-800 group-hover:text-slate-950">
            {etiqueta ? <span className="mr-1.5 font-semibold text-slate-500">{etiqueta}</span> : null}
            {f.nombre}
          </span>
          <span className="mt-1 flex items-center gap-2">
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-slate-100">
              <span className={cn("block h-full rounded-full", color)} style={{ width: `${Math.max(2, (monto / max) * 100)}%` }} />
            </span>
            <span className="w-28 shrink-0 truncate text-[11px] text-slate-400">{nota ?? f.cliente}</span>
          </span>
        </span>
        <span className="text-[13px] font-semibold tabular-nums text-slate-900" title={bal(monto)}>
          {balCompact(monto)}
        </span>
      </button>
    </li>
  );
}
