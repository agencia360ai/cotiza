import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlarmClock,
  ArrowRight,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock,
  Hammer,
  HeartPulse,
  Landmark,
  Receipt,
  TrendingUp,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgContext } from "@/lib/org-context";
import { pipelineDerived, formatMoney, formatMoneyExact, type PipelineData } from "@/lib/pipeline/types";
import { getPipelineData } from "@/lib/pipeline/queries";
import { groupRevisions } from "@/lib/pipeline/revisions";
import { getMaintenanceSummary, colorForScore, type Maybe } from "@/lib/maintenance/summary";
import { getQboProjects } from "@/app/(app)/proyectos/qbo-actions";
import type { QboProject } from "@/lib/quickbooks/projects";
import { tamizScore, BANDA_META } from "@/lib/panamacompra/tamiz";
import { MonthlyBarChart, RubroDonut, type MonthPoint, type DonutSlice } from "@/components/inicio/charts";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Paleta categórica del donut, validada (CVD-safe) sobre superficie clara:
// DC índigo · DM sky · DS emerald · DV amber. La identidad nunca es solo color
// (leyenda con etiquetas y %).
const DONUT_COLORS: Record<string, string> = { DC: "#6366F1", DM: "#0EA5E9", DS: "#10B981", DV: "#F59E0B" };
const RUBRO_LABEL: Record<string, string> = { DC: "Contratos", DM: "Mantenimiento", DS: "Servicio", DV: "Ventas" };

// Sweet spot por defecto del tamiz (el de la página de licitaciones es
// parametrizable por navegador; acá usamos el estándar DICEC).
const SWEET_DEFAULT = { min: 20000, max: 250000 };

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

type QuoteYearRow = {
  quote_number: string;
  sent_date: string | null;
  amount_usd: number | null;
  rubro: string | null;
  status: string;
  follow_up_date: string | null;
  client_name: string | null;
};

type GovUrgente = {
  id: string;
  num_proceso: string;
  titulo: string | null;
  entidad: string | null;
  fecha_cierre: string;
  precio_ref: number | null;
};

function relTimeEs(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 60) return `hace ${Math.max(1, m)} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

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
  const nowIso = new Date().toISOString();
  const in7dIso = new Date(Date.now() + 7 * 86400000).toISOString();

  const [{ data: projectsData }, pipeline, maint, { data: quotesYear }, qbo, { data: govData }] = await Promise.all([
    supabase
      .from("client_projects")
      .select(
        "id, name, project_type, status, cover_photo_path, expected_completion_date, completed_at, client:clients(name), location:client_locations(name), milestones:project_milestones(status)",
      )
      .eq("org_id", orgId)
      .order("updated_at", { ascending: false })
      .limit(50) as unknown as Promise<{ data: ProjectRow[] | null }>,
    isProjects ? Promise.resolve<PipelineData | null>(null) : getPipelineData(orgId, year),
    isProjects ? Promise.resolve(null) : getMaintenanceSummary(orgId),
    supabase
      .from("sales_quotes")
      .select("quote_number, sent_date, amount_usd, rubro, status, follow_up_date, client_name")
      .eq("org_id", orgId)
      .eq("year", year) as unknown as Promise<{ data: QuoteYearRow[] | null }>,
    // Finanzas QBO desde la base (cero llamadas a QuickBooks al abrir).
    getQboProjects().catch(() => ({ ok: false as const, error: "" })),
    // Licitaciones relevantes que cierran en los próximos 7 días (select angosto:
    // sin las columnas JSONB pesadas).
    supabase
      .from("gov_tenders")
      .select("id, num_proceso, titulo, entidad, fecha_cierre, precio_ref")
      .eq("org_id", orgId)
      .eq("relevante", true)
      .gte("fecha_cierre", nowIso)
      .lte("fecha_cierre", in7dIso)
      .order("fecha_cierre", { ascending: true })
      .limit(6) as unknown as Promise<{ data: GovUrgente[] | null }>,
  ]);
  const allProjects = (projectsData ?? []) as ProjectRow[];

  // Series de los charts: borradores fuera ANTES de agrupar (un borrador con nº
  // de revisión no debe esconder la rev publicada), luego solo la vigente de
  // cada base — misma lógica que la página de Cotizaciones.
  const vigentesYear = groupRevisions((quotesYear ?? []).filter((q) => q.status !== "borrador")).map((g) => g.main);
  const months: MonthPoint[] = Array.from({ length: 12 }, (_, m) => ({ month: m, monto: 0, count: 0 }));
  const rubroCount = new Map<string, number>();
  for (const q of vigentesYear) {
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

  // Seguimientos de cotizaciones enviadas: vencidos o dentro de 7 días.
  const hoy = nowIso.slice(0, 10);
  const en7d = in7dIso.slice(0, 10);
  const followUps = vigentesYear
    .filter((q) => q.status === "enviada" && q.follow_up_date && q.follow_up_date <= en7d)
    .sort((a, b) => (a.follow_up_date! < b.follow_up_date! ? -1 : 1))
    .slice(0, 5);

  // Licitaciones urgentes con score del tamiz (server-side, sweet spot estándar).
  const govUrgentes = (govData ?? []).map((g) => ({ ...g, tamiz: tamizScore(g.titulo, g.precio_ref, SWEET_DEFAULT) }));

  // Finanzas QBO del año (números ya persistidos por "Actualizar" en Proyectos).
  const qboProjects: QboProject[] = qbo.ok ? qbo.projects : [];
  const qboSyncedAt = qbo.ok ? qbo.syncedAt : null;
  const conNumeros = qboProjects.filter((p) => p.income !== null || p.cost !== null);
  const ingresos = conNumeros.reduce((a, p) => a + (p.income ?? 0), 0);
  const costos = conNumeros.reduce((a, p) => a + (p.cost ?? 0), 0);
  const margenGlobal = ingresos > 0 ? (ingresos - costos) / ingresos : null;
  const porCobrar = qboProjects.filter((p) => p.status === "por_cobrar");
  const porCobrarMonto = porCobrar.reduce((a, p) => a + (p.income ?? 0), 0);
  const topProyectos = [...conNumeros].sort((a, b) => (b.income ?? 0) - (a.income ?? 0)).slice(0, 5);
  const maxIncome = Math.max(1, ...topProyectos.map((p) => p.income ?? 0));

  const activeProjects = allProjects.filter((p) => p.status !== "aceptado");
  const inProgress = allProjects.filter((p) => p.status === "en_progreso");
  // Proyectos totales del año (QBO, abiertos), no solo los del tracking detallado
  // (que es opcional). Si no hay data de QBO, caemos a los del tracking.
  const qboOpen = qboProjects.filter((p) => !p.closed).length;
  const proyectosActivos = qboOpen > 0 ? qboOpen : activeProjects.length;
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
                label={`En juego · ${year}`}
                value={formatMoney(d.enviadaMonto)}
                sub={
                  d.licitacionesVivasMonto > 0
                    ? `${d.enviadaCount} enviadas · ${formatMoney(d.licitacionesVivasMonto)} en licitaciones`
                    : `${d.enviadaCount} enviadas sin cerrar`
                }
                icon={Clock}
                accent="#F59E0B"
                href="/potenciales"
              />
              <KpiTile
                label={`Aprobado · ${year}`}
                value={formatMoney(d.aprobadoMonto)}
                sub={`${d.aprobadoCount} cotizaciones vigentes`}
                icon={CheckCircle2}
                accent="#10B981"
                href="/potenciales"
              />
            </>
          ) : null}
          <KpiTile
            label="Proyectos activos"
            value={String(proyectosActivos)}
            sub={
              porCobrar.length > 0
                ? `${porCobrar.length} por cobrar · ${formatMoney(porCobrarMonto)}`
                : qboOpen > 0
                  ? `${inProgress.length} con tracking detallado`
                  : `${inProgress.length} en progreso`
            }
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

        {/* Hoy: finanzas QBO + lo que vence esta semana */}
        <section className="mb-6 grid gap-3 lg:grid-cols-3">
          <QboFinanzas
            year={year}
            hayData={conNumeros.length > 0}
            ingresos={ingresos}
            costos={costos}
            margen={margenGlobal}
            porCobrarCount={porCobrar.length}
            porCobrarMonto={porCobrarMonto}
            top={topProyectos}
            maxIncome={maxIncome}
            syncedAt={qboSyncedAt}
          />
          <div className="space-y-3">
            <GovUrgentesCard rows={govUrgentes} />
            {followUps.length > 0 ? <FollowUpsCard rows={followUps} hoy={hoy} /> : null}
          </div>
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

// ── Finanzas de proyectos (QBO) ───────────────────────────────────────────────
function margenMeta(m: number | null): { txt: string; cls: string } {
  if (m === null) return { txt: "—", cls: "text-slate-400" };
  const pct = Math.round(m * 100);
  if (pct >= 25) return { txt: `${pct}%`, cls: "text-emerald-700" };
  if (pct >= 10) return { txt: `${pct}%`, cls: "text-amber-700" };
  return { txt: `${pct}%`, cls: "text-rose-700" };
}

function QboFinanzas({
  year,
  hayData,
  ingresos,
  costos,
  margen,
  porCobrarCount,
  porCobrarMonto,
  top,
  maxIncome,
  syncedAt,
}: {
  year: number;
  hayData: boolean;
  ingresos: number;
  costos: number;
  margen: number | null;
  porCobrarCount: number;
  porCobrarMonto: number;
  top: QboProject[];
  maxIncome: number;
  syncedAt: number | null;
}) {
  const mg = margenMeta(margen);
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm lg:col-span-2">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <TrendingUp className="size-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Finanzas de proyectos <span className="font-normal text-slate-400">· {year}</span>
            </h2>
            <p className="text-[11px] text-slate-400">
              QuickBooks{syncedAt ? ` · actualizado ${relTimeEs(syncedAt)}` : ""}
            </p>
          </div>
        </div>
        <Link href="/proyectos" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700">
          Ver proyectos <ArrowRight className="size-3" />
        </Link>
      </div>

      {!hayData ? (
        <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          Todavía no hay números de QuickBooks para {year}. Ve a <span className="font-semibold">Proyectos</span> y toca
          &ldquo;Actualizar&rdquo; para traerlos.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MiniStat label="Ingresos" value={formatMoney(ingresos)} sub="facturado del año" color="#059669" />
            <MiniStat label="Costos" value={formatMoney(costos)} sub="gastos registrados" color="#475569" />
            <MiniStat label="Margen" value={mg.txt} sub={margen !== null ? formatMoney(ingresos - costos) : "sin datos"} color={margen !== null ? (margen >= 0.25 ? "#059669" : margen >= 0.1 ? "#B45309" : "#BE123C") : undefined} />
            <MiniStat
              label="Por cobrar"
              value={porCobrarCount}
              sub={porCobrarCount > 0 ? `${formatMoney(porCobrarMonto)} pendiente` : "nada pendiente"}
              color={porCobrarCount > 0 ? "#B45309" : "#10B981"}
            />
          </div>

          {top.length > 0 ? (
            <div className="mt-4">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Top proyectos por ingreso
              </p>
              <ul className="space-y-2">
                {top.map((p) => {
                  const m = margenMeta(p.margin);
                  const w = Math.max(2, Math.round(((p.income ?? 0) / maxIncome) * 100));
                  return (
                    <li key={p.id}>
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="min-w-0 truncate text-xs font-medium text-slate-700">
                          {p.name}
                          {p.clientName ? <span className="font-normal text-slate-400"> · {p.clientName}</span> : null}
                        </p>
                        <p className="shrink-0 text-xs tabular-nums text-slate-500">
                          <span className={cn("mr-2 font-semibold", m.cls)}>{m.txt}</span>
                          <span className="font-semibold text-slate-900">{formatMoney(p.income ?? 0)}</span>
                        </p>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-blue-500" style={{ width: `${w}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

// ── Licitaciones que cierran esta semana ──────────────────────────────────────
function GovUrgentesCard({
  rows,
}: {
  rows: (GovUrgente & { tamiz: ReturnType<typeof tamizScore> })[];
}) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <Landmark className="size-4" />
          </span>
          <h2 className="text-sm font-semibold text-slate-900">Licitaciones por cerrar</h2>
        </div>
        <Link href="/potenciales" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700">
          Ver <ArrowRight className="size-3" />
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-4 text-xs text-slate-500">
          <CheckCircle2 className="size-4 shrink-0 text-emerald-500" /> Ninguna relevante cierra en los próximos 7 días.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((g) => {
            const dias = Math.ceil((+new Date(g.fecha_cierre) - Date.now()) / 86400000);
            const banda = BANDA_META[g.tamiz.banda];
            return (
              <li key={g.id} className="rounded-xl bg-slate-50 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ring-1 ring-inset",
                      dias <= 2 ? "bg-red-50 text-red-700 ring-red-600/20" : "bg-amber-50 text-amber-700 ring-amber-600/20",
                    )}
                  >
                    <AlarmClock className="size-3" />
                    {dias <= 0 ? "cierra hoy" : `en ${dias} d`}
                  </span>
                  <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase", banda.chip)}>
                    {g.tamiz.score} · {banda.corto}
                  </span>
                </div>
                <p className="mt-1.5 text-xs font-medium leading-snug text-slate-800 line-clamp-2">{g.titulo ?? g.num_proceso}</p>
                <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                  <span className="truncate">{g.entidad ?? "—"}</span>
                  <span className="shrink-0 font-semibold tabular-nums text-slate-700">
                    {g.precio_ref !== null ? formatMoneyExact(g.precio_ref) : "—"}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Seguimientos de cotizaciones enviadas ─────────────────────────────────────
function FollowUpsCard({ rows, hoy }: { rows: QuoteYearRow[]; hoy: string }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex size-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
          <CalendarClock className="size-4" />
        </span>
        <h2 className="text-sm font-semibold text-slate-900">Seguimientos</h2>
      </div>
      <ul className="space-y-1.5">
        {rows.map((q) => {
          const vencido = q.follow_up_date! < hoy;
          return (
            <li key={q.quote_number} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-slate-800">{q.client_name ?? q.quote_number}</p>
                <p className="text-[11px] tabular-nums text-slate-400">{q.quote_number}</p>
              </div>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ring-1 ring-inset",
                  vencido ? "bg-red-50 text-red-700 ring-red-600/20" : "bg-amber-50 text-amber-700 ring-amber-600/20",
                )}
              >
                <Receipt className="size-3" />
                {vencido ? "vencido" : q.follow_up_date!.slice(5)}
              </span>
            </li>
          );
        })}
      </ul>
      <Link
        href="/potenciales"
        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700"
      >
        Ir a cotizaciones <ArrowRight className="size-3" />
      </Link>
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
