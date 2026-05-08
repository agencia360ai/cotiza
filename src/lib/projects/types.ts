export type ProjectType = "instalacion" | "obra" | "remodelacion" | "otro";

export const PROJECT_TYPE_LABEL: Record<ProjectType, string> = {
  instalacion: "Instalación",
  obra: "Obra",
  remodelacion: "Remodelación",
  otro: "Otro",
};

export const PROJECT_TYPE_COLOR: Record<ProjectType, string> = {
  instalacion: "#2563EB",
  obra: "#F97316",
  remodelacion: "#7C3AED",
  otro: "#64748B",
};

export type ProjectStatus =
  | "planificado"
  | "en_progreso"
  | "pausado"
  | "completado"
  | "aceptado";

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planificado: "Planificado",
  en_progreso: "En progreso",
  pausado: "Pausado",
  completado: "Completado",
  aceptado: "Aceptado por cliente",
};

export const PROJECT_STATUS_COLOR: Record<ProjectStatus, string> = {
  planificado: "#64748B",
  en_progreso: "#2563EB",
  pausado: "#F59E0B",
  completado: "#F97316",
  aceptado: "#10B981",
};

export const PROJECT_STATUS_TINT: Record<ProjectStatus, string> = {
  planificado: "bg-slate-100 text-slate-700 ring-slate-600/20",
  en_progreso: "bg-blue-50 text-blue-700 ring-blue-600/20",
  pausado: "bg-amber-50 text-amber-800 ring-amber-600/20",
  completado: "bg-orange-50 text-orange-700 ring-orange-600/20",
  aceptado: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
};

export type MilestoneStatus = "pendiente" | "en_progreso" | "completado";

export const MILESTONE_STATUS_LABEL: Record<MilestoneStatus, string> = {
  pendiente: "Pendiente",
  en_progreso: "En progreso",
  completado: "Completado",
};

export const MILESTONE_STATUS_COLOR: Record<MilestoneStatus, string> = {
  pendiente: "#94A3B8",
  en_progreso: "#2563EB",
  completado: "#10B981",
};

export type ProjectMedia = {
  id: string;
  kind: "photo" | "video";
  path: string;
  caption_es: string | null;
  position: number;
};

export type ProjectMilestone = {
  id: string;
  project_id?: string;
  title: string;
  description_es: string | null;
  status: MilestoneStatus;
  position: number;
  occurred_on: string | null;
  completed_at: string | null;
  created_at: string;
  media: ProjectMedia[];
};

export type ClientProject = {
  id: string;
  org_id: string;
  client_id: string;
  location_id: string | null;
  new_location_label: string | null;
  name: string;
  project_type: ProjectType;
  description_es: string | null;
  status: ProjectStatus;
  cover_photo_path: string | null;
  expected_start_date: string | null;
  expected_completion_date: string | null;
  started_at: string | null;
  completed_at: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectAcceptance = {
  id: string;
  project_id: string;
  signed_by_name: string;
  signed_by_email: string | null;
  signature_path: string;
  signed_at: string;
};

export type ProjectListRow = {
  id: string;
  name: string;
  project_type: ProjectType;
  status: ProjectStatus;
  cover_photo_path: string | null;
  expected_completion_date: string | null;
  started_at: string | null;
  completed_at: string | null;
  accepted_at: string | null;
  location_name: string | null;
  milestone_count: number;
  completed_count: number;
};

export type PublicProjectData = {
  project: ClientProject;
  client: { id: string; name: string; brand_color: string | null; logo_path: string | null };
  location: { id: string; name: string; address: string | null } | null;
  service_provider: { name: string; logo_path: string | null };
  milestones: ProjectMilestone[];
  acceptance: ProjectAcceptance | null;
};

export function projectImageUrl(path: string): string {
  if (path.startsWith("http")) return path;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return `${base}/storage/v1/object/public/cotiza-projects/${path}`;
}

export function projectProgressPercent(rows: { status: MilestoneStatus }[]): number {
  if (rows.length === 0) return 0;
  const done = rows.filter((m) => m.status === "completado").length;
  return Math.round((done / rows.length) * 100);
}
