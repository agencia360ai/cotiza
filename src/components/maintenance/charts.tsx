"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Line, LineChart, Tooltip } from "recharts";
import { STATUS_COLOR, STATUS_LABEL, type EquipmentStatus } from "@/lib/maintenance/types";

export function StatusDonut({
  counts,
  size = 200,
}: {
  counts: Record<EquipmentStatus, number>;
  size?: number;
}) {
  const data = (["operativo", "atencion", "critico", "fuera_de_servicio", "sin_inspeccion"] as EquipmentStatus[])
    .map((k) => ({ name: STATUS_LABEL[k], value: counts[k], status: k }))
    .filter((d) => d.value > 0);
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            innerRadius={size * 0.32}
            outerRadius={size * 0.45}
            paddingAngle={2}
            dataKey="value"
            stroke="none"
          >
            {data.map((d) => (
              <Cell key={d.status} fill={STATUS_COLOR[d.status]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              borderRadius: 8,
              border: "1px solid #e2e8f0",
              fontSize: 12,
              padding: "6px 10px",
            }}
            formatter={(v, n) => {
              const num = Number(v);
              return [`${num} equipo${num === 1 ? "" : "s"}`, String(n)];
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-semibold tabular-nums text-slate-900">{total}</span>
        <span className="text-xs uppercase tracking-wider text-slate-500">Equipos</span>
      </div>
    </div>
  );
}

export function StackedStatusBar({ counts }: { counts: Record<EquipmentStatus, number> }) {
  const order: EquipmentStatus[] = ["operativo", "atencion", "critico", "fuera_de_servicio", "sin_inspeccion"];
  const total = order.reduce((s, k) => s + counts[k], 0);
  if (total === 0) return null;

  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-200">
      {order.map((k) =>
        counts[k] > 0 ? (
          <div
            key={k}
            style={{ width: `${(counts[k] / total) * 100}%`, backgroundColor: STATUS_COLOR[k] }}
            title={`${STATUS_LABEL[k]}: ${counts[k]}`}
          />
        ) : null,
      )}
    </div>
  );
}

const STATUS_NUM: Record<EquipmentStatus, number> = {
  operativo: 4,
  atencion: 2,
  critico: 1,
  fuera_de_servicio: 0,
  sin_inspeccion: 3,
};

export function StatusSparkline({
  history,
  width = 80,
  height = 28,
}: {
  history: { status: EquipmentStatus; date: string }[];
  width?: number;
  height?: number;
}) {
  if (history.length === 0) {
    return <div className="text-xs text-slate-400">Sin histórico</div>;
  }
  const data = history.map((h, i) => ({ idx: i, value: STATUS_NUM[h.status], status: h.status }));
  const last = history[history.length - 1].status;
  const stroke = STATUS_COLOR[last];

  return (
    <div style={{ width, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <Line
            type="monotone"
            dataKey="value"
            stroke={stroke}
            strokeWidth={1.75}
            dot={{ r: 2, fill: stroke, strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ReportTrendLine({
  reports,
  height = 60,
}: {
  reports: { performed_at_start: string; counts: Record<EquipmentStatus, number> }[];
  height?: number;
}) {
  const data = [...reports]
    .sort((a, b) => +new Date(a.performed_at_start) - +new Date(b.performed_at_start))
    .map((r) => {
      const total = Object.values(r.counts).reduce((s, n) => s + (n ?? 0), 0);
      const ok = r.counts.operativo ?? 0;
      return {
        date: r.performed_at_start,
        pct: total > 0 ? Math.round((ok / total) * 100) : 0,
      };
    });

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 6, bottom: 6, left: 6 }}>
          <Line
            type="monotone"
            dataKey="pct"
            stroke={STATUS_COLOR.operativo}
            strokeWidth={2}
            dot={{ r: 3, fill: STATUS_COLOR.operativo, strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
