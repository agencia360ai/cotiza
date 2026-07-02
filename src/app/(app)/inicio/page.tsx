import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Building2,
  CheckCircle2,
  ChevronRight,
  Clock,
  ArrowRight,
  Wrench,
  HeartPulse,
  Hammer,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgContext } from "@/lib/org-context";
import { projectImageUrl, PROJECT_STATUS_COLOR, PROJECT_STATUS_LABEL } from "@/lib/projects/types";
import { pipelineDerived, formatMoney, type PipelineData } from "@/lib/pipeline/types";
import { getPipelineData } from "@/lib/pipeline/queries";
import { getMaintenanceSummary, colorForScore, one, type Maybe } from "@/lib/maintenance/summary";
import { MonthlyBarChart, RubroDonut, type MonthPoint, type DonutSlice } from "@/components/inicio/charts";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Paleta categórica del donut, validada (CVD-safe) sobre superficie clara:
// DC índigo · DM sky · DS emerald · DV amber. La identidad nunca es solo color
// (leyenda con etiquetas y %).
const DONUT_COLORS: Record<string, string> = { DC: "#6366F1", DM: "#0EA5E9", DS: "#10B981", DV: "#F59E0B" };
const RUBRO_LABEL: Record<string, string> = { DC: "Contratos", DM: "Mantenimiento", DS: "Servicio", DV: "Ventas" };

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
  const year = new Date().getFullYear();

  const [{ data: projectsData }, pipeline, maint, { data: quotesYear }] = await Promise.all([
    supabase
      .from("client_projects")
      .select(
        "id, name, project_type, status, cover_photo_path, expected_completion_date, completed_at, client:clients(name), location:client_locations(name), milestones:project_milestones(status)",
      )
      .eq("org_id", orgId)
      .order("updated_at", { ascending: false })
      .limit(50) as unknown as Promise<{ data: ProjectRow[] | null }>,
    isProjects ? Promise.resolve<PipelineData | null>(null) : getPipelineData(orgId),
    isProjects ? Promise.resolve(null) : getMaintenanceSummary(orgId),
    supabase
      .from("sales_quotes")
      .select("sent_date, amount_usd, rubro, status")
      .eq("org_id", orgId)
      .eq("year", year) as unknown as Promise<{
      data: { sent_date: string | null; amount_usd: number | null; rubro: string | null; status: string }[] | null;
    }>,
  ]);
  const allProjects = (projectsData ?? []) as ProjectRow[];

  // Series de los charts (borradores fuera: aún no son cotizaciones reales).
  const months: MonthPoint[] = Array.from({ length: 12 }, (_, m) => ({ month: m, monto: 0, count: 0 }));
  const rubroCount = new Map<string, number>();
  for (const q of quotesYear ?? []) {
    if (q.status === "borrador") continue;
    if (q.sent_date) {
      const m = Number(q.sent_date.slice(5, 7)) - 1;
      if (m >= 0 && m < 12) {
        months[m].monto += Number(q.amount_usd) || 0;
        months[m].count += 1;
      }
    }
    if (q.rubro) rubroCount.set(q.rubro, (rubroCount.get(q.rubro) ?? 0) + 1);
  }
  const donutSlices: DonutSlice[] = (["DC", "DM", "DS", "DV"] as const).map((k) => ({
    key: k,
    label: RUBRO_LABEL[k],
    color: DONUT_COLORS[k],
    value: rubroCount.get(k) ?? 0,
  }));

  const activeProjects = allProjects.filter((p) => p.status !== "aceptado");
  const inProgress = allProjects.filter((p) => p.status === "en_progreso");
  const d = pipeline ? pipelineDerived(pipeline) : null;
  const alertas = maint ? maint.globalCounts.atencion + maint.globalCounts.critico : 0;

  return (
    <div className="min-h-full bg-slate-50/70">
      <div className="max-w-7xl px-4 py-6 md:px-10 md:py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Resumen del negocio</h1>
          <p className="mt-1 text-sm text-slate-500">Lo importante de hoy, de un vistazo.</p>
        </header>

        {/* KPI tiles */}
        <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {d ? (
            <>
              <KpiTile
                label="En juego"
                value={formatMoney(d.enJuegoMonto)}
                sub={`${d.enJuegoCount} enviadas sin cerrar`}
                icon={Clock}
                accent="#F59E0B"
                href="/potenciales"
              />
              <KpiTile
                label="Aprobado"
                value={formatMoney(d.aprobadoMonto)}
                sub={`${d.aprobadoCount} cotizaciones`}
                icon={CheckCircle2}
                accent="#10B981"
                href="/potenciales"
              />
            </>
          ) : null}
          <KpiTile
            label="Proyectos activos"
            value={String(activeProjects.length)}
            sub={`${inProgress.length} en progreso`}
            icon={Hammer}
            accent="#2563EB"
            href="/proyectos"
          />
          {maint ? (
            <KpiTile
              label="Salud mantenimiento"
              value={`${maint.globalHealth}%`}
              sub={alertas > 0 ? `${alertas} alerta${alertas === 1 ? "" : "s"}` : "todo operativo"}
              icon={HeartPulse}
              accent={colorForScore(maint.globalHealth)}
              href="/mantenimiento"
            />
          ) : null}
        </section>

        {/* Charts */}
        {pipeline ? (
          <section className="mb-6 grid gap-3 lg:grid-cols-3">
            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm lg:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">
                  Cotizaciones por mes <span className="font-normal text-slate-400">· {year}</span>
                </h2>
                <Link href="/potenciales" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700">
                  Ver todas <ArrowRight className="size-3" />
                </Link>
              </div>
              <MonthlyBarChart data={months} year={year} />
            </div>
            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">
                Por rubro <span className="font-normal text-slate-400">· {year}</span>
              </h2>
              <RubroDonut slices={donutSlices} title={`Distribución por rubro ${year}`} />
            </div>
          </section>
        ) : null}

        {/* Proyectos en ejecución */}
        {activeProjects.length > 0 ? (
          <section className="mb-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Proyectos en ejecución</h2>
              <Link href="/proyectos" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700">
                Ver todos <ArrowRight className="size-3" />
              </Link>
            </div>
            <ProjectsGrid projects={activeProjects.slice(0, 3)} />
          </section>
        ) : null}

        {/* Pilares: Mantenimiento + Clientes */}
        <section className="grid gap-3 sm:grid-cols-2">
          {maint ? (
            <Link
              href="/mantenimiento"
              className="group cursor-pointer rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                    <HeartPulse className="size-4" />
                  </span>
                  <h2 className="text-sm font-semibold text-slate-900">Mantenimiento</h2>
                </div>
                <ChevronRight className="size-4 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-500" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <MiniStat label="Equipos" value={maint.totalEquipment} sub={`${maint.totalLocations} sucursales`} />
                <MiniStat label="Salud" value={`${maint.globalHealth}%`} sub={`${maint.globalCounts.operativo} operativos`} color={colorForScore(maint.globalHealth)} />
                <MiniStat
                  label="Alertas"
                  value={alertas}
                  sub={maint.globalCounts.critico > 0 ? `${maint.globalCounts.critico} crítico${maint.globalCounts.critico === 1 ? "" : "s"}` : "atención/crítico"}
                  color={maint.globalCounts.critico > 0 ? "#EF4444" : alertas > 0 ? "#F59E0B" : "#10B981"}
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
            className="group cursor-pointer rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex size-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                  <Building2 className="size-4" />
                </span>
                <h2 className="text-sm font-semibold text-slate-900">Clientes</h2>
              </div>
              <ChevronRight className="size-4 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-500" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <MiniStat label="Cartera" value={maint ? maint.clients.length : "—"} sub="clientes" />
              <MiniStat label="Sucursales" value={maint ? maint.totalLocations : "—"} sub="ubicaciones" />
            </div>
          </Link>
        </section>
      </div>
    </div>
  );
}

function KpiTile({
  label,
  value,
  sub,
  icon: Icon,
  accent,
  href,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group cursor-pointer rounded-2xl border border-slate-100 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${accent}17`, color: accent }}>
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-slate-500">{label}</p>
          <p className="mt-0.5 truncate text-xl font-bold tracking-tight text-slate-900 tabular-nums sm:text-2xl">{value}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between text-[11px]">
        <span className="truncate text-slate-500">{sub}</span>
        <span className="ml-2 shrink-0 font-semibold text-blue-600 opacity-0 transition-opacity group-hover:opacity-100">Ver →</span>
      </div>
    </Link>
  );
}

function MiniStat({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums" style={color ? { color } : undefined}>
        {value}
      </p>
      {sub ? <p className="text-[11px] text-slate-500">{sub}</p> : null}
    </div>
  );
}

function ProjectsGrid({ projects }: { projects: ProjectGridItem[] }) {
  if (projects.length === 0) return null;
  return (
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
              className="group flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
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
                <p className={cn("mt-0.5 truncate text-[11px] text-slate-500")}>
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
  );
}
