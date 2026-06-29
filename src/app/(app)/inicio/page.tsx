import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Building2,
  Boxes,
  CheckCircle2,
  Calendar,
  ChevronRight,
  TrendingUp,
  Clock,
  ArrowRight,
  ArrowUpRight,
  Wrench,
  Gavel,
  HeartPulse,
  AlertTriangle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgContext } from "@/lib/org-context";
import {
  projectImageUrl,
  PROJECT_STATUS_COLOR,
  PROJECT_STATUS_LABEL,
} from "@/lib/projects/types";
import { pipelineDerived, formatMoney, type PipelineData } from "@/lib/pipeline/types";
import { getPipelineData } from "@/lib/pipeline/queries";
import { getMaintenanceSummary, colorForScore, one, type Maybe } from "@/lib/maintenance/summary";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type ProjectGridItem = {
  id: string;
  name: string;
  status: string;
  cover_photo_path: string | null;
  client: Maybe<{ name: string }>;
  location: Maybe<{ name: string }>;
  milestones: { status: string }[];
};
type ProjectRow = ProjectGridItem & {
  project_type: string;
  expected_completion_date: string | null;
  completed_at: string | null;
};

export default async function InicioDashboard() {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) redirect("/login");

  const ctx = await getActiveOrgContext();
  const orgId = ctx?.orgId ?? "";
  const { data: org } = (await supabase
    .from("organizations")
    .select("focus")
    .eq("id", orgId)
    .maybeSingle()) as { data: { focus: "maintenance" | "projects" | "mixed" } | null };
  const focus = org?.focus ?? "mixed";
  const isProjects = focus === "projects";

  const { data: projectsData } = (await supabase
    .from("client_projects")
    .select(
      "id, name, project_type, status, cover_photo_path, expected_completion_date, completed_at, client:clients(name), location:client_locations(name), milestones:project_milestones(status)",
    )
    .eq("org_id", orgId)
    .order("updated_at", { ascending: false })
    .limit(50)) as { data: ProjectRow[] | null };
  const allProjects = (projectsData ?? []) as ProjectRow[];

  const [pipeline, maint] = await Promise.all([
    isProjects ? Promise.resolve<PipelineData | null>(null) : getPipelineData(orgId),
    isProjects ? Promise.resolve(null) : getMaintenanceSummary(orgId),
  ]);

  const activeProjects = allProjects.filter((p) => p.status !== "aceptado");
  const inProgress = allProjects.filter((p) => p.status === "en_progreso");
  const upcomingDeliveries = allProjects.filter((p) => {
    if (p.status === "aceptado" || p.status === "completado") return false;
    if (!p.expected_completion_date) return false;
    const days = (+new Date(p.expected_completion_date) - Date.now()) / 86400000;
    return days >= 0 && days <= 14;
  });
  const completedRecently = allProjects.filter((p) => {
    if (p.status !== "completado" && p.status !== "aceptado") return false;
    if (!p.completed_at) return false;
    return (Date.now() - +new Date(p.completed_at)) / 86400000 <= 30;
  });

  return (
    <div className="max-w-7xl px-4 py-6 md:px-10 md:py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Resumen del negocio</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Vista macro: potenciales, proyectos{isProjects ? "" : ", mantenimiento"} y clientes.
        </p>
      </header>

      {/* Potenciales (pipeline) */}
      {pipeline ? <PotencialesBand data={pipeline} /> : null}

      {/* Proyectos */}
      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wrench className="size-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-700">Proyectos en ejecución</h2>
          </div>
          <Link href="/proyectos" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700">
            Ver todos
            <ArrowRight className="size-3.5" />
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MacroKpi label="Activos" value={activeProjects.length} icon={Wrench} accent="#0F172A" href="/proyectos" />
          <MacroKpi label="En progreso" value={inProgress.length} icon={Clock} accent="#2563EB" href="/proyectos" />
          <MacroKpi label="Próx. entregas (14d)" value={upcomingDeliveries.length} icon={Calendar} accent="#F97316" />
          <MacroKpi label="Completados (30d)" value={completedRecently.length} icon={CheckCircle2} accent="#10B981" />
        </div>
        {activeProjects.length > 0 ? (
          <div className="mt-4">
            <ProjectsGrid projects={activeProjects.slice(0, 6)} title="" />
          </div>
        ) : null}
      </section>

      {/* Pilares operativos: Mantenimiento + Clientes */}
      <section className="grid gap-4 sm:grid-cols-2">
        {maint ? (
          <Link
            href="/mantenimiento"
            className="group rounded-2xl border border-border bg-card p-5 transition-colors hover:border-slate-300 hover:bg-slate-50/50"
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                  <HeartPulse className="size-4" />
                </span>
                <h2 className="text-base font-bold text-slate-900">Mantenimiento</h2>
              </div>
              <ChevronRight className="size-4 text-slate-300 group-hover:text-slate-500" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <MiniStat label="Equipos" value={maint.totalEquipment} sub={`${maint.totalLocations} sucursales`} />
              <MiniStat
                label="Salud global"
                value={`${maint.globalHealth}%`}
                sub={`${maint.globalCounts.operativo} operativos`}
                color={colorForScore(maint.globalHealth)}
              />
              <MiniStat
                label="Alertas"
                value={maint.globalCounts.atencion + maint.globalCounts.critico}
                sub={maint.globalCounts.critico > 0 ? `${maint.globalCounts.critico} crítico${maint.globalCounts.critico === 1 ? "" : "s"}` : "atención/crítico"}
                color={maint.globalCounts.critico > 0 ? "#EF4444" : maint.globalCounts.atencion > 0 ? "#F59E0B" : "#10B981"}
              />
              <MiniStat
                label="Vencidos"
                value={maint.overdueSchedules.length}
                sub={`${maint.thisWeekSchedules.length} esta semana`}
                color={maint.overdueSchedules.length > 0 ? "#EF4444" : "#10B981"}
              />
            </div>
          </Link>
        ) : null}

        <Link
          href="/clientes"
          className="group rounded-2xl border border-border bg-card p-5 transition-colors hover:border-slate-300 hover:bg-slate-50/50"
        >
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                <Building2 className="size-4" />
              </span>
              <h2 className="text-base font-bold text-slate-900">Clientes</h2>
            </div>
            <ChevronRight className="size-4 text-slate-300 group-hover:text-slate-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <MiniStat label="Total" value={maint ? maint.clients.length : "—"} sub="cartera activa" />
            <MiniStat label="Sucursales" value={maint ? maint.totalLocations : "—"} sub="ubicaciones" />
          </div>
        </Link>
      </section>
    </div>
  );
}

function MacroKpi({
  label,
  value,
  icon: Icon,
  accent,
  href,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  href?: string;
}) {
  const inner = (
    <div className={cn("rounded-2xl border border-border bg-card p-4", href && "transition-colors hover:border-slate-300 hover:bg-slate-50/50")}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="flex size-7 items-center justify-center rounded-lg" style={{ backgroundColor: `${accent}1f`, color: accent }}>
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900 tabular-nums">{value}</p>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function MiniStat({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums" style={color ? { color } : undefined}>
        {value}
      </p>
      {sub ? <p className="text-[11px] text-slate-500">{sub}</p> : null}
    </div>
  );
}

function PotencialesBand({ data }: { data: PipelineData }) {
  const d = pipelineDerived(data);
  const items = [
    { label: "En juego", value: formatMoney(d.enJuegoMonto), sub: `${d.enJuegoCount} potenciales`, accent: "#F59E0B" },
    { label: "Aprobado", value: formatMoney(d.aprobadoMonto), sub: `${d.aprobadoCount} cotizaciones`, accent: "#10B981" },
    { label: "Por cobrar", value: String(d.porCobrar), sub: "aprobadas sin pago", accent: "#2563EB" },
    { label: "Licitaciones vivas", value: String(d.licitacionesVivas), sub: `${d.licitacionesGanadas} ganadas`, accent: "#6366F1" },
  ];
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Gavel className="size-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-700">Potenciales · pipeline comercial</h2>
        </div>
        <Link href="/potenciales" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700">
          Ver potenciales
          <ArrowRight className="size-3.5" />
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((it) => (
          <Link
            key={it.label}
            href="/potenciales"
            className="rounded-2xl border border-border bg-card p-4 transition-colors hover:border-slate-300 hover:bg-slate-50/50"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{it.label}</span>
              <span className="size-2 rounded-full" style={{ backgroundColor: it.accent }} />
            </div>
            <p className="mt-2 text-xl font-bold tracking-tight text-slate-900">{it.value}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{it.sub}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

function ProjectsGrid({
  projects,
  title = "Proyectos en curso",
  subtitle,
}: {
  projects: ProjectGridItem[];
  title?: string;
  subtitle?: string;
}) {
  if (projects.length === 0) return null;
  return (
    <section>
      {title ? (
        <header className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-slate-900">{title}</h2>
            {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
          </div>
          <Link href="/proyectos" className="text-xs font-semibold text-blue-600 hover:underline">
            Ver todos →
          </Link>
        </header>
      ) : null}
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((p) => {
          const client = one(p.client);
          const location = one(p.location);
          const total = p.milestones.length;
          const done = p.milestones.filter((m) => m.status === "completado").length;
          const pct = total === 0 ? 0 : Math.round((done / total) * 100);
          const sc = PROJECT_STATUS_COLOR[p.status as keyof typeof PROJECT_STATUS_COLOR] ?? "#64748B";
          return (
            <li key={p.id}>
              <Link
                href={`/proyectos/${p.id}`}
                className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
              >
                <div
                  className="relative aspect-[16/8] w-full bg-slate-100"
                  style={
                    p.cover_photo_path
                      ? { backgroundImage: `url(${projectImageUrl(p.cover_photo_path)})`, backgroundSize: "cover", backgroundPosition: "center" }
                      : undefined
                  }
                >
                  {!p.cover_photo_path ? (
                    <div className="flex h-full w-full items-center justify-center">
                      <Wrench className="size-7 text-slate-300" />
                    </div>
                  ) : null}
                  <span
                    className="absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ring-inset"
                    style={{ color: sc, borderColor: `${sc}20` }}
                  >
                    <span className="size-1.5 rounded-full" style={{ backgroundColor: sc }} />
                    {PROJECT_STATUS_LABEL[p.status as keyof typeof PROJECT_STATUS_LABEL] ?? p.status}
                  </span>
                </div>
                <div className="flex flex-1 flex-col p-3">
                  <p className="truncate text-sm font-semibold text-slate-900">{p.name}</p>
                  <p className="mt-0.5 truncate text-[11px] text-slate-500">
                    {client?.name ?? "—"}
                    {location ? ` · ${location.name}` : ""}
                  </p>
                  <div className="mt-2">
                    <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      <span>
                        {done}/{total} hitos
                      </span>
                      <span style={{ color: sc }}>{pct}%</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: sc }} />
                    </div>
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
