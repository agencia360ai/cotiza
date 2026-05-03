import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  total,
  accent,
  icon: Icon,
  hint,
}: {
  label: string;
  value: number;
  total?: number;
  accent: string;
  icon: React.ComponentType<{ className?: string }>;
  hint?: string;
}) {
  const pct = total && total > 0 ? Math.round((value / total) * 100) : null;
  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-5">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-1"
        style={{ backgroundColor: accent }}
      />
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span
              className="text-3xl font-semibold tabular-nums text-slate-900"
              style={{ color: accent }}
            >
              {value}
            </span>
            {total != null ? (
              <span className="text-sm text-slate-400 tabular-nums">/ {total}</span>
            ) : null}
          </div>
          {pct != null ? (
            <p className="mt-0.5 text-xs text-slate-500 tabular-nums">{pct}% del total</p>
          ) : hint ? (
            <p className="mt-0.5 text-xs text-slate-500">{hint}</p>
          ) : null}
        </div>
        <div
          className={cn(
            "flex size-10 items-center justify-center rounded-lg",
          )}
          style={{ backgroundColor: `${accent}1A`, color: accent }}
        >
          <Icon className="size-5" />
        </div>
      </div>
    </div>
  );
}
