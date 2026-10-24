"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { QboProject } from "@/lib/quickbooks/projects";
import { gastoConHoras } from "@/lib/quickbooks/horas-core";
import {
  esCosto,
  gastoPorMes,
  nombreDeCuenta,
  totalDe,
  TITULO_SECCION,
  type DesgloseProyecto,
  type MesGasto,
  type SeccionDesglose,
  type SerieGasto,
} from "@/lib/quickbooks/desglose-core";
import { getDesgloseProyecto } from "./qbo-actions";
import { bal, balCompact, fmtCorta, fmtHoras, marginTextColor, MESES_CORTOS } from "./formato";

// Cada categoría de costo tiene su color en la lista de cuentas Y en la
// gráfica: así se lee qué barra es qué sin ir a la leyenda. Paleta categórica
// validada (slots 1-3); el aqua queda bajo 3:1 sobre blanco, por eso la gráfica
// va siempre con leyenda y montos, y las cuentas al lado hacen de tabla.
const COLOR: Record<SerieGasto, string> = {
  costo_venta: "#2a78d6",
  contable: "#2a78d6",
  gasto: "#eb6834",
  horas: "#1baf7a",
};
const NOMBRE_SERIE: Record<SerieGasto, string> = {
  costo_venta: "Costo de venta",
  contable: "Gasto contable",
  gasto: "Gastos",
  horas: "Horas de técnicos",
};

const NEGATIVO =
  "Monto negativo en una cuenta de costo: QuickBooks acreditó algo ahí (suele ser el ITBMS de una factura). No es un costo chico, es un asiento a revisar con contabilidad.";

/**
 * El resumen del proyecto que se abre al tocarlo: lo mismo que la pantalla del
 * proyecto en QuickBooks —ingresos menos costos, cuenta por cuenta, más las
 * horas de técnicos— y cómo se fue gastando mes a mes.
 */
export function ResumenProyecto({ p, rangeActive }: { p: QboProject; rangeActive: boolean }) {
  const [desglose, setDesglose] = useState<DesgloseProyecto | null>(null);
  const [cargando, setCargando] = useState(true);
  const [trayendo, setTrayendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sinGuardar, setSinGuardar] = useState(false);

  useEffect(() => {
    let vivo = true;
    void getDesgloseProyecto(p.id).then((r) => {
      if (!vivo) return;
      setCargando(false);
      if (!r.ok) setError(r.error);
      else setDesglose(r.desglose);
    });
    return () => {
      vivo = false;
    };
  }, [p.id]);

  async function traer() {
    setTrayendo(true);
    setError(null);
    const r = await getDesgloseProyecto(p.id, true);
    setTrayendo(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setDesglose(r.desglose);
    setSinGuardar(!r.guardable);
  }

  const ingreso = p.income ?? 0;
  const costos = gastoConHoras(p.cost, p.horas) ?? 0;
  const ganancia = ingreso - costos;
  const meses = gastoPorMes(desglose, p.horas, p.meses);
  const secciones = desglose?.secciones ?? [];
  const ingresos = secciones.filter((s) => !esCosto(s.tipo));
  const costosContables = secciones.filter((s) => esCosto(s.tipo));
  // Para la barrita de cada cuenta: qué parte del costo total se llevó.
  const baseBarras = Math.max(1, costos);
  // El desglose cubre una ventana (desde enero del año pasado) y se lee en su
  // propio momento; los totales de arriba son del último Actualizar (o
  // congelados, si está cerrado). Si no cuadran, se dice en vez de esconderlo.
  const difiere =
    desglose !== null &&
    (Math.abs(totalDe(desglose, (t) => !esCosto(t)) - ingreso) > 1 || Math.abs(totalDe(desglose, esCosto) - (p.cost ?? 0)) > 1);

  return (
    <div role="region" aria-label={`Resumen de ${p.name}`} className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
      <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-stretch gap-1.5 sm:gap-3">
        <Cifra titulo="Facturado" valor={ingreso} clase="text-emerald-700" />
        <Operador signo="−" />
        <Cifra titulo="Costos" valor={costos} clase="text-slate-900" />
        <Operador signo="=" />
        <Cifra
          titulo="Ganancia"
          valor={ganancia}
          clase={ganancia < 0 ? "text-rose-600" : "text-slate-900"}
          extra={p.margin !== null ? <span className={cn("font-semibold", marginTextColor(p.margin))}>{Math.round(p.margin * 100)}% margen</span> : null}
        />
      </div>

      {rangeActive ? (
        <p className="text-[11px] text-slate-400">Este resumen es del proyecto completo, no del rango de fechas elegido.</p>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(0,1.5fr)]">
        <Columna titulo="Ingresos" total={desglose ? totalDe(desglose, (t) => !esCosto(t)) : ingreso}>
          {cargando ? (
            <Cargando />
          ) : ingresos.length > 0 ? (
            // Con una sola sección su título repetiría el de la columna.
            ingresos.map((s) => <Seccion key={s.tipo} s={s} sinTitulo={ingresos.length === 1} />)
          ) : (
            <Vacio texto={desglose ? "Sin ingresos en QuickBooks." : "Sin desglose por cuenta todavía."} />
          )}
        </Columna>

        <Columna titulo="Costos" total={costos}>
          {cargando ? (
            <Cargando />
          ) : (
            <>
              {costosContables.map((s) => (
                <Seccion key={s.tipo} s={s} color={s.tipo === "costo_venta" ? COLOR.costo_venta : COLOR.gasto} base={baseBarras} />
              ))}
              {!desglose && (p.cost ?? 0) !== 0 ? (
                <ul>
                  <Fila nombre="Gasto contable (sin desglose)" monto={p.cost ?? 0} color={COLOR.contable} base={baseBarras} />
                </ul>
              ) : null}
              <div>
                <TituloSeccion titulo="Horas de técnicos" total={p.horas?.costo ?? 0} />
                {p.horas && p.horas.tecnicos.length > 0 ? (
                  <ul className="space-y-1.5">
                    {p.horas.tecnicos.map((t) => (
                      <Fila
                        key={t.nombre}
                        nombre={t.nombre}
                        detalle={`${fmtHoras(t.horas)} h`}
                        monto={t.costo}
                        color={COLOR.horas}
                        base={baseBarras}
                      />
                    ))}
                  </ul>
                ) : (
                  <Vacio texto="Sin horas cargadas en QuickBooks." />
                )}
                {p.horas && p.horas.sinTarifa > 0 ? (
                  <p className="mt-1 text-[11px] text-amber-700">
                    {fmtHoras(p.horas.sinTarifa)} h cargadas sin tarifa de costo: no suman (tampoco en QuickBooks).
                  </p>
                ) : null}
              </div>
            </>
          )}
        </Columna>

        <div className="min-w-0 rounded-lg bg-slate-50/70 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Cómo se fue el gasto</p>
          {cargando ? <Cargando /> : <GastoPorMes data={meses} />}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-slate-100 pt-2.5 text-[11px] text-slate-500">
        {desglose ? (
          <span>
            Desglose de QuickBooks desde {fmtCorta(desglose.desde)} · traído {fmtCorta(desglose.actualizado.slice(0, 10))}
            {difiere ? " · no cuadra exacto con los totales de arriba: son de otra lectura de QuickBooks o de otro período" : ""}
          </span>
        ) : !cargando ? (
          <span>Todavía no hay desglose por cuenta de este proyecto: se arma al tocar Actualizar, o traelo ahora.</span>
        ) : null}
        {sinGuardar ? <span className="text-amber-700">Falta correr la migración 0052 para que quede guardado.</span> : null}
        {error ? <span className="text-rose-600">{error}</span> : null}
        {!cargando ? (
          <button
            type="button"
            onClick={() => void traer()}
            disabled={trayendo}
            className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {trayendo ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            {trayendo ? "Pidiendo a QuickBooks…" : desglose ? "Actualizar desglose" : "Traer de QuickBooks"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Cifra({ titulo, valor, clase, extra }: { titulo: string; valor: number; clase: string; extra?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-100 bg-slate-50/60 px-2 py-2 text-center sm:px-3">
      <p className={cn("truncate text-sm font-bold tabular-nums sm:text-xl", clase)} title={bal(valor)}>
        {bal(valor)}
      </p>
      <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{titulo}</p>
      {extra ? <p className="mt-0.5 text-[11px]">{extra}</p> : null}
    </div>
  );
}

function Operador({ signo }: { signo: string }) {
  return (
    <span aria-hidden className="flex items-center justify-center text-base font-bold text-slate-300 sm:text-xl">
      {signo}
    </span>
  );
}

function Columna({ titulo, total, children }: { titulo: string; total: number; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex items-baseline justify-between gap-2 border-b border-slate-100 pb-1.5">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{titulo}</p>
        <p className="text-sm font-semibold tabular-nums text-slate-900">{bal(total)}</p>
      </div>
      {children}
    </div>
  );
}

function TituloSeccion({ titulo, total }: { titulo: string; total: number }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <p className="text-xs font-semibold text-slate-700">{titulo}</p>
      <p className="text-xs font-semibold tabular-nums text-slate-700">{bal(total)}</p>
    </div>
  );
}

function Seccion({ s, color, base, sinTitulo }: { s: SeccionDesglose; color?: string; base?: number; sinTitulo?: boolean }) {
  return (
    <div>
      {sinTitulo ? null : <TituloSeccion titulo={TITULO_SECCION[s.tipo]} total={s.total} />}
      <ul className="space-y-1.5">
        {s.cuentas.map((c) => (
          <Fila key={c.nombre} nombre={nombreDeCuenta(c.nombre)} monto={c.total} color={color} base={base} negativoEsRaro={esCosto(s.tipo)} />
        ))}
      </ul>
    </div>
  );
}

function Fila({
  nombre,
  detalle,
  monto,
  color,
  base,
  negativoEsRaro = true,
}: {
  nombre: string;
  detalle?: string;
  monto: number;
  color?: string;
  base?: number;
  negativoEsRaro?: boolean;
}) {
  const raro = negativoEsRaro && monto < 0;
  return (
    <li className="text-xs">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-slate-600" title={nombre}>
          {nombre}
          {detalle ? <span className="text-slate-400"> · {detalle}</span> : null}
        </span>
        <span className={cn("shrink-0 tabular-nums", raro ? "font-semibold text-amber-700" : "text-slate-800")} title={raro ? NEGATIVO : undefined}>
          {raro ? <AlertTriangle className="mr-0.5 inline size-3 align-[-1px]" /> : null}
          {bal(monto)}
        </span>
      </div>
      {color && base && monto > 0 ? (
        <div className="mt-1 h-1 rounded-full bg-slate-100">
          <div className="h-1 rounded-full" style={{ width: `${Math.min(100, (monto / base) * 100)}%`, background: color }} />
        </div>
      ) : null}
    </li>
  );
}

function Cargando() {
  return (
    <p className="flex items-center gap-1.5 py-2 text-xs text-slate-400">
      <Loader2 className="size-3.5 animate-spin" /> Cargando…
    </p>
  );
}

function Vacio({ texto }: { texto: string }) {
  return <p className="text-xs text-slate-400">{texto}</p>;
}

// ── Gasto por mes, apilado por categoría ─────────────────────────────────────
// Barras apiladas porque la pregunta es "cuánto se gastó cada mes y en qué":
// el alto es el total del mes y los tramos lo reparten. Mismas specs que las
// gráficas del tablero: SVG puro, grid recesivo, tope redondeado anclado a la
// base, 2px de separación entre tramos y tooltip por mes.
function GastoPorMes({ data }: { data: MesGasto[] }) {
  const [hoverIdx, setHover] = useState<number | null>(null);
  // Un filtro puede achicar la serie con el mouse encima: el índice viejo ya
  // no existe y leerlo rompía la pantalla entera.
  const hover = hoverIdx !== null && hoverIdx < data.length ? hoverIdx : null;
  if (data.length === 0) return <p className="py-6 text-center text-xs text-slate-400">Sin gasto registrado por mes.</p>;

  const series: SerieGasto[] = (["costo_venta", "contable", "gasto", "horas"] as SerieGasto[]).filter((k) => data.some((d) => d[k] > 0));
  const totalMes = (d: MesGasto) => series.reduce((a, k) => a + Math.max(0, d[k]), 0);
  const W = 420;
  const H = 150;
  const PAD_X = 6;
  const PAD_B = 20;
  const PAD_T = 18;
  const max = Math.max(1, ...data.map(totalMes));
  const slot = (W - PAD_X * 2) / data.length;
  const barW = Math.max(6, Math.min(30, slot * 0.6));
  const y = (v: number) => H - PAD_B - (v / max) * (H - PAD_B - PAD_T);
  const maxIdx = data.reduce((mi, d, i) => (totalMes(d) > totalMes(data[mi]) ? i : mi), 0);
  const totales = Object.fromEntries(series.map((k) => [k, data.reduce((a, d) => a + d[k], 0)])) as Record<SerieGasto, number>;
  const total = data.reduce((a, d) => a + totalMes(d), 0);
  const GAP = 2;

  return (
    <div className="mt-2">
      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
        {series.map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: COLOR[k] }} />
            {NOMBRE_SERIE[k]} <span className="font-semibold tabular-nums text-slate-800">{balCompact(totales[k])}</span>
          </span>
        ))}
      </div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={`Gasto por mes. ${data
            .map((d) => `${fmtCorta(d.month)}: ${series.map((k) => `${NOMBRE_SERIE[k]} ${balCompact(d[k])}`).join(", ")}`)
            .join(". ")}`}
        >
          {[0.5, 1].map((f) => (
            <line key={f} x1={PAD_X} x2={W - PAD_X} y1={y(max * f)} y2={y(max * f)} stroke="#F1F5F9" strokeWidth="1" />
          ))}
          <line x1={PAD_X} x2={W - PAD_X} y1={H - PAD_B} y2={H - PAD_B} stroke="#E2E8F0" strokeWidth="1" />
          {data.map((d, i) => {
            const cx = PAD_X + slot * i + slot / 2;
            const x = cx - barW / 2;
            const tramos = series.filter((k) => d[k] > 0);
            let base = H - PAD_B;
            const dim = hover !== null && hover !== i;
            return (
              <g key={d.month} opacity={dim ? 0.4 : 1} style={{ transition: "opacity 150ms" }}>
                <rect
                  x={PAD_X + slot * i}
                  y={PAD_T}
                  width={slot}
                  height={H - PAD_B - PAD_T}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => setHover((h) => (h === i ? null : i))}
                />
                {tramos.map((k, j) => {
                  // Piso de 2px para que un tramo chico se vea; el gap de 2px
                  // separa tramos sin dibujar bordes.
                  const alto = Math.max(2, (d[k] / max) * (H - PAD_B - PAD_T));
                  const top = base - alto;
                  const ultimo = j === tramos.length - 1;
                  const r = ultimo ? Math.min(4, alto / 2) : 0;
                  const path = `M ${x} ${base} L ${x} ${top + r} Q ${x} ${top} ${x + r} ${top} L ${x + barW - r} ${top} Q ${x + barW} ${top} ${x + barW} ${top + r} L ${x + barW} ${base} Z`;
                  base = top - GAP;
                  return <path key={k} d={path} fill={COLOR[k]} style={{ pointerEvents: "none" }} />;
                })}
                {i === maxIdx && hover === null ? (
                  <text x={cx} y={y(totalMes(d)) - (tramos.length - 1) * GAP - 5} textAnchor="middle" className="fill-slate-600" fontSize="11" fontWeight="600">
                    {balCompact(totalMes(d))}
                  </text>
                ) : null}
                <text x={cx} y={H - 6} textAnchor="middle" className="fill-slate-500" fontSize="10">
                  {MESES_CORTOS[Number(d.month.slice(5, 7)) - 1]}
                  {data.length > 6 && i > 0 && d.month.slice(0, 4) !== data[i - 1].month.slice(0, 4) ? ` ${d.month.slice(2, 4)}` : ""}
                </text>
              </g>
            );
          })}
        </svg>
        {hover !== null ? (
          <div
            className="pointer-events-none absolute -top-1 z-10 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] leading-relaxed text-white shadow-lg"
            style={{
              left: `${Math.min(80, Math.max(20, ((PAD_X + slot * hover + slot / 2) / W) * 100))}%`,
              transform: "translateX(-50%)",
            }}
          >
            <p className="font-semibold">
              {fmtCorta(data[hover].month)} · {bal(totalMes(data[hover]))}
            </p>
            {series
              .filter((k) => data[hover][k] !== 0)
              .map((k) => (
                <p key={k} className="whitespace-nowrap">
                  {NOMBRE_SERIE[k]}: {bal(data[hover][k])}
                </p>
              ))}
          </div>
        ) : null}
      </div>
      <p className="mt-1.5 text-[11px] text-slate-500">
        Mes con más gasto: <span className="font-semibold text-slate-800">{fmtCorta(data[maxIdx].month)}</span> ({balCompact(totalMes(data[maxIdx]))}) · promedio{" "}
        {balCompact(total / data.length)} en {data.length} {data.length === 1 ? "mes" : "meses"} con gasto
      </p>
    </div>
  );
}
