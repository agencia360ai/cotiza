import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  snapshotPipelineData,
  type PipelineData,
  type QuoteStatus,
  type TenderStatus,
} from "./types";

const QUOTE_STATUSES: QuoteStatus[] = ["enviada", "aprobada", "rechazada"];
const TENDER_STATUSES: TenderStatus[] = ["ganada", "no_ganada", "presentada", "en_revision", "por_partir"];

type QuoteRow = { status: string; amount_usd: number | null; invoice_status: string | null };
type TenderRow = { status: string; amount_ref_usd: number | null; modalidad: string | null };

function emptyByStatus<T extends string>(keys: T[]): Record<T, { count: number; monto: number }> {
  return Object.fromEntries(keys.map((k) => [k, { count: 0, monto: 0 }])) as Record<
    T,
    { count: number; monto: number }
  >;
}

/**
 * Agregados del pipeline para una org. Lee de `sales_quotes` / `tenders` y, si
 * las tablas están vacías o todavía no existen (Fase C sin aplicar), cae al
 * snapshot del Excel. La UI no cambia: misma forma de datos.
 */
export async function getPipelineData(orgId: string, year = 2026): Promise<PipelineData> {
  if (!orgId) return snapshotPipelineData();
  try {
    const supabase = await createClient();

    const { data: quotes, error: qErr } = (await supabase
      .from("sales_quotes")
      .select("status, amount_usd, invoice_status")
      .eq("org_id", orgId)
      .eq("year", year)) as { data: QuoteRow[] | null; error: { message: string } | null };
    if (qErr) throw new Error(qErr.message);
    if (!quotes || quotes.length === 0) return snapshotPipelineData();

    const porEstado = emptyByStatus(QUOTE_STATUSES);
    const facturacion = { cobrada: 0, porCobrar: 0, sinEstado: 0 };
    let cTotalCount = 0;
    let cTotalMonto = 0;
    for (const q of quotes) {
      const monto = Number(q.amount_usd) || 0;
      cTotalCount += 1;
      cTotalMonto += monto;
      const st = q.status as QuoteStatus;
      if (porEstado[st]) {
        porEstado[st].count += 1;
        porEstado[st].monto += monto;
      }
      if (st === "aprobada") {
        if (q.invoice_status === "cancelada") facturacion.cobrada += 1;
        else if (q.invoice_status === "pendiente") facturacion.porCobrar += 1;
        else facturacion.sinEstado += 1;
      }
    }

    // Licitaciones — todas (no se filtran por año, igual que el resumen DICEC).
    const { data: tenders } = (await supabase
      .from("tenders")
      .select("status, amount_ref_usd, modalidad")
      .eq("org_id", orgId)) as { data: TenderRow[] | null };

    const porEstatus = emptyByStatus(TENDER_STATUSES);
    const mod = { publica: 0, compraMenor: 0, contratacionMenor: 0 };
    let tTotalCount = 0;
    let tTotalMonto = 0;
    for (const t of tenders ?? []) {
      const monto = Number(t.amount_ref_usd) || 0;
      tTotalCount += 1;
      tTotalMonto += monto;
      const st = t.status as TenderStatus;
      if (porEstatus[st]) {
        porEstatus[st].count += 1;
        porEstatus[st].monto += monto;
      }
      if (t.modalidad === "licitacion_publica") mod.publica += 1;
      else if (t.modalidad === "compra_menor") mod.compraMenor += 1;
      else if (t.modalidad === "contratacion_menor") mod.contratacionMenor += 1;
    }

    return {
      year,
      live: true,
      cotizaciones: {
        total: { count: cTotalCount, monto: cTotalMonto },
        porEstado,
        facturacion,
      },
      licitaciones: {
        total: { count: tTotalCount, monto: tTotalMonto },
        porEstatus,
        porModalidad: {
          publica: { label: "Licitación Pública", count: mod.publica },
          compraMenor: { label: "Compra Menor", count: mod.compraMenor },
          contratacionMenor: { label: "Contratación Menor", count: mod.contratacionMenor },
        },
      },
    };
  } catch {
    return snapshotPipelineData();
  }
}
