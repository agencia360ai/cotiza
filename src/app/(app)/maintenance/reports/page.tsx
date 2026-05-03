import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, FileText, Calendar, User } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  REPORT_TYPE_COLOR,
  REPORT_TYPE_LABEL_SHORT,
  type ReportType,
  type ReportSeverity,
} from "@/lib/maintenance/types";
import { ReportTypeIcon } from "@/components/maintenance/report-type-badge";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type ReportRow = {
  id: string;
  client_id: string;
  location_id: string | null;
  report_number: string;
  report_type: ReportType;
  severity: ReportSeverity | null;
  performed_at_start: string;
  performed_by_name: string | null;
  summary_es: string | null;
  status: "draft" | "published" | "accepted";
  ai_generated: boolean;
  ai_draft_at: string | null;
  published_at: string | null;
  created_at: string;
  client: { name: string } | null;
  location: { name: string } | null;
};

const STATUS_LABEL = {
  draft: "En revisión",
  published: "Publicado",
  accepted: "Aceptado",
};

const STATUS_TINT = {
  draft: "bg-amber-50 text-amber-700 ring-amber-600/20",
  published: "bg-blue-50 text-blue-700 ring-blue-600/20",
  accepted: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-PA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function ReportsListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: statusFilter } = await searchParams;
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) redirect("/login");

  let query = supabase
    .from("maintenance_reports")
    .select("*, client:clients(name), location:client_locations(name)")
    .order("performed_at_start", { ascending: false });

  if (statusFilter && ["draft", "published", "accepted"].includes(statusFilter)) {
    query = query.eq("status", statusFilter);
  }

  const { data: reports } = (await query) as { data: ReportRow[] | null };
  const all = reports ?? [];

  const counts = {
    draft: 0,
    published: 0,
    accepted: 0,
  };
  // Need a separate query without filter for accurate counts
  const { data: allForCounts } = (await supabase
    .from("maintenance_reports")
    .select("status")) as { data: { status: keyof typeof counts }[] | null };
  for (const r of allForCounts ?? []) counts[r.status]++;

  return (
    <div className="px-10 py-8 max-w-6xl">
      <header className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reportes de mantenimiento</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Revisá los borradores enviados por técnicos y publicalos para que el cliente los vea
          </p>
        </div>
      </header>

      {/* Status tabs */}
      <div className="mb-6 flex gap-2">
        <FilterTab
          href="/maintenance/reports"
          label="Todos"
          count={counts.draft + counts.published + counts.accepted}
          active={!statusFilter}
        />
        <FilterTab
          href="/maintenance/reports?status=draft"
          label="En revisión"
          count={counts.draft}
          active={statusFilter === "draft"}
          tint="bg-amber-50 text-amber-700 ring-amber-600/30"
        />
        <FilterTab
          href="/maintenance/reports?status=published"
          label="Publicados"
          count={counts.published}
          active={statusFilter === "published"}
          tint="bg-blue-50 text-blue-700 ring-blue-600/30"
        />
        <FilterTab
          href="/maintenance/reports?status=accepted"
          label="Aceptados"
          count={counts.accepted}
          active={statusFilter === "accepted"}
          tint="bg-emerald-50 text-emerald-700 ring-emerald-600/30"
        />
      </div>

      {all.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-20 text-center">
          <FileText className="mx-auto mb-3 size-6 text-muted-foreground" />
          <p className="text-sm font-medium">Sin reportes {statusFilter ? "en este estado" : ""}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Los técnicos crean reportes desde su portal personal
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {all.map((r) => (
            <li key={r.id}>
              <Link
                href={`/maintenance/reports/${r.id}`}
                className="group flex items-start gap-4 rounded-xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-sm"
              >
                <div
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl text-white"
                  style={{ backgroundColor: REPORT_TYPE_COLOR[r.report_type] }}
                >
                  <ReportTypeIcon type={r.report_type} className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-slate-900">{r.report_number}</p>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset",
                        STATUS_TINT[r.status],
                      )}
                    >
                      {STATUS_LABEL[r.status]}
                    </span>
                    {r.ai_generated ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700 ring-1 ring-inset ring-violet-600/20">
                        ✨ IA
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-sm text-slate-700">
                    <strong>{r.client?.name ?? "—"}</strong>
                    {r.location?.name ? ` · ${r.location.name}` : ""}
                    <span className="text-slate-500">
                      {" "}
                      · {REPORT_TYPE_LABEL_SHORT[r.report_type]}
                    </span>
                  </p>
                  <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="size-3" />
                      {formatDate(r.performed_at_start)}
                    </span>
                    {r.performed_by_name ? (
                      <span className="inline-flex items-center gap-1">
                        <User className="size-3" />
                        {r.performed_by_name}
                      </span>
                    ) : null}
                  </div>
                  {r.summary_es ? (
                    <p className="mt-2 line-clamp-1 text-xs text-slate-500">{r.summary_es}</p>
                  ) : null}
                </div>
                <ChevronRight className="size-5 shrink-0 text-slate-300 transition-transform group-hover:translate-x-1" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterTab({
  href,
  label,
  count,
  active,
  tint,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
  tint?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all",
        active
          ? "bg-slate-900 text-white"
          : tint
            ? `ring-1 ring-inset ${tint} hover:opacity-80`
            : "bg-white text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-50",
      )}
    >
      {label}
      <span
        className={cn(
          "tabular-nums",
          active ? "text-white/70" : "text-slate-400",
        )}
      >
        {count}
      </span>
    </Link>
  );
}
