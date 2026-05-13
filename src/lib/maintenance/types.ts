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

export type ServiceProvider = {
  name: string;
  logo_path: string | null;
};

export type ClientCategory =
  | "restaurante"
  | "hotel"
  | "retail"
  | "oficina"
  | "industrial"
  | "residencial"
  | "salud"
  | "educacion"
  | "otro";

export const CLIENT_CATEGORIES: ClientCategory[] = [
  "restaurante",
  "hotel",
  "retail",
  "oficina",
  "industrial",
  "residencial",
  "salud",
  "educacion",
  "otro",
];

export const CATEGORY_LABEL: Record<ClientCategory, string> = {
  restaurante: "Restaurante",
  hotel: "Hotel",
  retail: "Retail / Comercio",
  oficina: "Oficina",
  industrial: "Industrial",
  residencial: "Residencial",
  salud: "Salud",
  educacion: "Educación",
  otro: "Otro",
};

export type EquipmentCategory =
  | "nevera"
  | "congelador"
  | "cuarto_frio"
  | "mesa_fria"
  | "vitrina_refrigerada"
  | "ice_maker"
  | "botellero"
  | "mini_split_cassette"
  | "central_ac"
  | "paquete_rooftop"
  | "chiller"
  | "manejadora"
  | "piso_techo"
  | "fan_coil"
  | "evaporadora"
  | "campana_extractora"
  | "otro";

export const EQUIPMENT_CATEGORIES: EquipmentCategory[] = [
  "nevera",
  "congelador",
  "cuarto_frio",
  "mesa_fria",
  "vitrina_refrigerada",
  "ice_maker",
  "botellero",
  "mini_split_cassette",
  "central_ac",
  "paquete_rooftop",
  "chiller",
  "manejadora",
  "piso_techo",
  "fan_coil",
  "evaporadora",
  "campana_extractora",
  "otro",
];

export const EQUIPMENT_CATEGORY_LABEL: Record<EquipmentCategory, string> = {
  nevera: "Nevera",
  congelador: "Congelador",
  cuarto_frio: "Cuarto frío",
  mesa_fria: "Mesa fría",
  vitrina_refrigerada: "Vitrina refrigerada",
  ice_maker: "Productor de hielo",
  botellero: "Botellero",
  mini_split_cassette: "Mini split / cassette",
  central_ac: "Central AC / AC de ductos",
  paquete_rooftop: "Paquete / rooftop",
  chiller: "Chiller",
  manejadora: "Manejadora de aire",
  piso_techo: "Piso techo",
  fan_coil: "Fan coil",
  evaporadora: "Evaporadora",
  campana_extractora: "Campana extractora",
  otro: "Otro",
};

export const EQUIPMENT_CATEGORY_GROUP: Record<EquipmentCategory, "refrigeracion" | "aire" | "otros"> = {
  nevera: "refrigeracion",
  congelador: "refrigeracion",
  cuarto_frio: "refrigeracion",
  mesa_fria: "refrigeracion",
  vitrina_refrigerada: "refrigeracion",
  ice_maker: "refrigeracion",
  botellero: "refrigeracion",
  mini_split_cassette: "aire",
  central_ac: "aire",
  paquete_rooftop: "aire",
  chiller: "aire",
  manejadora: "aire",
  piso_techo: "aire",
  fan_coil: "aire",
  evaporadora: "otros",
  campana_extractora: "otros",
  otro: "otros",
};

export const EQUIPMENT_CATEGORY_GROUP_LABEL: Record<"refrigeracion" | "aire" | "otros", string> = {
  refrigeracion: "Refrigeración",
  aire: "Aire acondicionado",
  otros: "Otros",
};

export type ImportedEquipment = {
  custom_name: string;
  brand: string | null;
  model: string | null;
  category: EquipmentCategory | null;
  location_label: string | null;
  voltage: string | null;
  capacity_btu: number | null;
};

export type ImportedSchedule = {
  location_name: string;
  report_type: "preventivo" | "inspeccion" | "instalacion";
  frequency: "mensual" | "bimestral" | "trimestral" | "semestral" | "anual" | "custom";
  frequency_days: number | null;
};

export type ImportedClient = {
  client: {
    name: string;
    category: ClientCategory | null;
    contact_email: string | null;
    contact_phone: string | null;
    notes: string | null;
  };
  locations: { name: string; address: string | null; equipment: ImportedEquipment[] }[];
  schedules: ImportedSchedule[];
};

export type ImportedBatch = { clients: ImportedClient[] };

export type Schedule = {
  id: string;
  client_id: string;
  location_id: string | null;
  location_name: string | null;
  report_type: ReportType;
  frequency: "mensual" | "bimestral" | "trimestral" | "semestral" | "anual" | "custom";
  frequency_days: number | null;
  start_date: string;
  next_due_date: string;
  last_completed_at: string | null;
  assigned_technician_id: string | null;
  notes: string | null;
  active: boolean;
};

export type DashboardData = {
  client: Client;
  service_provider: ServiceProvider;
  locations: Location[];
  reports: ReportSummary[];
  schedules: Schedule[];
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
  service_provider: ServiceProvider;
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

export type ReportSubState =
  | "capturando"      // status=draft, no AI yet, tech still collecting
  | "generado"        // status=draft, AI generated, tech reviewing
  | "en_revision"     // status=draft, tech submitted, admin must publish
  | "publicado"       // status=published
  | "aceptado";       // status=accepted

export const SUBSTATE_LABEL: Record<ReportSubState, string> = {
  capturando: "Capturando",
  generado: "IA generada",
  en_revision: "Listo para publicar",
  publicado: "Publicado",
  aceptado: "Aceptado",
};

export const SUBSTATE_TINT: Record<ReportSubState, string> = {
  capturando: "bg-violet-50 text-violet-700 ring-violet-600/20",
  generado: "bg-amber-50 text-amber-700 ring-amber-600/20",
  en_revision: "bg-orange-50 text-orange-700 ring-orange-600/20",
  publicado: "bg-blue-50 text-blue-700 ring-blue-600/20",
  aceptado: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
};

export function reportSubState(report: {
  status: "draft" | "published" | "accepted";
  ai_draft_at: string | null;
  performed_at_end: string | null;
}): ReportSubState {
  if (report.status === "accepted") return "aceptado";
  if (report.status === "published") return "publicado";
  if (report.performed_at_end) return "en_revision";
  if (report.ai_draft_at) return "generado";
  return "capturando";
}

export type Technician = {
  id: string;
  org_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: string;
  active: boolean;
  last_used_at: string | null;
};

export type CaptureKind = "photo" | "voice" | "text";

export type CaptureItem = {
  id: string;
  kind: CaptureKind;
  text: string | null;
  photo_path: string | null;
  equipment_id: string | null;
  captured_at: string;
};

export type TechnicianClient = Client & {
  locations: (Location & { equipment_count: number })[];
};

export type TechnicianDraft = {
  id: string;
  client_id: string;
  client_name: string;
  location_id: string | null;
  location_name: string | null;
  report_number: string;
  report_type: ReportType;
  severity: ReportSeverity | null;
  performed_at_start: string;
  performed_at_end: string | null;
  capture_count: number;
  item_count: number;
  ai_draft_at: string | null;
  updated_at: string;
  status: "draft" | "published" | "accepted";
};

export type TechnicianSubmitted = {
  id: string;
  client_id: string;
  client_name: string;
  location_id: string | null;
  location_name: string | null;
  report_number: string;
  report_type: ReportType;
  status: "draft" | "published" | "accepted";
  performed_at_start: string;
  published_at: string | null;
  updated_at: string;
};

export type TechnicianPortalData = {
  technician: Technician;
  clients: TechnicianClient[];
  drafts: TechnicianDraft[];
  submitted: TechnicianSubmitted[];
};

export type TechnicianReportData = {
  technician: Technician;
  client: Client;
  location: Location;
  report: {
    id: string;
    client_id: string;
    location_id: string;
    org_id: string;
    report_number: string;
    report_type: ReportType;
    severity: ReportSeverity | null;
    trigger_event_es: string | null;
    performed_at_start: string;
    performed_at_end: string | null;
    performed_by_name: string | null;
    summary_es: string | null;
    status: "draft" | "published" | "accepted";
    capture_data: CaptureItem[];
    ai_draft_at: string | null;
    ai_generated: boolean;
  };
  items: ReportItem[];
};
