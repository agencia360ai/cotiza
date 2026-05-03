export type EquipmentStatus =
  | "operativo"
  | "atencion"
  | "critico"
  | "fuera_de_servicio"
  | "sin_inspeccion";

export const STATUS_LABEL: Record<EquipmentStatus, string> = {
  operativo: "Operativo",
  atencion: "Requiere atención",
  critico: "Crítico",
  fuera_de_servicio: "Fuera de servicio",
  sin_inspeccion: "Sin inspección",
};

export const STATUS_LABEL_SHORT: Record<EquipmentStatus, string> = {
  operativo: "Operativo",
  atencion: "Atención",
  critico: "Crítico",
  fuera_de_servicio: "Fuera de servicio",
  sin_inspeccion: "Sin inspección",
};

export const STATUS_COLOR: Record<EquipmentStatus, string> = {
  operativo: "#10B981",
  atencion: "#F59E0B",
  critico: "#EF4444",
  fuera_de_servicio: "#6B7280",
  sin_inspeccion: "#94A3B8",
};

export const STATUS_TINT: Record<EquipmentStatus, string> = {
  operativo: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  atencion: "bg-amber-50 text-amber-700 ring-amber-600/20",
  critico: "bg-red-50 text-red-700 ring-red-600/20",
  fuera_de_servicio: "bg-gray-100 text-gray-700 ring-gray-600/20",
  sin_inspeccion: "bg-slate-100 text-slate-700 ring-slate-600/20",
};

export type Recommendation = {
  priority: "alta" | "media" | "baja";
  description: string;
};

export const PRIORITY_TINT: Record<Recommendation["priority"], string> = {
  alta: "bg-red-50 text-red-700 ring-red-600/20",
  media: "bg-amber-50 text-amber-700 ring-amber-600/20",
  baja: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
};

export const PRIORITY_LABEL: Record<Recommendation["priority"], string> = {
  alta: "Alta prioridad",
  media: "Media prioridad",
  baja: "Baja prioridad",
};

export type Client = {
  id: string;
  org_id: string;
  name: string;
  contact_email: string | null;
  contact_phone: string | null;
  logo_path: string | null;
  brand_color: string | null;
  notes: string | null;
};

export type Equipment = {
  id: string;
  location_id: string;
  custom_name: string;
  category: string | null;
  brand: string | null;
  model: string | null;
  location_label: string | null;
  serial_number: string | null;
  capacity_btu: number | null;
  voltage: string | null;
  install_date: string | null;
  latest_status: EquipmentStatus | null;
  latest_inspection_at: string | null;
  history: { status: EquipmentStatus; date: string }[];
};

export type Location = {
  id: string;
  client_id: string;
  name: string;
  address: string | null;
  notes: string | null;
  equipment: Equipment[];
};

export type ReportType = "preventivo" | "correctivo" | "instalacion" | "inspeccion";

export const REPORT_TYPE_LABEL: Record<ReportType, string> = {
  preventivo: "Mantenimiento Preventivo",
  correctivo: "Reparación Correctiva",
  instalacion: "Nueva Instalación",
  inspeccion: "Inspección",
};

export const REPORT_TYPE_LABEL_SHORT: Record<ReportType, string> = {
  preventivo: "Preventivo",
  correctivo: "Correctivo",
  instalacion: "Instalación",
  inspeccion: "Inspección",
};

export const REPORT_TYPE_COLOR: Record<ReportType, string> = {
  preventivo: "#3B82F6",
  correctivo: "#F97316",
  instalacion: "#10B981",
  inspeccion: "#64748B",
};

export const REPORT_TYPE_TINT: Record<ReportType, string> = {
  preventivo: "bg-blue-50 text-blue-700 ring-blue-600/20",
  correctivo: "bg-orange-50 text-orange-700 ring-orange-600/20",
  instalacion: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  inspeccion: "bg-slate-100 text-slate-700 ring-slate-600/20",
};

export type ReportSeverity = "leve" | "moderada" | "grave";

export const SEVERITY_LABEL: Record<ReportSeverity, string> = {
  leve: "Leve",
  moderada: "Moderada",
  grave: "Grave",
};

export const SEVERITY_TINT: Record<ReportSeverity, string> = {
  leve: "bg-yellow-50 text-yellow-800 ring-yellow-600/20",
  moderada: "bg-orange-50 text-orange-700 ring-orange-600/20",
  grave: "bg-red-50 text-red-700 ring-red-600/20",
};

export type ReportSummary = {
  id: string;
  client_id: string;
  location_id: string | null;
  location_name: string | null;
  report_number: string;
  performed_at_start: string;
  performed_at_end: string | null;
  performed_by_name: string | null;
  engineer_name: string | null;
  summary_es: string | null;
  status: "draft" | "published" | "accepted";
  report_type: ReportType;
  severity: ReportSeverity | null;
  trigger_event_es: string | null;
  next_service_date: string | null;
  published_at: string | null;
  accepted_at: string | null;
  item_counts: Partial<Record<EquipmentStatus, number>> | null;
};

export type DashboardData = {
  client: Client;
  locations: Location[];
  reports: ReportSummary[];
};

export type ReportItem = {
  id: string;
  report_id: string;
  equipment_id: string;
  equipment_status: EquipmentStatus;
  readings: Record<string, number | string>;
  observations_es: string | null;
  parts_replaced: { name: string; quantity?: number }[];
  recommendations: Recommendation[];
  checklist_items: string[];
  photo_paths: string[];
  position: number;
  equipment: Equipment;
};

export type ReportDetailData = {
  client: Client;
  location: Location | null;
  report: Omit<ReportSummary, "location_name" | "item_counts"> & {
    performed_by_phone: string | null;
    engineer_phone: string | null;
    engineer_email: string | null;
    org_id: string;
  };
  items: ReportItem[];
  acceptance: {
    id: string;
    signed_by_name: string;
    signed_by_email: string | null;
    signature_path: string;
    signed_at: string;
  } | null;
};

export function aggregateStatus(equipment: Equipment[]): Record<EquipmentStatus, number> {
  const counts: Record<EquipmentStatus, number> = {
    operativo: 0,
    atencion: 0,
    critico: 0,
    fuera_de_servicio: 0,
    sin_inspeccion: 0,
  };
  for (const e of equipment) {
    const s = e.latest_status ?? "sin_inspeccion";
    counts[s]++;
  }
  return counts;
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

export function trendDelta(
  reports: ReportSummary[],
): { delta: number; previous: number } | null {
  const preventivos = reports
    .filter((r) => r.report_type === "preventivo" && r.item_counts)
    .sort((a, b) => +new Date(b.performed_at_start) - +new Date(a.performed_at_start));
  if (preventivos.length < 2) return null;
  const calc = (r: ReportSummary): number => {
    const c = r.item_counts ?? {};
    const filled: Record<EquipmentStatus, number> = {
      operativo: c.operativo ?? 0,
      atencion: c.atencion ?? 0,
      critico: c.critico ?? 0,
      fuera_de_servicio: c.fuera_de_servicio ?? 0,
      sin_inspeccion: c.sin_inspeccion ?? 0,
    };
    return healthScore(filled);
  };
  const current = calc(preventivos[0]);
  const previous = calc(preventivos[1]);
  return { delta: current - previous, previous };
}

export type EquipmentHistoryEntry = {
  item_id: string;
  report_id: string;
  report_number: string;
  report_type: ReportType;
  severity: ReportSeverity | null;
  performed_at_start: string;
  performed_by_name: string | null;
  status: EquipmentStatus;
  observations_es: string | null;
  recommendations: Recommendation[];
  parts_replaced: { name: string; quantity?: number }[];
  checklist_items: string[];
  photo_paths: string[];
  readings: Record<string, number | string>;
};

export type EquipmentHistoryData = {
  client: Client;
  location: Location;
  equipment: Equipment;
  history: EquipmentHistoryEntry[];
};

export function imageUrl(path: string): string {
  if (path.startsWith("http")) return path;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return `${base}/storage/v1/object/public/cotiza-maintenance/${path}`;
}
