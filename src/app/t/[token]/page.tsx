import { notFound } from "next/navigation";
import Link from "next/link";
import {
  Plus,
  Wrench,
  Calendar,
  ChevronRight,
  Clock,
  Sparkles,
  CheckCircle2,
  Hourglass,
  Hammer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";
import {
  REPORT_TYPE_LABEL_SHORT,
  REPORT_TYPE_COLOR,
  SUBSTATE_LABEL,
  SUBSTATE_TINT,
  reportSubState,
  type TechnicianPortalData,
  type TechnicianDraft,
  type TechnicianSubmitted,
} from "@/lib/maintenance/types";
import {
  PROJECT_STATUS_COLOR,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_TINT,
  PROJECT_TYPE_COLOR,
  PROJECT_TYPE_LABEL,
  projectImageUrl,
  type ProjectStatus,
  type ProjectType,
} from "@/lib/projects/types";
import { ReportTypeIcon } from "@/components/maintenance/report-type-badge";

export const dynamic = "force-dynamic";

type TechProjectRow = {
  id: string;
  name: string;
  project_type: ProjectType;
  status: ProjectStatus;
  cover_photo_path: string | null;
  expected_completion_date: string | null;
  client_name: string | null;
  location_name: string | null;
  milestone_count: number;
  completed_count: number;
  updated_at: string;
};

async function loadPortal(token: string): Promise<TechnicianPortalData | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_technician_portal", { _token: token });
  if (error || !data) return null;
  return data as TechnicianPortalData;
}

async function loadTechnicianProjects(token: string): Promise<TechProjectRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_technician_projects", { _token: token });
  return (data as TechProjectRow[]) ?? [];
}

function formatDateLong(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-PA", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function relativeFromNow(iso: string | null): string {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - +new Date(iso)) / 86400000);
  if (days < 1) {
    const hours = Math.floor((Date.now() - +new Date(iso)) / 3600000);
    if (hours < 1) return "hace un momento";
    return `hace ${hours}h`;
  }
  if (days < 7) return `hace ${days}d`;
  if (days < 30) return `hace ${Math.floor(days / 7)} sem`;
  return `hace ${Math.floor(days / 30)} mes`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default async function TechnicianDashboard({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [data, projects] = await Promise.all([loadPortal(token), loadTechnicianProjects(token)]);
  if (!data) notFound();

  const { technician, clients, drafts, submitted } = data;
  const activeProjects = projects.filter((p) => p.status !== "aceptado");
  const closedProjects = projects.filter((p) => p.status === "aceptado");
  const totalEquipment = clients.reduce(
    (sum, c) => sum + c.locations.reduce((s, l) => s + l.equipment_count, 0),
    0,
  );
  const totalLocations = clients.reduce((sum, c) => sum + c.locations.length, 0);

  return (
    <>
      {/* Hero */}
      <header className="relative overflow-hidden bg-slate-950 text-white">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -top-32 size-[400px] rounded-full bg-blue-500 opacity-20 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-32 size-[400px] rounded-full bg-emerald-500 opacity-15 blur-3xl"
        />
        <div className="relative mx-auto max-w-3xl px-5 py-8 sm:py-10">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-xl bg-white/10 text-base font-bold ring-2 ring-white/15 backdrop-blur">
              {initials(technician.name)}
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-white/50">Portal personal</p>
              <p className="text-lg font-semibold tracking-tight">{technician.name}</p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-3 text-center">
            <Stat label="Clientes" value={clients.length} />
            <Stat label="Sucursales" value={totalLocations} />
            <Stat label="Equipos" value={totalEquipment} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-6 sm:py-8">
        {/* Primary CTAs: reportes + proyectos */}
        <div className="grid gap-2 sm:grid-cols-2">
          <Link
            href={`/t/${token}/new`}
            className="group flex items-center gap-3 rounded-2xl bg-slate-900 p-4 text-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg"
          >
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
              <Plus className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Nuevo reporte</p>
              <p className="text-xs text-white/60">Mantenimiento, correctivo, inspección</p>
            </div>
            <ChevronRight className="size-4 text-white/60 transition-transform group-hover:translate-x-1" />
          </Link>
          <Link
            href={`/t/${token}/projects/new`}
            className="group flex items-center gap-3 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-700 p-4 text-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg"
          >
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
              <Hammer className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Nuevo proyecto</p>
              <p className="text-xs text-white/70">Cuarto frío, obra, instalación nueva</p>
            </div>
            <ChevronRight className="size-4 text-white/70 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>

        {/* Projects in progress */}
        {activeProjects.length > 0 ? (
          <section className="mt-8">
            <header className="mb-3 flex items-center gap-2">
              <Hammer className="size-4 text-blue-600" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700">
                Proyectos en curso
              </h2>
              <span className="text-xs text-slate-500">{activeProjects.length}</span>
            </header>
            <div className="space-y-2">
              {activeProjects.map((p) => (
                <ProjectCard key={p.id} project={p} token={token} />
              ))}
            </div>
          </section>
        ) : null}

        {/* Drafts in progress */}
        {drafts.length > 0 ? (
          <section className="mt-8">
            <header className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Hourglass className="size-4 text-amber-600" />
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700">
                  En progreso
                </h2>
                <span className="text-xs text-slate-500">{drafts.length}</span>
              </div>
            </header>
            <div className="space-y-2">
              {drafts.map((d) => (
                <DraftCard key={d.id} draft={d} token={token} />
              ))}
            </div>
          </section>
        ) : null}

        {/* Recent submissions */}
        <section className="mt-8">
          <header className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-emerald-600" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700">
                Reportes enviados
              </h2>
              {submitted.length > 0 ? (
                <span className="text-xs text-slate-500">{submitted.length}</span>
              ) : null}
            </div>
          </header>
          {submitted.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-10 text-center">
              <Wrench className="mx-auto mb-2 size-6 text-slate-300" />
              <p className="text-sm text-slate-500">Aún no enviaste reportes</p>
              <p className="mt-1 text-xs text-slate-400">
                Tus reportes enviados y publicados aparecerán acá
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {submitted.map((r) => (
                <SubmittedCard key={r.id} report={r} token={token} />
              ))}
            </div>
          )}
        </section>

        {/* Closed projects */}
        {closedProjects.length > 0 ? (
          <section className="mt-8">
            <header className="mb-3 flex items-center gap-2">
              <CheckCircle2 className="size-4 text-emerald-600" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700">
                Proyectos cerrados
              </h2>
              <span className="text-xs text-slate-500">{closedProjects.length}</span>
            </header>
            <div className="space-y-2">
              {closedProjects.map((p) => (
                <ProjectCard key={p.id} project={p} token={token} />
              ))}
            </div>
          </section>
        ) : null}

        {/* Clients quick access */}
        {clients.length > 0 ? (
          <section className="mt-10">
            <header className="mb-3 flex items-center gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700">
                Clientes asignados
              </h2>
              <span className="text-xs text-slate-500">{clients.length}</span>
            </header>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {clients.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3"
                >
                  <div
                    className="flex size-10 items-center justify-center rounded-lg text-sm font-bold text-white"
                    style={{ backgroundColor: c.brand_color ?? "#0EA5E9" }}
                  >
                    {initials(c.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{c.name}</p>
                    <p className="text-xs text-slate-500">
                      {c.locations.length} sucursal{c.locations.length === 1 ? "" : "es"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 backdrop-blur">
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-white/60">{label}</p>
    </div>
  );
}

function DraftCard({ draft, token }: { draft: TechnicianDraft; token: string }) {
  const accent = REPORT_TYPE_COLOR[draft.report_type];
  const substate = reportSubState({
    status: draft.status ?? "draft",
    ai_draft_at: draft.ai_draft_at,
    performed_at_end: draft.performed_at_end,
  });
  // Recently active = updated in last hour AND still capturando
  const minutesSinceEdit = (Date.now() - +new Date(draft.updated_at)) / 60000;
  const isActive = substate === "capturando" && minutesSinceEdit < 60;
  const borderColor =
    substate === "capturando"
      ? "border-violet-200 bg-violet-50/40"
      : substate === "generado"
        ? "border-amber-200 bg-amber-50/40"
        : "border-orange-200 bg-orange-50/40";
  return (
    <Link
      href={`/t/${token}/reports/${draft.id}`}
      className={cn(
        "group block overflow-hidden rounded-2xl border transition-all hover:-translate-y-0.5 hover:shadow-md",
        borderColor,
      )}
    >
      <div className="flex items-start gap-3 p-4">
        <div
          className="relative flex size-11 shrink-0 items-center justify-center rounded-xl text-white"
          style={{ backgroundColor: accent }}
        >
          <ReportTypeIcon type={draft.report_type} className="size-5" />
          {isActive ? (
            <span className="absolute -right-0.5 -top-0.5 inline-flex size-3 rounded-full bg-emerald-500 ring-2 ring-white">
              <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500 opacity-75" />
            </span>
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-semibold text-slate-900">{draft.client_name}</p>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset",
                SUBSTATE_TINT[substate],
              )}
            >
              {substate === "generado" ? <Sparkles className="size-2.5" /> : null}
              {SUBSTATE_LABEL[substate]}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            {draft.location_name ?? "Todas las sucursales"} ·{" "}
            {REPORT_TYPE_LABEL_SHORT[draft.report_type]}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" />
              {relativeFromNow(draft.updated_at)}
            </span>
            <span>·</span>
            <span>
              {draft.capture_count} captura{draft.capture_count === 1 ? "" : "s"}
            </span>
            {draft.item_count > 0 ? (
              <>
                <span>·</span>
                <span>{draft.item_count} equipos</span>
              </>
            ) : null}
            {substate === "en_revision" ? (
              <>
                <span>·</span>
                <span className="font-semibold text-orange-700">esperando admin</span>
              </>
            ) : null}
          </div>
        </div>
        <ChevronRight className="size-5 shrink-0 text-slate-300 transition-transform group-hover:translate-x-1" />
      </div>
    </Link>
  );
}

function ProjectCard({ project, token }: { project: TechProjectRow; token: string }) {
  const accent = PROJECT_TYPE_COLOR[project.project_type];
  const total = project.milestone_count;
  const done = project.completed_count;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <Link
      href={`/t/${token}/projects/${project.id}`}
      className="group flex items-center gap-3 overflow-hidden rounded-2xl border border-slate-200 bg-white transition-all hover:-translate-y-0.5 hover:shadow-md"
    >
      <div
        className="relative flex size-20 shrink-0 items-center justify-center bg-slate-100"
        style={{
          backgroundImage: project.cover_photo_path
            ? `url(${projectImageUrl(project.cover_photo_path)})`
            : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        {!project.cover_photo_path ? <Hammer className="size-6 text-slate-300" /> : null}
      </div>
      <div className="min-w-0 flex-1 py-3 pr-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-semibold text-slate-900">{project.name}</p>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ring-inset",
              PROJECT_STATUS_TINT[project.status],
            )}
          >
            {PROJECT_STATUS_LABEL[project.status]}
          </span>
        </div>
        <p className="truncate text-xs text-slate-500">
          {project.client_name ?? "—"}
          {project.location_name ? ` · ${project.location_name}` : ""}
          {" · "}
          <span style={{ color: accent }} className="font-semibold">
            {PROJECT_TYPE_LABEL[project.project_type]}
          </span>
        </p>
        <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full"
              style={{ width: `${pct}%`, backgroundColor: PROJECT_STATUS_COLOR[project.status] }}
            />
          </div>
          <span className="tabular-nums">
            {done}/{total} · {pct}%
          </span>
        </div>
      </div>
      <ChevronRight className="size-5 shrink-0 self-center pr-3 text-slate-300 transition-transform group-hover:translate-x-1" />
    </Link>
  );
}

function SubmittedCard({ report, token }: { report: TechnicianSubmitted; token: string }) {
  const accent = REPORT_TYPE_COLOR[report.report_type];
  const statusLabel: Record<typeof report.status, string> = {
    draft: "En revisión",
    published: "Publicado",
    accepted: "Aceptado",
  };
  const statusTint: Record<typeof report.status, string> = {
    draft: "bg-amber-50 text-amber-700 ring-amber-600/20",
    published: "bg-blue-50 text-blue-700 ring-blue-600/20",
    accepted: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  };
  return (
    <Link
      href={`/t/${token}/reports/${report.id}`}
      className="group block overflow-hidden rounded-2xl border border-slate-200 bg-white transition-all hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-start gap-3 p-4">
        <div
          className="flex size-10 shrink-0 items-center justify-center rounded-xl text-white"
          style={{ backgroundColor: accent }}
        >
          <ReportTypeIcon type={report.report_type} className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-semibold text-slate-900">{report.client_name}</p>
            <span
              className={cn(
                "inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset",
                statusTint[report.status],
              )}
            >
              {statusLabel[report.status]}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            {report.location_name ?? "—"} ·{" "}
            {REPORT_TYPE_LABEL_SHORT[report.report_type]}
          </p>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
            <Calendar className="size-3" />
            {formatDateLong(report.performed_at_start)}
          </div>
        </div>
      </div>
    </Link>
  );
}
