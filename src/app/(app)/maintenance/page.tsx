import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Building2,
  Boxes,
  CheckCircle2,
  AlertTriangle,
  XOctagon,
  AlertOctagon,
  Calendar,
  ChevronRight,
  TrendingUp,
  ClipboardCheck,
  Tag,
  Clock,
  ArrowRight,
  Wrench,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgContext } from "@/lib/org-context";
import { projectImageUrl } from "@/lib/projects/types";
import {
  STATUS_COLOR,
  CATEGORY_LABEL,
  REPORT_TYPE_COLOR,
  REPORT_TYPE_LABEL_SHORT,
  type EquipmentStatus,
  type ClientCategory,
  type ReportType,
  imageUrl,
} from "@/lib/maintenance/types";
import { ReportTypeIcon } from "@/components/maintenance/report-type-badge";
import { StackedStatusBar } from "@/components/maintenance/charts";
import { pipelineDerived, formatMoney } from "@/lib/pipeline/types";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type ClientRow = {
  id: string;
  name: string;
  category: ClientCategory | null;
  brand_color: string | null;
  logo_path: string | null;
};
type LocationRow = { id: string; client_id: string };
type EquipmentRow = { id: string; location_id: string };
type ItemRow = {
  equipment_id: string;
  equipment_status: EquipmentStatus;
  report: { client_id: string; performed_at_start: string; status: string }[] | { client_id: string; performed_at_start: string; status: string } | null;
};
type Maybe<T> = T | T[] | null;
function one<T>(v: Maybe<T>): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}
type ScheduleRow = {
  id: string;
  client_id: string;
  next_due_date: string;
  report_type: ReportType;
  client: Maybe<{ name: string }>;
  location: Maybe<{ name: string }>;
  technician: Maybe<{ name: string }>;
};
type RecentReport = {
  id: string;
  report_number: string;
  report_type: ReportType;
  status: "draft" | "published" | "accepted";
  performed_at_start: string;
  performed_by_name: string | null;
  client: Maybe<{ name: string; brand_color: string | null }>;
  location: Maybe<{ name: string }>;
};

function bucketStatus(): Record<EquipmentStatus, number> {
  return { operativo: 0, atencion: 0, critico: 0, fuera_de_servicio: 0, sin_inspeccion: 0 };
}

function relativeUntil(iso: string | null): string {
  if (!iso) return "—";
  const days = Math.floor((+new Date(iso) - Date.now()) / 86400000);
  if (days < 0) return `vencido ${Math.abs(days)}d`;
  if (days === 0) return "hoy";
  if (days < 30) return `en ${days}d`;
  if (days < 365) return `en ${Math.floor(days / 30)} mes`;
  return `en ${Math.floor(days / 365)} año`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-PA", { day: "2-digit", month: "short", year: "numeric" });
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

const STATUS_WEIGHT: Record<EquipmentStatus, number> = {
  operativo: 100,
  atencion: 60,
  critico: 20,
  fuera_de_servicio: 0,
  sin_inspeccion: 50,
};

function healthScore(counts: Record<EquipmentStatus, number>): number {
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  if (total === 0) return 0;
  const weighted =
    counts.operativo * STATUS_WEIGHT.operativo +
    counts.atencion * STATUS_WEIGHT.atencion +
    counts.critico * STATUS_WEIGHT.critico +
    counts.fuera_de_servicio * STATUS_WEIGHT.fuera_de_servicio +
    counts.sin_inspeccion * STATUS_WEIGHT.sin_inspeccion;
  return Math.round(weighted / total);
}

function colorForScore(score: number): string {
  if (score >= 85) return "#10B981";
  if (score >= 65) return "#84CC16";
  if (score >= 45) return "#F59E0B";
  if (score >= 25) return "#F97316";
  return "#EF4444";
}

export default async function MaintenanceDashboard() {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) redirect("/login");

  // Read active org focus to decide layout
  const ctx = await getActiveOrgContext();
  const { data: org } = (await supabase
    .from("organizations")
    .select("focus")
    .eq("id", ctx?.orgId ?? "")
    .maybeSingle()) as { data: { focus: "maintenance" | "projects" | "mixed" } | null };
  const focus = org?.focus ?? "mixed";

  const orgId = ctx?.orgId ?? "";

  const [
    clientsRes,
    locationsRes,
    equipmentRes,
    itemsRes,
    schedulesRes,
    reportsRes,
    techsRes,
    projectsRes,
  ] = await Promise.all([
    supabase.from("clients").select("id, name, category, brand_color, logo_path").eq("org_id", orgId).order("name"),
    supabase
      .from("client_locations")
      .select("id, client_id, client:clients!inner(org_id)")
      .eq("client.org_id", orgId),
    supabase
      .from("client_equipment")
      .select("id, location_id, location:client_locations!inner(client:clients!inner(org_id))")
      .eq("location.client.org_id", orgId),
    supabase
      .from("report_items")
      .select("equipment_id, equipment_status, report:maintenance_reports!inner(client_id, performed_at_start, status, org_id)")
      .in("report.status", ["published", "accepted"])
      .eq("report.org_id", orgId),
    supabase
      .from("maintenance_schedules")
      .select(
        "*, client:clients(name), location:client_locations(name), technician:technicians(name)",
      )
      .eq("org_id", orgId)
      .eq("active", true)
      .order("next_due_date", { ascending: true }),
    supabase
      .from("maintenance_reports")
      .select(
        "id, report_number, report_type, status, performed_at_start, performed_by_name, client:clients(name, brand_color), location:client_locations(name)",
      )
      .eq("org_id", orgId)
      .order("updated_at", { ascending: false })
      .limit(8),
    supabase.from("technicians").select("id, name").eq("org_id", orgId).eq("active", true),
    supabase
      .from("client_projects")
      .select(
        "id, name, project_type, status, cover_photo_path, expected_completion_date, completed_at, client:clients(name), location:client_locations(name), milestones:project_milestones(status)",
      )
      .eq("org_id", orgId)
      .order("updated_at", { ascending: false })
      .limit(50),
  ]);

  const allClients = (clientsRes.data ?? []) as ClientRow[];
  const allLocations = (locationsRes.data ?? []) as LocationRow[];
  const allEquipment = (equipmentRes.data ?? []) as EquipmentRow[];
  const allItems = (itemsRes.data ?? []) as unknown as ItemRow[];
  const allSchedules = (schedulesRes.data ?? []) as unknown as ScheduleRow[];
  const reports = (reportsRes.data ?? []) as unknown as RecentReport[];
  const allTechs = techsRes.data ?? [];
  type ProjectRow = {
    id: string;
    name: string;
    project_type: string;
    status: string;
    cover_photo_path: string | null;
    expected_completion_date: string | null;
    completed_at: string | null;
    client: Maybe<{ name: string }>;
    location: Maybe<{ name: string }>;
    milestones: { status: string }[];
  };
  const allProjects = (projectsRes.data ?? []) as unknown as ProjectRow[];
  const activeProjects = allProjects.filter((p) => p.status !== "aceptado");
  const inProgressProjects = allProjects.filter((p) => p.status === "en_progreso");
  const completedRecently = allProjects.filter((p) => {
    if (p.status !== "completado" && p.status !== "aceptado") return false;
    if (!p.completed_at) return false;
    const days = (Date.now() - +new Date(p.completed_at)) / 86400000;
    return days <= 30;
  });
  const upcomingDeliveries = allProjects.filter((p) => {
    if (p.status === "aceptado" || p.status === "completado") return false;
    if (!p.expected_completion_date) return false;
    const days = (+new Date(p.expected_completion_date) - Date.now()) / 86400000;
    return days >= 0 && days <= 14;
  });

  // Compute latest status per equipment
  const latestStatusByEquipment = new Map<string, { status: EquipmentStatus; date: string }>();
  for (const it of allItems) {
    const reportObj = Array.isArray(it.report) ? it.report[0] : it.report;
    if (!reportObj) continue;
    const cur = latestStatusByEquipment.get(it.equipment_id);
    if (!cur || reportObj.performed_at_start > cur.date) {
      latestStatusByEquipment.set(it.equipment_id, {
        status: it.equipment_status,
        date: reportObj.performed_at_start,
      });
    }
  }

  // Compute per-client summary
  const locationsByClient = new Map<string, LocationRow[]>();
  for (const l of allLocations) {
    const arr = locationsByClient.get(l.client_id) ?? [];
    arr.push(l);
    locationsByClient.set(l.client_id, arr);
  }
  const equipmentByLocation = new Map<string, EquipmentRow[]>();
  for (const e of allEquipment) {
    const arr = equipmentByLocation.get(e.location_id) ?? [];
    arr.push(e);
    equipmentByLocation.set(e.location_id, arr);
  }

  type ClientSummary = ClientRow & {
    locationsCount: number;
    equipmentCount: number;
    counts: Record<EquipmentStatus, number>;
    health: number;
    lastInspection: string | null;
    nextSchedule: string | null;
    overdueCount: number;
  };

  const clientSummaries: ClientSummary[] = allClients.map((c) => {
    const locs = locationsByClient.get(c.id) ?? [];
    const eqs = locs.flatMap((l) => equipmentByLocation.get(l.id) ?? []);
    const counts = bucketStatus();
    let lastInspection: string | null = null;
    for (const e of eqs) {
      const s = latestStatusByEquipment.get(e.id);
      if (s) {
        counts[s.status]++;
        if (!lastInspection || s.date > lastInspection) lastInspection = s.date;
      } else {
        counts.sin_inspeccion++;
      }
    }
    const clientSchedules = allSchedules.filter((s) => s.client_id === c.id);
    const nextSchedule = clientSchedules.length > 0 ? clientSchedules[0].next_due_date : null;
    const overdueCount = clientSchedules.filter((s) => new Date(s.next_due_date) < new Date()).length;
    return {
      ...c,
      locationsCount: locs.length,
      equipmentCount: eqs.length,
      counts,
      health: healthScore(counts),
      lastInspection,
      nextSchedule,
      overdueCount,
    };
  });

  // Sort: critical first, then by alerts, then by name
  clientSummaries.sort((a, b) => {
    if (b.counts.critico !== a.counts.critico) return b.counts.critico - a.counts.critico;
    if (b.counts.atencion !== a.counts.atencion) return b.counts.atencion - a.counts.atencion;
    if (b.overdueCount !== a.overdueCount) return b.overdueCount - a.overdueCount;
    return a.name.localeCompare(b.name);
  });

  // Global aggregates
  const globalCounts = bucketStatus();
  for (const cs of clientSummaries) {
    for (const k of Object.keys(globalCounts) as EquipmentStatus[]) {
      globalCounts[k] += cs.counts[k];
    }
  }
  const totalEquipment = Object.values(globalCounts).reduce((s, n) => s + n, 0);
  const globalHealth = healthScore(globalCounts);

  // Schedules buckets
  const overdueSchedules = allSchedules.filter((s) => new Date(s.next_due_date) < new Date());
  const thisWeekSchedules = allSchedules.filter((s) => {
    const d = new Date(s.next_due_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const week = new Date(today);
    week.setDate(week.getDate() + 7);
    return d >= today && d <= week;
  });

  const draftReports = reports.filter((r) => r.status === "draft");

  const isProjectsFocus = focus === "projects";

  return (
    <div className="px-4 py-6 md:px-10 md:py-8 max-w-7xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Resumen del negocio</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isProjectsFocus
            ? "Estado de todos tus proyectos en curso, próximas entregas y clientes"
            : "Estado global de todos tus clientes y mantenimientos"}
        </p>
      </header>

      {/* Potenciales band — pipeline comercial (snapshot Excel, vivo en Fase C) */}
      {!isProjectsFocus ? <PotencialesBand /> : null}

      {/* Projects KPI Strip — focus='projects' */}
      {isProjectsFocus ? (
        <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard label="Proyectos activos" value={activeProjects.length} icon={Wrench} accent="#0F172A" href="/maintenance/projects" />
          <KpiCard label="En progreso" value={inProgressProjects.length} icon={Clock} accent="#2563EB" href="/maintenance/projects" />
          <KpiCard label="Próx. entregas (14d)" value={upcomingDeliveries.length} icon={Calendar} accent="#F97316" />
          <KpiCard label="Completados (30d)" value={completedRecently.length} icon={CheckCircle2} accent="#10B981" />
        </section>
      ) : null}

      {/* Projects in progress — moved up when focus='projects' */}
      {isProjectsFocus && activeProjects.length > 0 ? (
        <ProjectsGrid projects={activeProjects.slice(0, 9)} />
      ) : null}

      {/* Maintenance KPI Strip — focus≠'projects' */}
      {!isProjectsFocus ? (
        <>
          {/* KPI Strip */}
      <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        <KpiCard
          label="Clientes"
          value={allClients.length}
          icon={Building2}
          accent="#0F172A"
          href="/maintenance/clients"
        />
        <KpiCard
          label="Equipos"
          value={totalEquipment}
          icon={Boxes}
          accent="#0F172A"
          hint={`${allLocations.length} sucursales`}
        />
        <KpiCard
          label="Salud global"
          value={`${globalHealth}%`}
          icon={TrendingUp}
          accent={colorForScore(globalHealth)}
          hint={`${globalCounts.operativo} operativos`}
        />
        <KpiCard
          label="Alertas"
          value={globalCounts.atencion + globalCounts.critico}
          icon={AlertTriangle}
          accent={
            globalCounts.critico > 0
              ? STATUS_COLOR.critico
              : globalCounts.atencion > 0
                ? STATUS_COLOR.atencion
                : "#10B981"
          }
          hint={
            globalCounts.critico > 0
              ? `${globalCounts.critico} crítico${globalCounts.critico === 1 ? "" : "s"}`
              : globalCounts.atencion > 0
                ? `${globalCounts.atencion} atención`
                : "Todo operativo"
          }
        />
        <KpiCard
          label="Vencidos"
          value={overdueSchedules.length}
          icon={AlertOctagon}
          accent={overdueSchedules.length > 0 ? "#EF4444" : "#10B981"}
          hint={`${thisWeekSchedules.length} esta semana`}
          href="/maintenance/schedule"
        />
      </section>

      {/* Distribution + Quick actions */}
      <section className="mb-8 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Distribución de estados</h2>
            <p className="text-xs text-slate-500">{totalEquipment} equipos en total</p>
          </div>
          {totalEquipment === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              Sin equipos cargados todavía
            </p>
          ) : (
            <>
              <StackedStatusBar counts={globalCounts} />
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                {(
                  [
                    ["operativo", "Operativo", CheckCircle2],
                    ["atencion", "Atención", AlertTriangle],
                    ["critico", "Crítico", XOctagon],
                    ["fuera_de_servicio", "Fuera servicio", AlertOctagon],
                    ["sin_inspeccion", "Sin inspección", Clock],
                  ] as [EquipmentStatus, string, typeof CheckCircle2][]
                ).map(([k, label, Icon]) => (
                  <div key={k} className="rounded-lg bg-slate-50 p-3">
                    <div className="flex items-center gap-1.5">
                      <Icon className="size-3.5" style={{ color: STATUS_COLOR[k] }} />
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
                    </div>
                    <p className="mt-1 text-xl font-bold tabular-nums" style={{ color: STATUS_COLOR[k] }}>
                      {globalCounts[k]}
                    </p>
                    <p className="text-[11px] text-slate-500 tabular-nums">
                      {totalEquipment > 0 ? Math.round((globalCounts[k] / totalEquipment) * 100) : 0}%
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Acciones requeridas */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center gap-2">
            <AlertOctagon className="size-4 text-red-600" />
            <h2 className="text-sm font-semibold text-slate-700">Acciones urgentes</h2>
          </div>
          <ul className="space-y-2">
            <ActionRow
              count={overdueSchedules.length}
              label="Mantenimientos vencidos"
              href="/maintenance/schedule"
              tint={overdueSchedules.length > 0 ? "red" : "neutral"}
            />
            <ActionRow
              count={globalCounts.critico}
              label="Equipos críticos"
              href="/maintenance/clients"
              tint={globalCounts.critico > 0 ? "red" : "neutral"}
            />
            <ActionRow
              count={draftReports.length}
              label="Reportes en revisión"
              href="/maintenance/reports?status=draft"
              tint={draftReports.length > 0 ? "amber" : "neutral"}
            />
            <ActionRow
              count={thisWeekSchedules.length}
              label="Próximos esta semana"
              href="/maintenance/schedule"
              tint="blue"
            />
          </ul>
        </div>
      </section>

      {/* Active projects — focus≠'projects' shows a small recap */}
      {activeProjects.length > 0 ? (
        <ProjectsGrid projects={activeProjects.slice(0, 6)} subtitle="Instalaciones y obras activas" />
      ) : null}
        </>
      ) : null}

      {/* Clients table */}
      <section className="mb-8">
        <header className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-slate-900">
              Clientes ({clientSummaries.length})
            </h2>
            <p className="text-xs text-slate-500">
              Ordenados por urgencia (críticos primero)
            </p>
          </div>
          <Link
            href="/maintenance/clients"
            className="inline-flex items-center gap-1 text-sm font-semibold text-slate-700 hover:text-slate-900"
          >
            Ver todos
            <ArrowRight className="size-3.5" />
          </Link>
        </header>

        {clientSummaries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center">
            <Building2 className="mx-auto mb-2 size-6 text-slate-400" />
            <p className="text-sm font-medium">Sin clientes aún</p>
            <div className="mt-3 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
              <Link
                href="/maintenance/clients/new"
                className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Crear cliente
                <ChevronRight className="size-4" />
              </Link>
              <Link
                href="/maintenance/clients/import"
                className="text-xs font-semibold text-violet-600 hover:underline"
              >
                o crear varios con IA →
              </Link>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-slate-50/50 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3">Cliente</th>
                    <th className="px-3 py-3 text-center">Sucursales</th>
                    <th className="px-3 py-3 text-center">Equipos</th>
                    <th className="px-3 py-3">Distribución</th>
                    <th className="px-3 py-3 text-center">Salud</th>
                    <th className="px-3 py-3 text-center">Alertas</th>
                    <th className="px-3 py-3">Último servicio</th>
                    <th className="px-3 py-3">Próximo</th>
                    <th className="px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {clientSummaries.map((c) => (
                    <tr key={c.id} className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50/50">
                      <td className="px-4 py-3">
                        <Link href={`/maintenance/clients/${c.id}`} className="flex items-center gap-3">
                          {c.logo_path ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={imageUrl(c.logo_path)}
                              alt={c.name}
                              className="size-9 shrink-0 rounded-lg object-cover ring-1 ring-slate-200"
                            />
                          ) : (
                            <div
                              className="flex size-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
                              style={{ backgroundColor: c.brand_color ?? "#0EA5E9" }}
                            >
                              {initials(c.name)}
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900">{c.name}</p>
                            {c.category ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-1.5 py-0 text-[10px] font-medium text-blue-700">
                                <Tag className="size-2.5" />
                                {CATEGORY_LABEL[c.category]}
                              </span>
                            ) : null}
                          </div>
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-center text-slate-700 tabular-nums">{c.locationsCount}</td>
                      <td className="px-3 py-3 text-center text-slate-700 tabular-nums">{c.equipmentCount}</td>
                      <td className="px-3 py-3">
                        {c.equipmentCount > 0 ? (
                          <div className="w-32">
                            <StackedStatusBar counts={c.counts} />
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-center">
                        {c.equipmentCount > 0 ? (
                          <span
                            className="inline-flex items-baseline gap-0.5 rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ring-1 ring-inset"
                            style={{
                              backgroundColor: `${colorForScore(c.health)}15`,
                              color: colorForScore(c.health),
                              borderColor: colorForScore(c.health),
                            }}
                          >
                            {c.health}
                            <span className="text-[10px] opacity-70">%</span>
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-center">
                        {c.counts.critico + c.counts.atencion > 0 ? (
                          <div className="inline-flex items-center gap-1 text-xs">
                            {c.counts.critico > 0 ? (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-red-50 px-1.5 py-0.5 font-semibold text-red-700">
                                <XOctagon className="size-3" />
                                {c.counts.critico}
                              </span>
                            ) : null}
                            {c.counts.atencion > 0 ? (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-700">
                                <AlertTriangle className="size-3" />
                                {c.counts.atencion}
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 text-xs text-emerald-600">
                            <CheckCircle2 className="size-3" />
                            OK
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-600">
                        {formatDate(c.lastInspection)}
                      </td>
                      <td className="px-3 py-3 text-xs">
                        {c.nextSchedule ? (
                          <span className={cn(c.overdueCount > 0 ? "text-red-600 font-semibold" : "text-slate-600")}>
                            {formatDate(c.nextSchedule)}
                            <span className="ml-1 text-slate-400">({relativeUntil(c.nextSchedule)})</span>
                          </span>
                        ) : (
                          <span className="text-slate-400">Sin programar</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Link href={`/maintenance/clients/${c.id}`} className="text-slate-400 hover:text-slate-700">
                          <ChevronRight className="size-4" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Recent reports + Upcoming schedules */}
      <section className="grid gap-4 lg:grid-cols-2">
        {/* Recent reports */}
        <div className="rounded-2xl border border-border bg-card">
          <header className="flex items-center justify-between border-b border-border px-5 py-3">
            <div className="flex items-center gap-2">
              <ClipboardCheck className="size-4 text-slate-700" />
              <h2 className="text-sm font-semibold">Reportes recientes</h2>
            </div>
            <Link href="/maintenance/reports" className="text-xs font-semibold text-slate-600 hover:text-slate-900">
              Ver todos →
            </Link>
          </header>
          {reports.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">Sin reportes aún</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {reports.slice(0, 5).map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/maintenance/reports/${r.id}`}
                    className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-slate-50"
                  >
                    <div
                      className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white"
                      style={{ backgroundColor: REPORT_TYPE_COLOR[r.report_type] }}
                    >
                      <ReportTypeIcon type={r.report_type} className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {one(r.client)?.name ?? "—"}
                      </p>
                      <p className="text-xs text-slate-500">
                        {REPORT_TYPE_LABEL_SHORT[r.report_type]}
                        {one(r.location) ? ` · ${one(r.location)!.name}` : ""} · {formatDate(r.performed_at_start)}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset",
                        r.status === "draft"
                          ? "bg-amber-50 text-amber-700 ring-amber-600/20"
                          : r.status === "published"
                            ? "bg-blue-50 text-blue-700 ring-blue-600/20"
                            : "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
                      )}
                    >
                      {r.status === "draft" ? "En revisión" : r.status === "published" ? "Publicado" : "Aceptado"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Upcoming schedules */}
        <div className="rounded-2xl border border-border bg-card">
          <header className="flex items-center justify-between border-b border-border px-5 py-3">
            <div className="flex items-center gap-2">
              <Calendar className="size-4 text-slate-700" />
              <h2 className="text-sm font-semibold">Próximos servicios</h2>
            </div>
            <Link href="/maintenance/schedule" className="text-xs font-semibold text-slate-600 hover:text-slate-900">
              Ver cronograma →
            </Link>
          </header>
          {allSchedules.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">Sin mantenimientos programados</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {allSchedules.slice(0, 5).map((s) => {
                const overdue = new Date(s.next_due_date) < new Date();
                return (
                  <li key={s.id}>
                    <Link
                      href={`/maintenance/clients/${s.client_id}`}
                      className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-slate-50"
                    >
                      <div
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-lg",
                          overdue ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700",
                        )}
                      >
                        <Calendar className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {one(s.client)?.name ?? "—"}
                        </p>
                        <p className="text-xs text-slate-500">
                          {one(s.location)?.name ?? "—"} · {REPORT_TYPE_LABEL_SHORT[s.report_type]}
                          {one(s.technician)?.name ? ` · ${one(s.technician)!.name}` : ""}
                        </p>
                      </div>
                      <span className={cn("text-xs", overdue ? "font-semibold text-red-600" : "text-slate-600")}>
                        {formatDate(s.next_due_date)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Footer with team summary */}
      {allTechs.length > 0 ? (
        <section className="mt-8 rounded-2xl border border-border bg-card px-5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <p className="text-slate-700">
              <strong>{allTechs.length}</strong> miembro{allTechs.length === 1 ? "" : "s"} de personal activo{allTechs.length === 1 ? "" : "s"}
            </p>
            <Link href="/maintenance/technicians" className="text-xs font-semibold text-slate-600 hover:text-slate-900">
              Gestionar equipo →
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function PotencialesBand() {
  const d = pipelineDerived();
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
          <TrendingUp className="size-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-700">Pipeline comercial</h2>
        </div>
        <Link href="/maintenance/potenciales" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700">
          Ver potenciales
          <ArrowRight className="size-3.5" />
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((it) => (
          <Link
            key={it.label}
            href="/maintenance/potenciales"
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

function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  accent,
  href,
}: {
  label: string;
  value: number | string;
  hint?: string;
  icon: typeof Building2;
  accent: string;
  href?: string;
}) {
  const inner = (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:shadow-sm">
      <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: accent }} />
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
          <p className="mt-1.5 text-3xl font-bold tabular-nums" style={{ color: accent }}>
            {value}
          </p>
          {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
        </div>
        <div
          className="flex size-9 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${accent}15`, color: accent }}
        >
          <Icon className="size-4" />
        </div>
      </div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function ActionRow({
  count,
  label,
  href,
  tint,
}: {
  count: number;
  label: string;
  href: string;
  tint: "red" | "amber" | "blue" | "neutral";
}) {
  const tintMap = {
    red: { bg: "bg-red-50", text: "text-red-700", chip: "bg-red-100 text-red-700" },
    amber: { bg: "bg-amber-50", text: "text-amber-700", chip: "bg-amber-100 text-amber-700" },
    blue: { bg: "bg-blue-50", text: "text-blue-700", chip: "bg-blue-100 text-blue-700" },
    neutral: { bg: "bg-slate-50", text: "text-slate-700", chip: "bg-slate-200 text-slate-600" },
  };
  const cfg = tintMap[tint];
  return (
    <li>
      <Link
        href={href}
        className={cn(
          "flex items-center justify-between gap-2 rounded-lg px-3 py-2 transition-colors hover:opacity-80",
          cfg.bg,
        )}
      >
        <span className={cn("text-sm font-medium", cfg.text)}>{label}</span>
        <span
          className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums", cfg.chip)}
        >
          {count}
        </span>
      </Link>
    </li>
  );
}

type ProjectGridItem = {
  id: string;
  name: string;
  project_type: string;
  status: string;
  cover_photo_path: string | null;
  expected_completion_date: string | null;
  client: { name: string } | { name: string }[] | null | undefined;
  location: { name: string } | { name: string }[] | null | undefined;
  milestones: { status: string }[];
};

const PROJECT_STATUS_COLOR: Record<string, string> = {
  planificado: "#64748B",
  en_progreso: "#2563EB",
  pausado: "#F59E0B",
  completado: "#F97316",
  aceptado: "#10B981",
};
const PROJECT_STATUS_LABEL: Record<string, string> = {
  planificado: "Planificado",
  en_progreso: "En progreso",
  pausado: "Pausado",
  completado: "Completado",
  aceptado: "Aceptado",
};

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
    <section className="mb-8">
      <header className="mb-3 flex items-end justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-slate-900">{title}</h2>
          {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        <Link href="/maintenance/projects" className="text-xs font-semibold text-blue-600 hover:underline">
          Ver todos →
        </Link>
      </header>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((p) => {
          const client = one(p.client);
          const location = one(p.location);
          const total = p.milestones.length;
          const done = p.milestones.filter((m) => m.status === "completado").length;
          const pct = total === 0 ? 0 : Math.round((done / total) * 100);
          const sc = PROJECT_STATUS_COLOR[p.status] ?? "#64748B";
          return (
            <li key={p.id}>
              <Link
                href={`/maintenance/projects/${p.id}`}
                className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
              >
                <div
                  className="relative aspect-[16/8] w-full bg-slate-100"
                  style={
                    p.cover_photo_path
                      ? {
                          backgroundImage: `url(${projectImageUrl(p.cover_photo_path)})`,
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                        }
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
                    {PROJECT_STATUS_LABEL[p.status] ?? p.status}
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
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${pct}%`, backgroundColor: sc }}
                      />
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

