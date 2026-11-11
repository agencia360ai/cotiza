"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Clock, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { QboProject } from "@/lib/quickbooks/projects";
import { gastoConHoras, type HorasProyecto } from "@/lib/quickbooks/horas-core";
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
import { CargarHoras } from "./cargar-horas";
import { bal, balCompact, fmtCorta, fmtHoras, marginTextColor, MESES_CORTOS } from "./formato";
import { barra, etiquetaCada, fmtEje, marcasEje, posicionTip, rellenarMeses } from "./grafica-core";
import { Muestra, useAncho } from "./grafica-mensual";

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
export function ResumenProyecto({
  p,
  rangeActive,
  onHorasCambiadas,
}: {
  p: QboProject;
  rangeActive: boolean;
  // Sin esto el resumen solo muestra: cargar horas necesita avisarle al tablero.
  onHorasCambiadas?: (h: HorasProyecto | null) => void;
}) {
  const [desglose, setDesglose] = useState<DesgloseProyecto | null>(null);
  const [cargandoHoras, setCargandoHoras] = useState(false);
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
  // Las EST: lo que falta facturar del contrato. Con eso se ve cómo cierra el
  // proyecto, no solo cómo va hoy (un proyecto en curso con todo en EST se ve
  // en pérdida aunque esté bien cotizado).
  const pf = p.porFacturar;
  const conTodo = ingreso + (pf?.neto ?? 0);
  const margenConTodo = pf && conTodo > 0 && (p.cost ?? 0) >= 0 ? (conTodo - costos) / conTodo : null;
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

      {pf ? (
        <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900 ring-1 ring-inset ring-sky-600/20">
          <span className="font-semibold">Por facturar (EST): {bal(pf.neto)}</span>
          {pf.cobrado > 0 ? <span className="text-emerald-700"> · {bal(pf.cobrado)} ya cobrado de anticipo</span> : null}
          <span>
            {" "}
            · si se factura todo: {bal(conTodo)} − {bal(costos)} ={" "}
            <span className={cn("font-semibold", conTodo - costos < 0 ? "text-rose-600" : "text-slate-900")}>{bal(conTodo - costos)}</span>
            {margenConTodo !== null ? (
              <span className={cn("font-semibold", marginTextColor(margenConTodo))}> ({Math.round(margenConTodo * 100)}% margen)</span>
            ) : null}
          </span>
        </p>
      ) : null}

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
          ) : pf ? null : (
            <Vacio texto={desglose ? "Sin ingresos en QuickBooks." : "Sin desglose por cuenta todavía."} />
          )}
          {!cargando && pf ? (
            <div>
              <TituloSeccion titulo="Por facturar (EST)" total={pf.neto} />
              <ul className="space-y-1.5">
                {pf.docs.map((d) => (
                  <Fila
                    key={d.numero}
                    nombre={d.numero}
                    detalle={d.cobrado > 0 ? `${bal(d.cobrado)} cobrado` : undefined}
                    monto={d.neto}
                    color="#0284c7"
                    base={Math.max(1, conTodo)}
                    negativoEsRaro={false}
                  />
                ))}
              </ul>
              <p className="mt-1 text-[11px] text-slate-400">No suma a lo facturado hasta que se facture de verdad.</p>
            </div>
          ) : null}
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
                {onHorasCambiadas && !cargandoHoras ? (
                  <button
                    type="button"
                    onClick={() => setCargandoHoras(true)}
                    className="mb-1.5 inline-flex cursor-pointer items-center gap-1 rounded-md bg-teal-50 px-2 py-1 text-[11px] font-semibold text-teal-800 ring-1 ring-inset ring-teal-600/20 hover:bg-teal-100"
                  >
                    <Clock className="size-3.5" /> + Cargar horas
                  </button>
                ) : null}
                {p.horas && p.horas.tecnicos.length > 0 ? (
                  <ul className="space-y-1.5">
                    {p.horas.tecnicos.map((t) => (
                      <Fila
                        key={t.nombre}
                        nombre={t.nombre}
                        detalle={`${fmtHoras(t.horas)} h${t.proveedor && !/serv/i.test(t.nombre) ? " · serv. profesional" : ""}`}
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

      {cargandoHoras && onHorasCambiadas ? (
        <CargarHoras qbJobId={p.id} nombreProyecto={p.name} onCambio={onHorasCambiadas} onCerrar={() => setCargandoHoras(false)} />
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-slate-100 pt-2.5 text-[11px] text-slate-500">
        {desglose ? (
          <span>
            Desglose de QuickBooks desde {fmtCorta(desglose.desde)} · traído {fmtCorta(desglose.actualizado.slice(0, 10))}
            {difiere ? " · no cuadra exacto con los totales de arriba: son de otra lectura de QuickBooks o de otro período" : ""}
          </span>
        ) : !cargando ? (
          <span>Todavía no hay desglose por cuenta de este proyecto: se arma al tocar Actualizar, o tráelo ahora.</span>
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
      {/* En el celular, sin centavos: con ellos tres montos no entraban y se
          cortaban en "$30,396....". El monto exacto queda en el title. */}
      <p className={cn("truncate text-sm font-bold tabular-nums sm:text-xl", clase)} title={bal(valor)}>
        <span className="sm:hidden">{balCompact(valor)}</span>
        <span className="hidden sm:inline">{bal(valor)}</span>
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
// el alto es el total del mes y los tramos lo reparten. Mismas specs que la
// gráfica del tablero: píxeles reales (no un viewBox estirado), eje con montos
// redondos, tope redondeado anclado a la base, 2px de separación entre tramos
// y detalle por mes al pasar el mouse, tocar o enfocar con el teclado.
const G_H = 196;
const G_PAD_L = 42;
const G_PAD_R = 4;
const G_PAD_T = 22;
const G_PAD_B = 26;
const G_BASE = G_H - G_PAD_B;
const G_TIP = 184;

function GastoPorMes({ data: crudo }: { data: MesGasto[] }) {
  const [caja, ancho] = useAncho();
  const [hoverIdx, setHover] = useState<number | null>(null);
  if (crudo.length === 0) return <p className="py-6 text-center text-xs text-slate-400">Sin gasto registrado por mes.</p>;

  const data = rellenarMeses(crudo, (month) => ({ month, costo_venta: 0, contable: 0, gasto: 0, horas: 0 }));
  // Un mes con el mouse encima puede dejar de existir si cambian los datos.
  const hover = hoverIdx !== null && hoverIdx < data.length ? hoverIdx : null;
  const series: SerieGasto[] = (["costo_venta", "contable", "gasto", "horas"] as SerieGasto[]).filter((k) => data.some((d) => d[k] > 0));
  const totalMes = (d: MesGasto) => series.reduce((a, k) => a + Math.max(0, d[k]), 0);
  const totales = Object.fromEntries(series.map((k) => [k, data.reduce((a, d) => a + d[k], 0)])) as Record<SerieGasto, number>;
  const conGasto = data.filter((d) => totalMes(d) > 0);
  const total = conGasto.reduce((a, d) => a + totalMes(d), 0);
  const maxIdx = data.reduce((mi, d, i) => (totalMes(d) > totalMes(data[mi]) ? i : mi), 0);
  const variosAnios = data[0].month.slice(0, 4) !== data[data.length - 1].month.slice(0, 4);

  const marcas = marcasEje(Math.max(...data.map(totalMes)), 3);
  const tope = marcas[marcas.length - 1];
  const alto = (v: number) => (Math.max(0, v) / tope) * (G_BASE - G_PAD_T);
  const slot = ancho > 0 ? (ancho - G_PAD_L - G_PAD_R) / data.length : 0;
  const barW = Math.max(4, Math.min(24, slot * 0.42));
  const cada = etiquetaCada(data.length, slot, variosAnios ? 40 : 26);
  const centro = (i: number) => G_PAD_L + slot * i + slot / 2;
  const GAP = 2;

  return (
    <div className="mt-2">
      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
        {series.map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <Muestra color={COLOR[k]} />
            {NOMBRE_SERIE[k]} <span className="font-semibold tabular-nums text-slate-800">{balCompact(totales[k])}</span>
          </span>
        ))}
      </div>
      <div ref={caja} className="relative" style={{ height: G_H }} onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}>
        {ancho > 0 ? (
          <svg
            width={ancho}
            height={G_H}
            className="block overflow-visible"
            role="img"
            aria-label={`Gasto por mes. ${data
              .map((d) => `${fmtCorta(d.month)}: ${series.map((k) => `${NOMBRE_SERIE[k]} ${balCompact(d[k])}`).join(", ")}`)
              .join(". ")}`}
          >
            {marcas.map((v, k) => (
              <g key={v}>
                <line
                  x1={G_PAD_L}
                  x2={ancho - G_PAD_R}
                  y1={G_BASE - alto(v)}
                  y2={G_BASE - alto(v)}
                  stroke={k === 0 ? "#E2E8F0" : "#EEF2F6"}
                  strokeWidth="1"
                />
                <text x={G_PAD_L - 8} y={G_BASE - alto(v)} dy="0.32em" textAnchor="end" fontSize="11" fill="#94A3B8" className="tabular-nums">
                  {fmtEje(v)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const cx = centro(i);
              const x = cx - barW / 2;
              const tramos = series.filter((k) => d[k] > 0);
              const activo = hover === i;
              const mes = Number(d.month.slice(5, 7)) - 1;
              let base = G_BASE;
              return (
                <g
                  key={d.month}
                  tabIndex={0}
                  role="img"
                  aria-label={`${fmtCorta(d.month)}: ${bal(totalMes(d))}`}
                  onPointerEnter={() => setHover(i)}
                  onPointerDown={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="outline-none"
                >
                  <rect x={G_PAD_L + slot * i} y={0} width={slot} height={G_BASE} fill="transparent" />
                  {activo ? (
                    <rect
                      x={cx - Math.max(barW / 2 + 8, slot * 0.36)}
                      y={G_PAD_T - 16}
                      width={Math.max(barW + 16, slot * 0.72)}
                      height={G_BASE - G_PAD_T + 16}
                      rx="8"
                      fill="#E8EDF3"
                    />
                  ) : null}
                  <g className="barra-crece pointer-events-none" style={{ animationDelay: `${Math.min(i, 24) * 22}ms` }}>
                    {tramos.map((k, j) => {
                      // Piso de 2px para que un tramo chico se vea; los 2px de
                      // separación hacen de borde sin dibujar uno.
                      const h = Math.max(2, alto(d[k]));
                      const top = base - h;
                      const path = barra(x, barW, top, base, j === tramos.length - 1);
                      base = top - GAP;
                      return <path key={k} d={path} fill={COLOR[k]} />;
                    })}
                  </g>
                  {mes % cada === 0 || (cada === 1 && i === 0) ? (
                    <text
                      x={cx}
                      y={G_H - 8}
                      textAnchor="middle"
                      fontSize="11"
                      fill={activo ? "#0F172A" : "#64748B"}
                      fontWeight={activo ? 600 : 400}
                      className="pointer-events-none"
                    >
                      {MESES_CORTOS[mes]}
                      {variosAnios && (mes === 0 || i === 0) ? ` ${d.month.slice(2, 4)}` : ""}
                    </text>
                  ) : null}
                </g>
              );
            })}
            {hover === null && totalMes(data[maxIdx]) > 0 ? (
              <text
                x={Math.min(Math.max(centro(maxIdx), G_PAD_L + 24), ancho - G_PAD_R - 24)}
                y={G_BASE - alto(totalMes(data[maxIdx])) - (series.filter((k) => data[maxIdx][k] > 0).length - 1) * GAP - 7}
                textAnchor="middle"
                fontSize="11"
                fontWeight="600"
                fill="#475569"
                className="pointer-events-none tabular-nums"
              >
                {balCompact(totalMes(data[maxIdx]))}
              </text>
            ) : null}
          </svg>
        ) : null}
        {hover !== null && ancho > 0 ? (
          <div
            className="pointer-events-none absolute top-0 z-10 rounded-xl bg-slate-900/95 px-3 py-2.5 text-[11px] text-white shadow-xl ring-1 ring-white/10"
            style={{ left: posicionTip(centro(hover), barW / 2, ancho, G_TIP), width: G_TIP }}
          >
            <p className="mb-1.5 flex justify-between gap-2 font-semibold">
              <span>{fmtCorta(data[hover].month)}</span>
              <span className="tabular-nums">{balCompact(totalMes(data[hover]))}</span>
            </p>
            <div className="grid grid-cols-[10px_1fr_auto] items-center gap-x-2 gap-y-1">
              {series
                .filter((k) => data[hover][k] !== 0)
                .map((k) => (
                  <Fragment key={k}>
                    <Muestra color={COLOR[k]} />
                    <span className="text-slate-300">{NOMBRE_SERIE[k]}</span>
                    <span className="text-right tabular-nums">{balCompact(data[hover][k])}</span>
                  </Fragment>
                ))}
              {totalMes(data[hover]) === 0 ? <span className="col-span-3 text-slate-400">Sin gasto este mes</span> : null}
            </div>
          </div>
        ) : null}
      </div>
      {conGasto.length > 0 ? (
        <p className="mt-1.5 text-[11px] text-slate-500">
          Mes con más gasto: <span className="font-semibold text-slate-800">{fmtCorta(data[maxIdx].month)}</span> ({balCompact(totalMes(data[maxIdx]))}) ·
          promedio {balCompact(total / conGasto.length)} en {conGasto.length} {conGasto.length === 1 ? "mes" : "meses"} con gasto
        </p>
      ) : null}
    </div>
  );
}
