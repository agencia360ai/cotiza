import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, FileText, Calendar, User, Plus, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  REPORT_TYPE_COLOR,
  REPORT_TYPE_LABEL_SHORT,
  SUBSTATE_LABEL,
  SUBSTATE_TINT,
  reportSubState,
  type ReportType,
  type ReportSeverity,
  type ReportSubState,
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
  performed_at_end: string | null;
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
  searchParams: Promise<{ sub?: string }>;
}) {
  const { sub: subFilterRaw } = await searchParams;
  const validSubs: ReportSubState[] = ["capturando", "generado", "en_revision", "publicado", "aceptado"];
  const subFilter = (validSubs as string[]).includes(subFilterRaw ?? "") ? (subFilterRaw as ReportSubState) : null;
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) redirect("/login");

  // Fetch all and filter in memory by sub-state (so counts are exact)
  const { data: reports } = (await supabase
    .from("maintenance_reports")
    .select("*, client:clients(name), location:client_locations(name)")
    .order("performed_at_start", { ascending: false })) as { data: ReportRow[] | null };
  const allReports = reports ?? [];

  const subOf = (r: ReportRow) =>
    reportSubState({
      status: r.status,
      ai_draft_at: r.ai_draft_at,
      performed_at_end: r.performed_at_end,
    });

  const counts: Record<ReportSubState, number> = {
    capturando: 0,
    generado: 0,
    en_revision: 0,
    publicado: 0,
    aceptado: 0,
  };
  for (const r of allReports) counts[subOf(r)]++;

  const all = subFilter ? allReports.filter((r) => subOf(r) === subFilter) : allReports;

  return (
    <div className="px-4 py-6 md:px-10 md:py-8 max-w-6xl">
      <header className="mb-8 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reportes de mantenimiento</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Revisá borradores, editá campos e items, o creá un reporte manualmente
          </p>
        </div>
        <Link
          href="/maintenance/reports/new"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          <Plus className="size-4" />
          <span className="hidden sm:inline">Nuevo reporte</span>
          <span className="sm:hidden">Nuevo</span>
        </Link>
      </header>

      {/* Sub-state filter chips */}
      <div className="mb-6 flex flex-wrap gap-2">
        <FilterTab
          href="/maintenance/reports"
          label="Todos"
          count={allReports.length}
          active={!subFilter}
        />
        {(["capturando", "generado", "en_revision", "publicado", "aceptado"] as ReportSubState[]).map((s) => (
          <FilterTab
            key={s}
            href={`/maintenance/reports?sub=${s}`}
            label={SUBSTATE_LABEL[s]}
            count={counts[s]}
            active={subFilter === s}
            tint={SUBSTATE_TINT[s].replace(/ring-[a-z]+-[0-9]+\/[0-9]+/, "ring-slate-300/30")}
          />
        ))}
      </div>

      {subFilter === "capturando" ? (
        <p className="mb-4 rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-800 ring-1 ring-inset ring-violet-200">
          <strong>Capturando:</strong> el técnico está cargando info, todavía no procesó con IA. Visible aquí para que veas el progreso, pero <strong>no actúes</strong> hasta que esté en &ldquo;Listo para publicar&rdquo;.
        </p>
      ) : subFilter === "generado" ? (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
          <strong>IA generada:</strong> el técnico ya procesó con IA, está revisando los items antes de enviar.
        </p>
      ) : subFilter === "en_revision" ? (
        <p className="mb-4 rounded-lg bg-orange-50 px-3 py-2 text-xs text-orange-800 ring-1 ring-inset ring-orange-200">
          <strong>Listo para publicar:</strong> el técnico envió, esperando que vos publiques para que el cliente lo vea.
        </p>
      ) : null}

      {all.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-20 text-center">
          <FileText className="mx-auto mb-3 size-6 text-muted-foreground" />
          <p className="text-sm font-medium">Sin reportes {subFilter ? "en este estado" : ""}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Los técnicos crean reportes desde su portal personal
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {all.map((r) => {
            const sub = subOf(r);
            return (
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
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset",
                        SUBSTATE_TINT[sub],
                      )}
                    >
                      {sub === "generado" ? <Sparkles className="size-2.5" /> : null}
                      {SUBSTATE_LABEL[sub]}
                    </span>
                    {r.ai_generated && sub !== "generado" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700 ring-1 ring-inset ring-violet-600/20">
                        <Sparkles className="size-2.5" />
                        IA
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
            );
          })}
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
