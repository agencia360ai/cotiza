// Dominio "Potenciales" — cotizaciones y licitaciones (pipeline comercial).
//
// FASE A (actual): los agregados vienen del Excel de control de DICEC
// ("Avance.xlsx" · hoja Resumen) como snapshot estático. Sirve para validar
// la estructura y el dashboard con números reales.
//
// FASE C: se reemplaza PIPELINE_SNAPSHOT por queries vivas sobre las tablas
// `cotiza.sales_quotes` y `cotiza.tenders`, y la importación del Excel.

export type Rubro = "DC" | "DM" | "DS" | "DV";

export const RUBROS: Record<Rubro, { label: string; full: string; color: string; soft: string }> = {
  DC: { label: "Contratos", full: "Contratos", color: "#6366F1", soft: "#EEF2FF" },
  DM: { label: "Mantenimiento", full: "Mantenimiento", color: "#2563EB", soft: "#EFF6FF" },
  DS: { label: "Servicio", full: "Servicio", color: "#10B981", soft: "#ECFDF5" },
  DV: { label: "Ventas", full: "Ventas / Suministro", color: "#F59E0B", soft: "#FFFBEB" },
};

// 'borrador' = creada en el cotizador, PDF aún no publicado a Dropbox.
// No cuenta en KPIs ni agregados; al publicar pasa a 'enviada'.
export type QuoteStatus = "borrador" | "enviada" | "aprobada" | "rechazada";

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  borrador: "Borrador",
  enviada: "Enviada",
  aprobada: "Aprobada",
  rechazada: "Rechazada",
};
export const QUOTE_STATUS_COLOR: Record<QuoteStatus, string> = {
  borrador: "#94A3B8",
  enviada: "#F59E0B",
  aprobada: "#10B981",
  rechazada: "#EF4444",
};

export type TenderStatus = "ganada" | "no_ganada" | "presentada" | "en_revision" | "por_partir";

export const TENDER_STATUS_LABEL: Record<TenderStatus, string> = {
  ganada: "Ganada",
  no_ganada: "No ganada",
  presentada: "Presentada",
  en_revision: "En revisión",
  por_partir: "Por partir",
};
export const TENDER_STATUS_COLOR: Record<TenderStatus, string> = {
  ganada: "#10B981",
  no_ganada: "#94A3B8",
  presentada: "#2563EB",
  en_revision: "#F59E0B",
  por_partir: "#A855F7",
};

export type Modalidad = "licitacion_publica" | "compra_menor" | "contratacion_menor" | "otro";

export const MODALIDAD_LABEL: Record<Modalidad, string> = {
  licitacion_publica: "Licitación Pública",
  compra_menor: "Compra Menor",
  contratacion_menor: "Contratación Menor",
  otro: "Otro",
};

// Filas completas (Fase B) — lo que consume la tabla editable.
export type QuoteRow = {
  id: string;
  quote_number: string;
  year: number | null;
  sent_date: string | null;
  amount_usd: number | null;
  status: QuoteStatus;
  payment_status: "facturado" | null;
  invoice_status: "pendiente" | "cancelada" | null;
  client_name: string | null;
  client_id: string | null;
  client_std_name: string | null;
  location_id: string | null;
  location_name: string | null;
  dropbox_shared_url: string | null;
  dropbox_path: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  description: string | null;
  notes: string | null;
  rubro: Rubro | null;
  progress: number | null;
  follow_up_date: string | null;
  rejection_reason: string | null;
  converted_project_id: string | null;
};

export type TenderRow = {
  id: string;
  acto_number: string | null;
  year: number | null;
  modalidad: Modalidad | null;
  entity: string | null;
  client_id: string | null;
  client_std_name: string | null;
  location_id: string | null;
  location_name: string | null;
  location_text: string | null;
  objeto: string | null;
  status: TenderStatus;
  execution_status: string | null;
  amount_ref_usd: number | null;
  delivery_date: string | null;
  notes: string | null;
  folder_url: string | null;
  rubro: Rubro | null;
  progress: number | null;
  converted_project_id: string | null;
};

export function formatMoney(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export function formatMoneyExact(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

// ──────────────────────────────────────────────────────────────────────────
// Snapshot del Excel DICEC (Resumen · 2026). Reemplazar en Fase C.
// ──────────────────────────────────────────────────────────────────────────

export const PIPELINE_SNAPSHOT = {
  year: 2026,
  source: "Excel de control DICEC (hoja Resumen)",
  cotizaciones: {
    total: { count: 109, monto: 522125.47 },
    porEstado: {
      aprobada: { count: 78, monto: 69390.67 },
      enviada: { count: 20, monto: 369067.78 },
      rechazada: { count: 11, monto: 83667.02 },
    } as Record<QuoteStatus, { count: number; monto: number }>,
    facturacion: { cobrada: 57, porCobrar: 12, sinEstado: 9 },
  },
  licitaciones: {
    total: { count: 41, monto: 1267799.3 },
    porEstatus: {
      ganada: { count: 10, monto: 79650 },
      no_ganada: { count: 19, monto: 825073.3 },
      presentada: { count: 8, monto: 281970 },
      en_revision: { count: 3, monto: 47706 },
      por_partir: { count: 1, monto: 33400 },
    } as Record<TenderStatus, { count: number; monto: number }>,
    porModalidad: {
      publica: { label: "Licitación Pública", count: 12 },
      compraMenor: { label: "Compra Menor", count: 15 },
      contratacionMenor: { label: "Contratación Menor", count: 13 },
    },
  },
} as const;

// Forma normalizada que consumen las vistas. La data puede venir del snapshot
// (Excel) o de las tablas vivas (`sales_quotes` / `tenders`) — misma forma.
export type PipelineData = {
  year: number;
  live: boolean;
  cotizaciones: {
    total: { count: number; monto: number };
    porEstado: Record<QuoteStatus, { count: number; monto: number }>;
    facturacion: { cobrada: number; porCobrar: number; sinEstado: number };
  };
  licitaciones: {
    total: { count: number; monto: number };
    porEstatus: Record<TenderStatus, { count: number; monto: number }>;
    porModalidad: {
      publica: { label: string; count: number };
      compraMenor: { label: string; count: number };
      contratacionMenor: { label: string; count: number };
    };
  };
};

export function snapshotPipelineData(): PipelineData {
  return {
    year: PIPELINE_SNAPSHOT.year,
    live: false,
    cotizaciones: {
      total: { ...PIPELINE_SNAPSHOT.cotizaciones.total },
      porEstado: {
        borrador: { count: 0, monto: 0 },
        enviada: { ...PIPELINE_SNAPSHOT.cotizaciones.porEstado.enviada },
        aprobada: { ...PIPELINE_SNAPSHOT.cotizaciones.porEstado.aprobada },
        rechazada: { ...PIPELINE_SNAPSHOT.cotizaciones.porEstado.rechazada },
      },
      facturacion: { ...PIPELINE_SNAPSHOT.cotizaciones.facturacion },
    },
    licitaciones: {
      total: { ...PIPELINE_SNAPSHOT.licitaciones.total },
      porEstatus: {
        ganada: { ...PIPELINE_SNAPSHOT.licitaciones.porEstatus.ganada },
        no_ganada: { ...PIPELINE_SNAPSHOT.licitaciones.porEstatus.no_ganada },
        presentada: { ...PIPELINE_SNAPSHOT.licitaciones.porEstatus.presentada },
        en_revision: { ...PIPELINE_SNAPSHOT.licitaciones.porEstatus.en_revision },
        por_partir: { ...PIPELINE_SNAPSHOT.licitaciones.porEstatus.por_partir },
      },
      porModalidad: {
        publica: { ...PIPELINE_SNAPSHOT.licitaciones.porModalidad.publica },
        compraMenor: { ...PIPELINE_SNAPSHOT.licitaciones.porModalidad.compraMenor },
        contratacionMenor: { ...PIPELINE_SNAPSHOT.licitaciones.porModalidad.contratacionMenor },
      },
    },
  };
}

// Derivados útiles para el dashboard.
export function pipelineDerived(data: PipelineData) {
  const c = data.cotizaciones;
  const l = data.licitaciones;
  const licitacionesVivas =
    l.porEstatus.presentada.count + l.porEstatus.en_revision.count + l.porEstatus.por_partir.count;
  const montoLicitacionesVivas =
    l.porEstatus.presentada.monto + l.porEstatus.en_revision.monto + l.porEstatus.por_partir.monto;
  const enJuegoMonto = c.porEstado.enviada.monto + montoLicitacionesVivas;
  const decididas = c.porEstado.aprobada.count + c.porEstado.rechazada.count;
  const tasaCierre = decididas > 0 ? c.porEstado.aprobada.count / decididas : 0;
  return {
    enJuegoMonto,
    enJuegoCount: c.porEstado.enviada.count + licitacionesVivas,
    aprobadoMonto: c.porEstado.aprobada.monto,
    aprobadoCount: c.porEstado.aprobada.count,
    porCobrar: c.facturacion.porCobrar,
    tasaCierre,
    licitacionesVivas,
    licitacionesGanadas: l.porEstatus.ganada.count,
  };
}
