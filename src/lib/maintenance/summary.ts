import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ClientCategory, EquipmentStatus, ReportType } from "@/lib/maintenance/types";

export type Maybe<T> = T | T[] | null;
export function one<T>(v: Maybe<T>): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export type ClientRow = {
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
  report: Maybe<{ client_id: string; performed_at_start: string; status: string }>;
};
export type ScheduleRow = {
  id: string;
  client_id: string;
  next_due_date: string;
  report_type: ReportType;
  client: Maybe<{ name: string }>;
  location: Maybe<{ name: string }>;
  technician: Maybe<{ name: string }>;
};
export type RecentReport = {
  id: string;
  report_number: string;
  report_type: ReportType;
  status: "draft" | "published" | "accepted";
  performed_at_start: string;
  performed_by_name: string | null;
  client: Maybe<{ name: string; brand_color: string | null }>;
  location: Maybe<{ name: string }>;
};

export type ClientSummary = ClientRow & {
  locationsCount: number;
  equipmentCount: number;
  counts: Record<EquipmentStatus, number>;
  health: number;
  lastInspection: string | null;
  nextSchedule: string | null;
  overdueCount: number;
};

export function bucketStatus(): Record<EquipmentStatus, number> {
  return { operativo: 0, atencion: 0, critico: 0, fuera_de_servicio: 0, sin_inspeccion: 0 };
}

const STATUS_WEIGHT: Record<EquipmentStatus, number> = {
  operativo: 100,
  atencion: 60,
  critico: 20,
  fuera_de_servicio: 0,
  sin_inspeccion: 50,
};

export function healthScore(counts: Record<EquipmentStatus, number>): number {
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

export function colorForScore(score: number): string {
  if (score >= 85) return "#10B981";
  if (score >= 65) return "#84CC16";
  if (score >= 45) return "#F59E0B";
  if (score >= 25) return "#F97316";
  return "#EF4444";
}

export type MaintenanceSummary = {
  clients: ClientRow[];
  clientSummaries: ClientSummary[];
  globalCounts: Record<EquipmentStatus, number>;
  totalEquipment: number;
  totalLocations: number;
  globalHealth: number;
  schedules: ScheduleRow[];
  overdueSchedules: ScheduleRow[];
  thisWeekSchedules: ScheduleRow[];
  reports: RecentReport[];
  draftReportsCount: number;
  techsCount: number;
};

/** Agrega todo lo de mantenimiento (equipos, salud por cliente, cronograma,
 *  reportes) para una org. Lo usan tanto el resumen macro de Inicio como el
 *  detalle de la pantalla de Mantenimiento. */
export async function getMaintenanceSummary(orgId: string): Promise<MaintenanceSummary> {
  const empty: MaintenanceSummary = {
    clients: [],
    clientSummaries: [],
    globalCounts: bucketStatus(),
    totalEquipment: 0,
    totalLocations: 0,
    globalHealth: 0,
    schedules: [],
    overdueSchedules: [],
    thisWeekSchedules: [],
    reports: [],
    draftReportsCount: 0,
    techsCount: 0,
  };
  if (!orgId) return empty;
  const supabase = await createClient();

  const [clientsRes, locationsRes, equipmentRes, itemsRes, schedulesRes, reportsRes, techsRes] =
    await Promise.all([
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
        .select("*, client:clients(name), location:client_locations(name), technician:technicians(name)")
        .eq("org_id", orgId)
        .eq("active", true)
        .order("next_due_date", { ascending: true }),
      supabase
        .from("maintenance_reports")
        .select("id, report_number, report_type, status, performed_at_start, performed_by_name, client:clients(name, brand_color), location:client_locations(name)")
        .eq("org_id", orgId)
        .order("updated_at", { ascending: false })
        .limit(8),
      supabase.from("technicians").select("id, name").eq("org_id", orgId).eq("active", true),
    ]);

  const allClients = (clientsRes.data ?? []) as ClientRow[];
  const allLocations = (locationsRes.data ?? []) as unknown as LocationRow[];
  const allEquipment = (equipmentRes.data ?? []) as unknown as EquipmentRow[];
  const allItems = (itemsRes.data ?? []) as unknown as ItemRow[];
  const schedules = (schedulesRes.data ?? []) as unknown as ScheduleRow[];
  const reports = (reportsRes.data ?? []) as unknown as RecentReport[];
  const techsCount = (techsRes.data ?? []).length;

  const latestStatusByEquipment = new Map<string, { status: EquipmentStatus; date: string }>();
  for (const it of allItems) {
    const reportObj = one(it.report);
    if (!reportObj) continue;
    const cur = latestStatusByEquipment.get(it.equipment_id);
    if (!cur || reportObj.performed_at_start > cur.date) {
      latestStatusByEquipment.set(it.equipment_id, { status: it.equipment_status, date: reportObj.performed_at_start });
    }
  }

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
    const clientSchedules = schedules.filter((s) => s.client_id === c.id);
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

  clientSummaries.sort((a, b) => {
    if (b.counts.critico !== a.counts.critico) return b.counts.critico - a.counts.critico;
    if (b.counts.atencion !== a.counts.atencion) return b.counts.atencion - a.counts.atencion;
    if (b.overdueCount !== a.overdueCount) return b.overdueCount - a.overdueCount;
    return a.name.localeCompare(b.name);
  });

  const globalCounts = bucketStatus();
  for (const cs of clientSummaries) {
    for (const k of Object.keys(globalCounts) as EquipmentStatus[]) globalCounts[k] += cs.counts[k];
  }
  const totalEquipment = Object.values(globalCounts).reduce((s, n) => s + n, 0);

  const overdueSchedules = schedules.filter((s) => new Date(s.next_due_date) < new Date());
  const thisWeekSchedules = schedules.filter((s) => {
    const d = new Date(s.next_due_date);
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    const week = new Date(t);
    week.setDate(week.getDate() + 7);
    return d >= t && d <= week;
  });

  return {
    clients: allClients,
    clientSummaries,
    globalCounts,
    totalEquipment,
    totalLocations: allLocations.length,
    globalHealth: healthScore(globalCounts),
    schedules,
    overdueSchedules,
    thisWeekSchedules,
    reports,
    draftReportsCount: reports.filter((r) => r.status === "draft").length,
    techsCount,
  };
}
