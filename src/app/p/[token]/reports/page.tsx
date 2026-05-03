import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Calendar, Wrench, PackagePlus, ClipboardList } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  REPORT_TYPE_LABEL,
  REPORT_TYPE_COLOR,
  type DashboardData,
  type ReportType,
  type ReportSummary,
} from "@/lib/maintenance/types";
import { ReportCard } from "@/components/maintenance/report-card";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

async function loadDashboard(token: string): Promise<DashboardData | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_public_dashboard", { _token: token });
  if (error || !data) return null;
  return data as DashboardData;
}

const TYPE_ICON: Record<ReportType, typeof Calendar> = {
  preventivo: Calendar,
  correctivo: Wrench,
  instalacion: PackagePlus,
  inspeccion: ClipboardList,
};

function groupByYearMonth(reports: ReportSummary[]): { key: string; label: string; reports: ReportSummary[] }[] {
  const map = new Map<string, ReportSummary[]>();
  for (const r of reports) {
    const d = new Date(r.performed_at_start);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const arr = map.get(key) ?? [];
    arr.push(r);
    map.set(key, arr);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, reports]) => {
      const [year, month] = key.split("-");
      const label = new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("es-PA", {
        month: "long",
        year: "numeric",
      });
      return { key, label, reports };
    });
}

export default async function PublicReportsListPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const { token } = await params;
  const { type: typeFilterRaw } = await searchParams;
  const data = await loadDashboard(token);
  if (!data) notFound();

  const { client, reports } = data;
  const typeFilter = (typeFilterRaw as ReportType | undefined) ?? null;

  const typeCounts: Record<ReportType, number> = {
    preventivo: 0,
    correctivo: 0,
    instalacion: 0,
    inspeccion: 0,
  };
  for (const r of reports) typeCounts[r.report_type]++;

  const filtered = typeFilter ? reports.filter((r) => r.report_type === typeFilter) : reports;
  const grouped = groupByYearMonth(filtered);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 lg:px-8 lg:py-12">
      <Link
        href={`/p/${token}`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
      >
        <ArrowLeft className="size-4" />
        Volver al portal
      </Link>

      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
          {client.name}
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
          Historial de reportes
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          {reports.length} reporte{reports.length === 1 ? "" : "s"} publicado
          {reports.length === 1 ? "" : "s"} desde el inicio del servicio
        </p>
      </header>

      {/* Type counter cards */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(["preventivo", "correctivo", "instalacion", "inspeccion"] as ReportType[]).map((t) => {
          const Icon = TYPE_ICON[t];
          const isActive = typeFilter === t;
          const accent = REPORT_TYPE_COLOR[t];
          return (
            <Link
              key={t}
              href={typeFilter === t ? `/p/${token}/reports` : `/p/${token}/reports?type=${t}`}
              className={cn(
                "group relative overflow-hidden rounded-2xl border bg-white p-4 transition-all hover:-translate-y-0.5 hover:shadow-md",
                isActive
                  ? "border-slate-900 ring-2 ring-slate-900/10"
                  : "border-slate-200 hover:border-slate-300",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "absolute inset-x-0 top-0 h-1 transition-opacity",
                  isActive ? "opacity-100" : "opacity-60 group-hover:opacity-100",
                )}
                style={{ backgroundColor: accent }}
              />
              <div className="flex items-start justify-between">
                <div
                  className="flex size-10 items-center justify-center rounded-lg"
                  style={{ backgroundColor: `${accent}1A`, color: accent }}
                >
                  <Icon className="size-5" />
                </div>
                <span
                  className="text-2xl font-bold tabular-nums"
                  style={{ color: accent }}
                >
                  {typeCounts[t]}
                </span>
              </div>
              <p className="mt-3 text-sm font-semibold text-slate-900">{REPORT_TYPE_LABEL[t]}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {isActive ? "Filtrando" : "Click para filtrar"}
              </p>
            </Link>
          );
        })}
      </div>

      {/* Filter chip if active */}
      {typeFilter ? (
        <div className="mb-4 flex items-center gap-2 text-sm text-slate-600">
          <span>Filtrando por</span>
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset"
            style={{
              backgroundColor: `${REPORT_TYPE_COLOR[typeFilter]}1A`,
              color: REPORT_TYPE_COLOR[typeFilter],
              borderColor: REPORT_TYPE_COLOR[typeFilter],
            }}
          >
            {REPORT_TYPE_LABEL[typeFilter]}
          </span>
          <Link
            href={`/p/${token}/reports`}
            className="text-xs text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline"
          >
            Limpiar
          </Link>
        </div>
      ) : null}

      {/* Timeline by month */}
      {grouped.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center">
          <p className="text-sm text-slate-500">
            No hay reportes {typeFilter ? `de tipo ${REPORT_TYPE_LABEL[typeFilter]}` : ""}
          </p>
        </div>
      ) : (
        <div className="space-y-10">
          {grouped.map((group) => (
            <div key={group.key}>
              <div className="mb-4 flex items-center gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
                  {group.label}
                </h2>
                <div className="h-px flex-1 bg-slate-200" />
                <span className="text-xs font-medium text-slate-400 tabular-nums">
                  {group.reports.length} reporte{group.reports.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="space-y-3">
                {group.reports.map((r) => (
                  <ReportCard key={r.id} report={r} href={`/p/${token}/reports/${r.id}`} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
