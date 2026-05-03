import Link from "next/link";
import {
  CheckCircle2,
  AlertTriangle,
  XOctagon,
  ChevronRight,
  Clock,
  AlertOctagon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  REPORT_TYPE_COLOR,
  SEVERITY_LABEL,
  SEVERITY_TINT,
  type ReportSummary,
} from "@/lib/maintenance/types";
import { ReportTypeBadge, ReportTypeIcon } from "./report-type-badge";

function formatDateLong(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-PA", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function durationStr(start: string, end: string | null): string | null {
  if (!end) return null;
  const ms = +new Date(end) - +new Date(start);
  const hours = Math.round(ms / 3600000);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

export function ReportCard({
  report,
  href,
  variant = "default",
}: {
  report: ReportSummary;
  href: string;
  variant?: "default" | "compact";
}) {
  const totals = report.item_counts ?? {};
  const accent = REPORT_TYPE_COLOR[report.report_type];
  const dur = durationStr(report.performed_at_start, report.performed_at_end);

  return (
    <Link
      href={href}
      className={cn(
        "group relative block overflow-hidden rounded-2xl border border-slate-200 bg-white transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md",
        variant === "compact" ? "p-4" : "p-5",
      )}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: accent }}
      />

      <div className="flex items-start gap-4">
        <div
          className="flex size-11 shrink-0 items-center justify-center rounded-xl text-white"
          style={{ backgroundColor: accent }}
        >
          <ReportTypeIcon type={report.report_type} className="size-5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <ReportTypeBadge type={report.report_type} short size="sm" />
            {report.severity ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
                  SEVERITY_TINT[report.severity],
                )}
              >
                <AlertOctagon className="size-3" />
                {SEVERITY_LABEL[report.severity]}
              </span>
            ) : null}
            {report.status === "accepted" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                <CheckCircle2 className="size-3" />
                Aceptado
              </span>
            ) : null}
          </div>

          <p className="mt-2 font-semibold text-slate-900">{report.report_number}</p>
          <p className="text-sm text-slate-600">
            {formatDateLong(report.performed_at_start)}
            {report.performed_by_name ? ` · ${report.performed_by_name}` : ""}
            {dur ? ` · ${dur}` : ""}
          </p>

          {report.location_name ? (
            <p className="mt-0.5 text-xs text-slate-500">📍 {report.location_name}</p>
          ) : null}

          {report.summary_es ? (
            <p
              className={cn(
                "mt-2 text-sm leading-snug text-slate-600",
                variant === "compact" ? "line-clamp-1" : "line-clamp-2",
              )}
            >
              {report.summary_es}
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {(totals.operativo ?? 0) > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                <CheckCircle2 className="size-3" />
                {totals.operativo} óptimo
              </span>
            ) : null}
            {(totals.atencion ?? 0) > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20">
                <AlertTriangle className="size-3" />
                {totals.atencion} atención
              </span>
            ) : null}
            {(totals.critico ?? 0) > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-600/20">
                <XOctagon className="size-3" />
                {totals.critico} crítico
              </span>
            ) : null}
            {report.next_service_date ? (
              <span className="ml-auto inline-flex items-center gap-1 text-xs text-slate-500">
                <Clock className="size-3" />
                Próx: {formatDateLong(report.next_service_date)}
              </span>
            ) : null}
          </div>
        </div>

        <ChevronRight className="size-5 shrink-0 text-slate-300 transition-all group-hover:translate-x-1 group-hover:text-slate-600" />
      </div>
    </Link>
  );
}
