"use client";

import { useEffect, useRef, useState } from "react";
import { money, type monthlySeries } from "@/lib/inicio/overview";
import { cn } from "@/lib/utils";

const MONTHS = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
];
type Month = ReturnType<typeof monthlySeries>[number];

export function FinanceChart({
  data,
  year,
  currentMonth,
}: {
  data: Month[];
  year: number;
  currentMonth: number;
}) {
  const [window, setWindow] = useState<6 | 12>(12);
  const [selected, setSelected] = useState<number | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(680);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(240, entry.contentRect.width)),
    );
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const end = Math.max(0, Math.min(11, currentMonth));
  const visible =
    window === 12 ? data : data.slice(Math.max(0, end - 5), end + 1);
  const max = Math.max(1, ...visible.flatMap((m) => [m.income, m.cost]));
  const min = Math.min(0, ...visible.flatMap((m) => [m.income, m.cost]));
  const y = (value: number) => 184 - ((value - min) / (max - min)) * 160;
  const step = (width - 70) / visible.length;
  const active =
    selected === null ? null : visible.find((m) => m.month === selected);
  const reported = visible.some((m) => m.reported);
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Facturación y costos
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Movimiento mensual · {year}
          </p>
        </div>
        <div
          className="flex rounded-lg bg-slate-100 p-1"
          aria-label="Meses del gráfico"
        >
          {([6, 12] as const).map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={window === n}
              onClick={() => {
                setWindow(n);
                setSelected(null);
              }}
              className={cn(
                "min-h-11 rounded-md px-3 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-blue-600",
                window === n
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900",
              )}
            >
              {n} meses
            </button>
          ))}
        </div>
      </div>
      <div className="mb-3 flex flex-wrap gap-4 text-xs font-medium text-slate-600">
        <span className="flex items-center gap-2">
          <span className="size-2.5 rounded-sm bg-blue-600" />
          Facturado
        </span>
        <span className="flex items-center gap-2">
          <span className="size-2.5 rounded-sm bg-slate-400" />
          Costos + horas
        </span>
      </div>
      <div ref={container}>
        {reported ? (
          <div>
            <svg
              viewBox={`0 0 ${width} 215`}
              className="h-[215px] w-full"
              role="img"
              aria-label={`Facturación y costos mensuales de ${year}. Los valores están disponibles en la tabla inferior.`}
            >
              {[0, 0.5, 1].map((f) => {
                const v = min + (max - min) * f;
                return (
                  <g key={f}>
                    <line
                      x1="62"
                      x2={width - 8}
                      y1={y(v)}
                      y2={y(v)}
                      stroke="#e2e8f0"
                      strokeDasharray="3 5"
                    />
                    <text
                      x="53"
                      y={y(v) + 4}
                      textAnchor="end"
                      fontSize="11"
                      fill="#64748b"
                    >
                      {new Intl.NumberFormat("en-US", {
                        notation: "compact",
                        maximumFractionDigits: 0,
                      }).format(v)}
                    </text>
                  </g>
                );
              })}
              {min < 0 && (
                <line
                  x1="62"
                  x2={width - 8}
                  y1={y(0)}
                  y2={y(0)}
                  stroke="#94a3b8"
                />
              )}
              {visible.map((m, i) => {
                const x = 62 + i * step + step / 2;
                const barWidth = Math.min(16, step * 0.26);
                return (
                  <g key={m.month}>
                    {[m.income, m.cost].map((v, j) => (
                      <rect
                        key={j}
                        x={x + (j ? 2 : -barWidth - 2)}
                        y={Math.min(y(0), y(v))}
                        width={barWidth}
                        height={Math.abs(y(v) - y(0))}
                        rx="3"
                        fill={j ? "#94a3b8" : "#2563eb"}
                        opacity={
                          selected === null || selected === m.month ? 1 : 0.35
                        }
                        className="motion-safe:transition-opacity"
                      />
                    ))}
                    {(width >= 500 || visible.length <= 6 || i % 2 === 0) && (
                      <text
                        x={x}
                        y="207"
                        textAnchor="middle"
                        fontSize="11"
                        fill="#475569"
                      >
                        {MONTHS[m.month]}
                      </text>
                    )}
                    <rect
                      x={62 + i * step}
                      y="15"
                      width={step}
                      height="175"
                      fill="transparent"
                      onMouseEnter={() => setSelected(m.month)}
                      onMouseLeave={() => setSelected(null)}
                      onClick={() => setSelected(m.month)}
                    >
                      <title>{`${MONTHS[m.month]}: ${m.reported ? `facturado ${money(m.income)}, costos ${money(m.cost)}` : "Sin desglose registrado"}`}</title>
                    </rect>
                  </g>
                );
              })}
            </svg>
            <p
              className="min-h-9 text-center text-xs leading-5 text-slate-600"
              aria-live="polite"
            >
              {active
                ? `${MONTHS[active.month]} · ${active.reported ? `Facturado ${money(active.income)} · Costos ${money(active.cost)}` : "Sin desglose registrado"}`
                : "Seleccione un mes o consulte el detalle de valores."}
            </p>
          </div>
        ) : (
          <div className="flex h-[246px] flex-col items-center justify-center rounded-xl bg-slate-50 text-center">
            <p className="font-medium text-slate-700">
              Sin desglose para estos meses
            </p>
            <p className="mt-2 max-w-xs px-4 text-sm text-slate-500">
              Los totales del proyecto pueden existir aunque no haya detalle
              mensual.
            </p>
          </div>
        )}
      </div>
      <details className="mt-1 border-t border-slate-100 pt-3">
        <summary className="min-h-11 cursor-pointer text-xs font-medium text-slate-600 focus-visible:outline-2 focus-visible:outline-blue-600">
          Ver valores por mes
        </summary>
        <table className="mt-2 w-full text-right text-xs">
          <caption className="sr-only">Detalle mensual de {year}</caption>
          <thead>
            <tr className="text-slate-500">
              <th className="py-2 text-left">Mes</th>
              <th>Facturado</th>
              <th>Costos</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((m) => (
              <tr key={m.month} className="border-t border-slate-100">
                <th className="py-2 text-left font-medium">
                  {MONTHS[m.month]}
                </th>
                <td>{m.reported ? money(m.income) : "Sin datos"}</td>
                <td>{m.reported ? money(m.cost) : "Sin datos"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <p className="mt-2 text-[11px] leading-5 text-slate-500">
        Solo movimientos con desglose. No es un flujo de caja; puede diferir del
        acumulado de los proyectos.
      </p>
    </>
  );
}
