"use client";

import { useState } from "react";

// Charts del Inicio — SVG puro, sin librerías. Specs dataviz: marcas finas con
// tope redondeado ancladas a la línea base, grid recesivo, tooltip por barra,
// texto siempre en tokens de texto (nunca del color de la serie), donut con
// separación blanca de 2px y leyenda con valores (identidad no-solo-color).

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MESES_CORTOS = MESES.map((m) => m.toLowerCase());
const MESES_LARGOS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

// Mismo formato $ que formatMoney (los KPIs de arriba): una sola moneda visible.
function bal(n: number): string {
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export type MonthPoint = { month: number; monto: number; count: number };

export function MonthlyBarChart({ data, year }: { data: MonthPoint[]; year: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 220;
  const PAD_L = 8;
  const PAD_B = 22;
  const PAD_T = 14;
  const max = Math.max(1, ...data.map((d) => d.monto));
  const innerW = W - PAD_L * 2;
  const slot = innerW / 12;
  const barW = Math.min(26, slot * 0.55);
  const maxIdx = data.reduce((mi, d, i) => (d.monto > data[mi].monto ? i : mi), 0);

  const y = (v: number) => H - PAD_B - (v / max) * (H - PAD_B - PAD_T);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Cotizaciones por mes, ${year}`}>
        {/* grid recesivo: 3 líneas */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={PAD_L} x2={W - PAD_L} y1={y(max * f)} y2={y(max * f)} stroke="#F1F5F9" strokeWidth="1" />
        ))}
        <line x1={PAD_L} x2={W - PAD_L} y1={H - PAD_B} y2={H - PAD_B} stroke="#E2E8F0" strokeWidth="1" />

        {data.map((d, i) => {
          const cx = PAD_L + slot * i + slot / 2;
          const x = cx - barW / 2;
          const yTop = y(d.monto);
          const h = Math.max(d.monto > 0 ? 3 : 0, H - PAD_B - yTop);
          const active = hover === i;
          return (
            <g key={i}>
              {/* hit target más grande que la marca */}
              <rect
                x={PAD_L + slot * i}
                y={PAD_T}
                width={slot}
                height={H - PAD_B - PAD_T}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
              {h > 0 ? (
                <path
                  d={`M ${x} ${H - PAD_B} L ${x} ${yTop + 4} Q ${x} ${yTop} ${x + 4} ${yTop} L ${x + barW - 4} ${yTop} Q ${x + barW} ${yTop} ${x + barW} ${yTop + 4} L ${x + barW} ${H - PAD_B} Z`}
                  fill={active ? "#1D4ED8" : "#2563EB"}
                  opacity={hover === null || active ? 1 : 0.45}
                  style={{ transition: "opacity 150ms, fill 150ms", pointerEvents: "none" }}
                />
              ) : null}
              {/* label directo selectivo: solo el mes máximo */}
              {i === maxIdx && d.monto > 0 && hover === null ? (
                <text x={cx} y={yTop - 6} textAnchor="middle" className="fill-slate-600" fontSize="10" fontWeight="600">
                  {bal(d.monto)}
                </text>
              ) : null}
              <text x={cx} y={H - 7} textAnchor="middle" className="fill-slate-400" fontSize="10">
                {MESES[d.month]}
              </text>
            </g>
          );
        })}
      </svg>

      {hover !== null ? (
        <div
          className="pointer-events-none absolute -top-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] text-white shadow-lg"
          style={{ left: `${((PAD_L + slot * hover + slot / 2) / W) * 100}%`, transform: "translateX(-50%)" }}
        >
          <span className="font-semibold">{MESES[data[hover].month]}</span> · {bal(data[hover].monto)} ·{" "}
          {data[hover].count} cotiz.
        </div>
      ) : null}
    </div>
  );
}

export type DonutSlice = { key: string; label: string; color: string; value: number };

export function RubroDonut({ slices, title }: { slices: DonutSlice[]; title: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const total = slices.reduce((a, s) => a + s.value, 0);
  const R = 62;
  const r = 39;
  const C = 80;
  let acc = 0;

  function arc(from: number, to: number): string {
    const a0 = 2 * Math.PI * from - Math.PI / 2;
    const a1 = 2 * Math.PI * to - Math.PI / 2;
    const large = to - from > 0.5 ? 1 : 0;
    const p = (a: number, rad: number) => `${C + rad * Math.cos(a)} ${C + rad * Math.sin(a)}`;
    return `M ${p(a0, R)} A ${R} ${R} 0 ${large} 1 ${p(a1, R)} L ${p(a1, r)} A ${r} ${r} 0 ${large} 0 ${p(a0, r)} Z`;
  }

  const shown = slices.filter((s) => s.value > 0);

  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 160 160" className="size-36 shrink-0" role="img" aria-label={title}>
        {total === 0 ? (
          <circle cx={C} cy={C} r={(R + r) / 2} fill="none" stroke="#F1F5F9" strokeWidth={R - r} />
        ) : (
          shown.map((s) => {
            const from = acc / total;
            acc += s.value;
            const to = acc / total;
            const active = hover === s.key;
            return (
              <path
                key={s.key}
                d={arc(from, Math.max(from + 0.0001, to))}
                fill={s.color}
                stroke="#fff"
                strokeWidth="2.5"
                opacity={hover === null || active ? 1 : 0.4}
                style={{ transition: "opacity 150ms", cursor: "pointer" }}
                onMouseEnter={() => setHover(s.key)}
                onMouseLeave={() => setHover(null)}
              />
            );
          })
        )}
        <text x={C} y={C - 3} textAnchor="middle" className="fill-slate-900" fontSize="20" fontWeight="700">
          {total}
        </text>
        <text x={C} y={C + 14} textAnchor="middle" className="fill-slate-400" fontSize="9">
          cotizaciones
        </text>
      </svg>

      {/* leyenda con valores: identidad nunca solo-color */}
      <ul className="min-w-0 flex-1 space-y-2">
        {slices.map((s) => {
          const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
          return (
            <li
              key={s.key}
              className="flex cursor-pointer items-center gap-2 text-sm"
              onMouseEnter={() => setHover(s.key)}
              onMouseLeave={() => setHover(null)}
            >
              <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="truncate text-slate-600">{s.label}</span>
              <span className="ml-auto tabular-nums font-semibold text-slate-900">{pct}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Cobro vs. gasto por mes ──────────────────────────────────────────────────
// Del handoff: 12 grupos de 2 barras, cobro #1E293B y gasto #F43F5E, grid de 3
// líneas punteadas, etiqueta en pastilla sobre el mes pico. Los meses que
// todavía no pasaron van en gris: un cero de "no facturamos" y un cero de
// "todavía no llegó" no son lo mismo.
export type MesCobroGasto = { mes: number; cobro: number; gasto: number };

export function CobroGastoChart({ data, hastaMes }: { data: MesCobroGasto[]; hastaMes: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = 230;
  const PAD_L = 6;
  const PAD_B = 24;
  const PAD_T = 26;
  const max = Math.max(1, ...data.map((d) => Math.max(d.cobro, d.gasto)));
  const innerW = W - PAD_L * 2;
  const slot = innerW / 12;
  const barW = 11;
  const gap = 3;
  const picoIdx = data.reduce((mi, d, i) => (d.cobro > data[mi].cobro ? i : mi), 0);
  const y = (v: number) => H - PAD_B - (v / max) * (H - PAD_B - PAD_T);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Cobro contra gasto, mes a mes">
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={PAD_L}
            x2={W - PAD_L}
            y1={y(max * f)}
            y2={y(max * f)}
            stroke="#F1F3F6"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        ))}
        <line x1={PAD_L} x2={W - PAD_L} y1={H - PAD_B} y2={H - PAD_B} stroke="#E4E7EC" strokeWidth="1" />

        {data.map((d, i) => {
          const cx = PAD_L + slot * i + slot / 2;
          const futuro = i > hastaMes;
          const yC = y(d.cobro);
          const yG = y(d.gasto);
          const hC = Math.max(d.cobro > 0 ? 2 : 0, H - PAD_B - yC);
          const hG = Math.max(d.gasto > 0 ? 2 : 0, H - PAD_B - yG);
          return (
            <g key={i}>
              <rect
                x={PAD_L + slot * i}
                y={PAD_T}
                width={slot}
                height={H - PAD_B - PAD_T}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
              {futuro ? (
                <rect x={cx - barW - gap / 2} y={H - PAD_B - 3} width={barW * 2 + gap} height="3" rx="1.5" fill="#E2E8F0" />
              ) : (
                <>
                  <rect x={cx - barW - gap / 2} y={yC} width={barW} height={hC} rx="2" fill="#1E293B" />
                  <rect x={cx + gap / 2} y={yG} width={barW} height={hG} rx="2" fill="#F43F5E" />
                </>
              )}
              <text
                x={cx}
                y={H - 8}
                textAnchor="middle"
                className="text-[10px]"
                fill={i === picoIdx ? "#0F172A" : futuro ? "#94A3B8" : "#64748B"}
                fontWeight={i === picoIdx ? 700 : 400}
              >
                {MESES_CORTOS[i]}
              </text>
            </g>
          );
        })}

        {/* Pastilla sobre el mes pico: el número que resume el año. */}
        {data[picoIdx].cobro > 0 ? (
          <g>
            <rect
              x={PAD_L + slot * picoIdx + slot / 2 - 38}
              y={Math.max(2, y(data[picoIdx].cobro) - 22)}
              width="76"
              height="18"
              rx="5"
              fill="#0F172A"
            />
            <text
              x={PAD_L + slot * picoIdx + slot / 2}
              y={Math.max(2, y(data[picoIdx].cobro) - 22) + 12.5}
              textAnchor="middle"
              className="text-[10px] font-bold"
              fill="#fff"
            >
              {bal(data[picoIdx].cobro)}
            </text>
          </g>
        ) : null}
      </svg>

      {hover !== null && !(hover > hastaMes) ? (
        <div className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] leading-relaxed text-white shadow-lg">
          <span className="font-semibold">{MESES_LARGOS[hover]}</span> · cobro {bal(data[hover].cobro)} · gasto{" "}
          {bal(data[hover].gasto)}
        </div>
      ) : null}
    </div>
  );
}
