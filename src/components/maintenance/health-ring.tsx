"use client";

import { RadialBar, RadialBarChart, ResponsiveContainer, PolarAngleAxis } from "recharts";

function colorForScore(score: number): string {
  if (score >= 85) return "#10B981";
  if (score >= 65) return "#84CC16";
  if (score >= 45) return "#F59E0B";
  if (score >= 25) return "#F97316";
  return "#EF4444";
}

export function HealthRing({ score, size = 200 }: { score: number; size?: number }) {
  const color = colorForScore(score);
  const data = [{ name: "Salud", value: score, fill: color }];

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          cx="50%"
          cy="50%"
          innerRadius={size * 0.36}
          outerRadius={size * 0.48}
          barSize={size * 0.12}
          data={data}
          startAngle={90}
          endAngle={-270}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} axisLine={false} />
          <RadialBar
            dataKey="value"
            cornerRadius={999}
            background={{ fill: "rgba(255,255,255,0.06)" }}
            fill={color}
            isAnimationActive={false}
          />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="text-5xl font-bold tabular-nums tracking-tight"
          style={{ color }}
        >
          {score}
          <span className="text-2xl font-medium opacity-70">%</span>
        </span>
        <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/60">
          Salud general
        </span>
      </div>
    </div>
  );
}
