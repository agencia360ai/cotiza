"use client";

import { useEffect, useState } from "react";
import { ChartColumn, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { balCompact, marginTextColor, MESES_CORTOS } from "./formato";
import { barra, etiquetaCada, fmtEje, marcasEje, posicionTip, rellenarMeses } from "./grafica-core";

// ── Facturado y gasto por mes ────────────────────────────────────────────────
// Dos barras por mes, lado a lado desde la misma base: lo facturado y el gasto.
// Lo cobrado va DENTRO de lo facturado (es una parte de eso, nunca más): la
// parte sólida ya entró y la clara está por cobrar. Antes eran tres barras
// sueltas y había que restar a ojo para ver cuánto faltaba. Si un proyecto no
// tiene dato de cobro, su parte va en gris: "no sé" no es "debe".
//
// Se dibuja en píxeles reales del contenedor, no con un viewBox que se estira:
// estirado, en una pantalla ancha las letras del eje medían 20px y en el
// celular 4px.
//
// Verde y rosa son los del Cobrado y el Gasto de las tarjetas de arriba: acá
// sí significan "entró" y "salió". El par pasa el validador de daltonismo
// (ΔE 8.3 deutan); además la posición en el par y la leyenda los distinguen.

export type PuntoMes = {
  month: string;
  cobro: number;
  gasto: number;
  cobrado: number | null;
  /** Lo facturado sin cobrar, solo de proyectos con dato de cobro. */
  porCobrar: number | null;
};

const COLOR = { cobrado: "#059669", porCobrar: "#A7F3D0", sinDato: "#E2E8F0", gasto: "#F43F5E" };

// Las tres partes de lo facturado en un mes. Suman exactamente lo facturado.
function partes(d: PuntoMes): { cobrado: number; porCobrar: number; sinDato: number } {
  const cobrado = Math.min(Math.max(0, d.cobrado ?? 0), d.cobro);
  const porCobrar = Math.min(Math.max(0, d.porCobrar ?? 0), d.cobro - cobrado);
  return { cobrado, porCobrar, sinDato: Math.max(0, d.cobro - cobrado - porCobrar) };
}
const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const H = 248;
const PAD_L = 46;
const PAD_R = 8;
const PAD_T = 24;
const PAD_B = 28;
const BASE = H - PAD_B;
// Separación entre marcas que se tocan: el color de la tarjeta, no un borde.
const GAP = 2;
const ANCHO_TIP = 196;

type Vista = "grafica" | "tabla";

/**
 * Ancho real del contenedor, para dibujar en píxeles. Ref por callback porque
 * el contenedor aparece y desaparece (gráfica/tabla) y un useRef no avisa.
 */
export function useAncho(): [(el: HTMLElement | null) => void, number] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [ancho, setAncho] = useState(0);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setAncho(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, ancho];
}

export function GraficaMensual({ data: crudo, todoReal }: { data: PuntoMes[]; todoReal: boolean }) {
  const [caja, ancho] = useAncho();
  const [hoverIdx, setHover] = useState<number | null>(null);
  const [vista, setVista] = useState<Vista>("grafica");

  const hayCobrado = crudo.some((d) => d.cobrado !== null);
  const data = rellenarMeses(crudo, (month) => ({ month, cobro: 0, gasto: 0, cobrado: hayCobrado ? 0 : null, porCobrar: hayCobrado ? 0 : null }));
  // Un filtro puede achicar la serie con el mouse encima: el índice viejo ya
  // no existe y leerlo rompía la pantalla entera.
  const hover = hoverIdx !== null && hoverIdx < data.length ? hoverIdx : null;

  const totalCobro = data.reduce((a, d) => a + d.cobro, 0);
  const totalGasto = data.reduce((a, d) => a + d.gasto, 0);
  const tot = data.reduce(
    (a, d) => {
      const x = partes(d);
      return { cobrado: a.cobrado + x.cobrado, porCobrar: a.porCobrar + x.porCobrar, sinDato: a.sinDato + x.sinDato };
    },
    { cobrado: 0, porCobrar: 0, sinDato: 0 },
  );
  const variosAnios = data.length > 0 && data[0].month.slice(0, 4) !== data[data.length - 1].month.slice(0, 4);
  const mesHoy = new Date().toISOString().slice(0, 7);

  const titulo = "Facturado y gasto por mes";

  return (
    <div className="mb-3 rounded-card border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(15,23,42,.04)] sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">{titulo}</h3>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {hayCobrado ? "La barra verde es lo facturado: la parte sólida ya se cobró." : "Lo facturado contra lo gastado, mes a mes."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Cómo ver los datos">
            {(
              [
                ["grafica", ChartColumn, "Gráfica"],
                ["tabla", Table2, "Tabla"],
              ] as const
            ).map(([v, Icono, nombre]) => (
              <button
                key={v}
                type="button"
                onClick={() => setVista(v)}
                aria-pressed={vista === v}
                title={nombre}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors",
                  vista === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700",
                )}
              >
                <Icono className="size-3.5" />
                <span className="hidden sm:inline">{nombre}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
        {hayCobrado ? (
          <>
            <Leyenda muestra={<MuestraFacturado />} nombre="Facturado" valor={totalCobro} />
            <Leyenda muestra={<Muestra color={COLOR.cobrado} />} nombre="Cobrado" valor={tot.cobrado} />
            <Leyenda muestra={<Muestra color={COLOR.porCobrar} />} nombre="Por cobrar" valor={tot.porCobrar} />
            {tot.sinDato > 0.5 ? <Leyenda muestra={<Muestra color={COLOR.sinDato} />} nombre="Sin dato de cobro" valor={tot.sinDato} /> : null}
          </>
        ) : (
          <Leyenda muestra={<Muestra color={COLOR.cobrado} />} nombre="Facturado" valor={totalCobro} />
        )}
        <Leyenda muestra={<Muestra color={COLOR.gasto} />} nombre="Gasto" valor={totalGasto} />
      </div>

      {vista === "tabla" ? (
        <TablaMensual data={data} hayCobrado={hayCobrado} mesHoy={mesHoy} />
      ) : (
        <div ref={caja} className="relative mt-2" style={{ height: H }} onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}>
          {ancho > 0 ? (
            <Plano data={data} ancho={ancho} hover={hover} setHover={setHover} hayCobrado={hayCobrado} variosAnios={variosAnios} mesHoy={mesHoy} titulo={titulo} />
          ) : null}
        </div>
      )}

      {!todoReal ? (
        <p className="mt-2 text-[11px] text-slate-400">
          Los proyectos sin desglose mensual en QuickBooks reparten su monto entre los meses que cubren; los meses que todavía no
          llegan son una estimación.
        </p>
      ) : null}
    </div>
  );
}

function Plano({
  data,
  ancho,
  hover,
  setHover,
  hayCobrado,
  variosAnios,
  mesHoy,
  titulo,
}: {
  data: PuntoMes[];
  ancho: number;
  hover: number | null;
  setHover: (i: number | null) => void;
  hayCobrado: boolean;
  variosAnios: boolean;
  mesHoy: string;
  titulo: string;
}) {
  const marcas = marcasEje(Math.max(...data.map((d) => Math.max(d.cobro, d.gasto))));
  const tope = marcas[marcas.length - 1];
  const y = (v: number) => BASE - (Math.max(0, v) / tope) * (BASE - PAD_T);
  const slot = (ancho - PAD_L - PAD_R) / data.length;
  const barW = Math.max(2, Math.min(20, slot * 0.3));
  const gap = barW < 5 ? 1 : GAP;
  const grupoW = barW * 2 + gap;
  const cada = etiquetaCada(data.length, slot, variosAnios ? 40 : 26);
  const picoIdx = data.reduce((mi, d, i) => (d.cobro > data[mi].cobro ? i : mi), 0);
  const centro = (i: number) => PAD_L + slot * i + slot / 2;

  return (
    <>
      <svg
        width={ancho}
        height={H}
        className="block overflow-visible"
        role="img"
        aria-label={`${titulo}. ${data
          .map(
            (d) =>
              `${fmtMes(d.month)}: facturado ${balCompact(d.cobro)}${d.cobrado !== null ? `, cobrado ${balCompact(d.cobrado)}` : ""}, gasto ${balCompact(d.gasto)}`,
          )
          .join(". ")}`}
      >
        {marcas.map((v, k) => (
          <g key={v}>
            <line x1={PAD_L} x2={ancho - PAD_R} y1={y(v)} y2={y(v)} stroke={k === 0 ? "#E2E8F0" : "#F1F5F9"} strokeWidth="1" />
            <text x={PAD_L - 10} y={y(v)} dy="0.32em" textAnchor="end" fontSize="11" fill="#94A3B8" className="tabular-nums">
              {fmtEje(v)}
            </text>
          </g>
        ))}

        {data.map((d, i) => {
          const cx = centro(i);
          const xF = cx - grupoW / 2;
          const xG = xF + barW + gap;
          const futuro = d.month.slice(0, 7) > mesHoy;
          const activo = hover === i;
          const mes = Number(d.month.slice(5, 7)) - 1;
          const conEtiqueta = mes % cada === 0 || (cada === 1 && i === 0);
          return (
            <g
              key={d.month}
              tabIndex={0}
              role="img"
              aria-label={`${fmtMes(d.month)}: facturado ${balCompact(d.cobro)}, gasto ${balCompact(d.gasto)}`}
              onPointerEnter={() => setHover(i)}
              onPointerDown={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              className="outline-none"
            >
              {/* Zona de hover: el mes entero, no la barrita de 6px. */}
              <rect x={PAD_L + slot * i} y={0} width={slot} height={BASE} fill="transparent" />
              {activo ? (
                <rect
                  x={cx - Math.max(grupoW / 2 + 8, slot * 0.36)}
                  y={PAD_T - 16}
                  width={Math.max(grupoW + 16, slot * 0.72)}
                  height={BASE - PAD_T + 16}
                  rx="8"
                  fill="#F1F5F9"
                />
              ) : null}
              <g
                className="barra-crece pointer-events-none"
                style={{ animationDelay: `${Math.min(i, 24) * 22}ms` }}
                opacity={futuro ? 0.55 : 1}
              >
                <BarraFacturado d={d} x={xF} w={barW} y={y} hayCobrado={hayCobrado} gap={gap} />
                {d.gasto > 0 ? <path d={barra(xG, barW, Math.min(y(d.gasto), BASE - 3), BASE, true)} fill={COLOR.gasto} /> : null}
              </g>
              {conEtiqueta ? (
                <text
                  x={cx}
                  y={H - 8}
                  textAnchor="middle"
                  fontSize="11"
                  fill={activo ? "#0F172A" : futuro ? "#CBD5E1" : "#64748B"}
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

        {/* Una sola cifra fija: el mes de más facturado. Da la escala sin
            llenar la gráfica de números; el resto está en el hover y la tabla. */}
        {hover === null && data[picoIdx].cobro > 0 ? (
          <text
            x={Math.min(Math.max(centro(picoIdx) - grupoW / 2 + barW / 2, PAD_L + 24), ancho - PAD_R - 24)}
            y={Math.min(y(data[picoIdx].cobro), BASE - 3) - 7}
            textAnchor="middle"
            fontSize="11"
            fontWeight="600"
            fill="#475569"
            className="pointer-events-none tabular-nums"
          >
            {balCompact(data[picoIdx].cobro)}
          </text>
        ) : null}
      </svg>

      {hover !== null ? <Tip d={data[hover]} cx={centro(hover)} grupoW={grupoW} ancho={ancho} hayCobrado={hayCobrado} mesHoy={mesHoy} /> : null}
    </>
  );
}

// Lo facturado, apilado desde la base: lo cobrado (sólido), lo que está por
// cobrar (claro) y, si falta el dato, el resto en gris. Sin serie de cobro en
// toda la vista, la barra va entera en verde y la leyenda dice "Facturado".
function BarraFacturado({
  d,
  x,
  w,
  y,
  hayCobrado,
  gap,
}: {
  d: PuntoMes;
  x: number;
  w: number;
  y: (v: number) => number;
  hayCobrado: boolean;
  gap: number;
}) {
  if (d.cobro <= 0) return null;
  // Piso de 3px: un mes de $200 al lado de uno de $50,000 se vería como una
  // raya invisible y se leería como "sin movimiento".
  if (!hayCobrado) return <path d={barra(x, w, Math.min(y(d.cobro), BASE - 3), BASE, true)} fill={COLOR.cobrado} />;
  const x3 = partes(d);
  const alto = (v: number) => BASE - y(v);
  // Un tramo de menos de 2px no se ve como tramo, se ve como un error: se
  // suma al de abajo para que el total siga midiendo lo facturado.
  const tramos: { v: number; color: string }[] = [];
  for (const [v, color] of [
    [x3.cobrado, COLOR.cobrado],
    [x3.porCobrar, COLOR.porCobrar],
    [x3.sinDato, COLOR.sinDato],
  ] as const) {
    if (v <= 0) continue;
    if (alto(v) < 2 && tramos.length > 0) tramos[tramos.length - 1].v += v;
    else tramos.push({ v, color });
  }
  const paths = [];
  let base = BASE;
  let acumulado = 0;
  for (const [j, t] of tramos.entries()) {
    acumulado += t.v;
    const ultimo = j === tramos.length - 1;
    const top = ultimo ? Math.min(y(acumulado), BASE - 3) : y(acumulado);
    paths.push(<path key={t.color} d={barra(x, w, Math.min(top, base - 1), base, ultimo)} fill={t.color} />);
    base = top - gap;
  }
  return <>{paths}</>;
}

function Tip({
  d,
  cx,
  grupoW,
  ancho,
  hayCobrado,
  mesHoy,
}: {
  d: PuntoMes;
  cx: number;
  grupoW: number;
  ancho: number;
  hayCobrado: boolean;
  mesHoy: string;
}) {
  const left = posicionTip(cx, grupoW / 2, ancho, ANCHO_TIP);
  const x3 = partes(d);
  const m = d.cobro > 0 ? (d.cobro - d.gasto) / d.cobro : null;
  const futuro = d.month.slice(0, 7) > mesHoy;
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 rounded-xl bg-slate-900/95 px-3 py-2.5 text-[11px] text-white shadow-xl ring-1 ring-white/10"
      style={{ left, width: ANCHO_TIP }}
    >
      <p className="mb-1.5 flex items-baseline justify-between gap-2 font-semibold">
        <span className="capitalize">{fmtMes(d.month, true)}</span>
        {futuro ? <span className="text-[10px] font-medium text-slate-400">estimado</span> : null}
      </p>
      <div className="grid grid-cols-[10px_1fr_auto] items-center gap-x-2 gap-y-1">
        {hayCobrado ? <MuestraFacturado /> : <Muestra color={COLOR.cobrado} />}
        <span className="text-slate-300">Facturado</span>
        <span className="text-right font-semibold tabular-nums">{balCompact(d.cobro)}</span>
        {hayCobrado ? (
          <>
            <Muestra color={COLOR.cobrado} />
            <span className="text-slate-300">Cobrado</span>
            <span className="text-right tabular-nums">
              {balCompact(x3.cobrado)}
              {d.cobro > 0 ? <span className="ml-1 text-slate-400">{Math.round((x3.cobrado / d.cobro) * 100)}%</span> : null}
            </span>
            <Muestra color={COLOR.porCobrar} />
            <span className="text-slate-300">Por cobrar</span>
            <span className="text-right tabular-nums">{balCompact(x3.porCobrar)}</span>
            {x3.sinDato > 0.5 ? (
              <>
                <Muestra color={COLOR.sinDato} />
                <span className="text-slate-300">Sin dato de cobro</span>
                <span className="text-right tabular-nums">{balCompact(x3.sinDato)}</span>
              </>
            ) : null}
          </>
        ) : null}
        <Muestra color={COLOR.gasto} />
        <span className="text-slate-300">Gasto</span>
        <span className="text-right font-semibold tabular-nums">{balCompact(d.gasto)}</span>
      </div>
      <p className="mt-2 flex justify-between border-t border-white/10 pt-1.5">
        <span className="text-slate-300">{m !== null ? "Margen" : "Resultado"}</span>
        <span className={cn("font-semibold tabular-nums", tonoOscuro(m, d.cobro - d.gasto))}>
          {m !== null ? `${Math.round(m * 100)}%` : balCompact(d.cobro - d.gasto)}
        </span>
      </p>
    </div>
  );
}

function TablaMensual({ data, hayCobrado, mesHoy }: { data: PuntoMes[]; hayCobrado: boolean; mesHoy: string }) {
  const tot = data.reduce(
    (a, d) => {
      const x = partes(d);
      return { cobro: a.cobro + d.cobro, gasto: a.gasto + d.gasto, cobrado: a.cobrado + x.cobrado, porCobrar: a.porCobrar + x.porCobrar };
    },
    { cobro: 0, gasto: 0, cobrado: 0, porCobrar: 0 },
  );
  const fila = (cobro: number, gasto: number, cobrado: number, porCobrar: number) => {
    const m = cobro > 0 ? (cobro - gasto) / cobro : null;
    return (
      <>
        <td className="px-3 py-2 text-right font-medium text-slate-900">{balCompact(cobro)}</td>
        {hayCobrado ? (
          <>
            <td className="px-3 py-2 text-right text-emerald-700">{balCompact(cobrado)}</td>
            <td className="px-3 py-2 text-right text-amber-700">{balCompact(porCobrar)}</td>
          </>
        ) : null}
        <td className="px-3 py-2 text-right text-rose-600">{balCompact(gasto)}</td>
        <td className={cn("px-3 py-2 text-right font-semibold", m !== null ? marginTextColor(m) : "text-slate-300")}>
          {m !== null ? `${Math.round(m * 100)}%` : "—"}
        </td>
      </>
    );
  };
  return (
    <div className="mt-3 max-h-[320px] overflow-auto rounded-xl ring-1 ring-slate-100">
      <table className="w-full min-w-[480px] text-[12px]">
        <thead className="sticky top-0 z-[1] bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left">Mes</th>
            <th className="px-3 py-2 text-right">Facturado</th>
            {hayCobrado ? (
              <>
                <th className="px-3 py-2 text-right">Cobrado</th>
                <th className="px-3 py-2 text-right">Por cobrar</th>
              </>
            ) : null}
            <th className="px-3 py-2 text-right">Gasto</th>
            <th className="px-3 py-2 text-right">Margen</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.map((d) => (
            <tr key={d.month} className={cn("hover:bg-slate-50/70", d.month.slice(0, 7) > mesHoy && "text-slate-400")}>
              <td className="px-3 py-2 capitalize text-slate-600">
                {fmtMes(d.month, true)}
                {d.month.slice(0, 7) > mesHoy ? <span className="ml-1.5 text-[10px] normal-case text-slate-400">estimado</span> : null}
              </td>
              {fila(d.cobro, d.gasto, partes(d).cobrado, partes(d).porCobrar)}
            </tr>
          ))}
        </tbody>
        <tfoot className="sticky bottom-0 border-t border-slate-200 bg-white font-semibold">
          <tr>
            <td className="px-3 py-2 text-slate-900">Total</td>
            {fila(tot.cobro, tot.gasto, tot.cobrado, tot.porCobrar)}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Leyenda({ muestra, nombre, valor }: { muestra: React.ReactNode; nombre: string; valor: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-slate-500">
      {muestra}
      {nombre}
      <span className="font-semibold tabular-nums text-slate-900">{balCompact(valor)}</span>
    </span>
  );
}

export function Muestra({ color }: { color: string }) {
  return <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: color }} />;
}

// La barra de facturado en chico: abajo lo cobrado, arriba lo por cobrar.
function MuestraFacturado() {
  return (
    <span aria-hidden className="inline-flex size-2.5 shrink-0 flex-col overflow-hidden rounded-[3px]">
      <span className="flex-1" style={{ backgroundColor: COLOR.porCobrar }} />
      <span className="flex-1" style={{ backgroundColor: COLOR.cobrado }} />
    </span>
  );
}

function fmtMes(iso: string, largo = false): string {
  const m = Number(iso.slice(5, 7)) - 1;
  return largo ? `${MESES_LARGOS[m]} ${iso.slice(0, 4)}` : `${MESES_CORTOS[m]} ${iso.slice(2, 4)}`;
}

// Los tonos del margen sobre el fondo oscuro del tooltip: los -600 de la tabla
// no se leen sobre slate-900.
function tonoOscuro(m: number | null, resultado: number): string {
  if (m === null) return resultado < 0 ? "text-rose-300" : "text-slate-200";
  if (m >= 0.4) return "text-emerald-300";
  if (m >= 0.2) return "text-amber-300";
  return "text-rose-300";
}
