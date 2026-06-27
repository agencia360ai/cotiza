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

export type QuoteStatus = "enviada" | "aprobada" | "rechazada";

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  enviada: "Enviada",
  aprobada: "Aprobada",
  rechazada: "Rechazada",
};
export const QUOTE_STATUS_COLOR: Record<QuoteStatus, string> = {
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

export function formatMoney(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
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

// Derivados útiles para el dashboard.
export function pipelineDerived() {
  const c = PIPELINE_SNAPSHOT.cotizaciones;
  const l = PIPELINE_SNAPSHOT.licitaciones;
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
