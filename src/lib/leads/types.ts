// Leads — CRM-lite de seguimiento a clientes potenciales.

export type LeadStatus = "nuevo" | "contactado" | "en_seguimiento" | "cotizado" | "ganado" | "perdido";

// Orden del pipeline (columnas del tablero, izquierda → derecha).
export const LEAD_STATUS_ORDER: LeadStatus[] = ["nuevo", "contactado", "en_seguimiento", "cotizado", "ganado", "perdido"];

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  nuevo: "Nuevo",
  contactado: "Contactado",
  en_seguimiento: "En seguimiento",
  cotizado: "Cotizado",
  ganado: "Ganado",
  perdido: "Perdido",
};

// Color por etapa (chips + barra de la columna). Slate/indigo del dashboard.
export const LEAD_STATUS_COLOR: Record<LeadStatus, string> = {
  nuevo: "#6366F1", // indigo
  contactado: "#0EA5E9", // sky
  en_seguimiento: "#F59E0B", // amber
  cotizado: "#8B5CF6", // violet
  ganado: "#10B981", // emerald
  perdido: "#94A3B8", // slate
};

// Etapas "activas" (siguen en juego): para KPIs y valor en pipeline.
export const LEAD_STATUS_ACTIVAS: LeadStatus[] = ["nuevo", "contactado", "en_seguimiento", "cotizado"];

export type LeadActivity = { at: string; text: string };

// Un miembro de la organización, listo para el selector de encargado. La
// etiqueta se arma en el servidor (el email vive en auth.users y resolverlo
// necesita el cliente admin), así el tablero solo recibe texto.
export type LeadOwner = { id: string; label: string; email: string };

export type LeadRow = {
  id: string;
  company_name: string | null;
  contact_name: string | null;
  whatsapp: string | null;
  email: string | null;
  description: string | null;
  status: LeadStatus;
  estimated_value: number | null;
  source: string | null;
  next_follow_up: string | null;
  last_contact_at: string | null;
  lost_reason: string | null;
  client_id: string | null;
  converted_quote_id: string | null;
  owner_member_id: string | null; // quién lo sigue (org_members.id) — 0046
  activity: LeadActivity[];
  created_at: string | null;
  updated_at: string | null;
};

export const LEAD_SOURCES = ["referido", "web", "llamada", "feria", "cliente_actual", "otro"] as const;
export const LEAD_SOURCE_LABEL: Record<(typeof LEAD_SOURCES)[number], string> = {
  referido: "Referido",
  web: "Web / redes",
  llamada: "Llamada",
  feria: "Feria / evento",
  cliente_actual: "Cliente actual",
  otro: "Otro",
};
