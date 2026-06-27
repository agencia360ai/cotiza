import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  snapshotPipelineData,
  type PipelineData,
  type QuoteRow,
  type QuoteStatus,
  type TenderRow,
  type TenderStatus,
} from "./types";

const QUOTE_COLS =
  "id, quote_number, year, sent_date, amount_usd, status, payment_status, invoice_status, client_name, contact_name, contact_phone, contact_email, description, notes, rubro, progress, follow_up_date, rejection_reason, converted_project_id";
// Sin columnas de contacto — fallback si la migración 0002 aún no se aplicó.
const QUOTE_COLS_BASE =
  "id, quote_number, year, sent_date, amount_usd, status, payment_status, invoice_status, client_name, description, notes, rubro, progress, follow_up_date, rejection_reason, converted_project_id";
const TENDER_COLS =
  "id, acto_number, year, modalidad, entity, location_text, objeto, status, execution_status, amount_ref_usd, delivery_date, notes, folder_url, rubro, progress, converted_project_id";

/** Todas las cotizaciones de la org (ambos años) para la tabla editable. */
export async function listQuotes(orgId: string): Promise<QuoteRow[]> {
  if (!orgId) return [];
  const supabase = await createClient();
  const run = (cols: string) =>
    supabase
      .from("sales_quotes")
      .select(cols)
      .eq("org_id", orgId)
      .order("sent_date", { ascending: false, nullsFirst: false })
      .order("quote_number", { ascending: false });
  let res = (await run(QUOTE_COLS)) as { data: QuoteRow[] | null; error: { message: string } | null };
  if (res.error) {
    // La migración de contacto (0002) todavía no se aplicó: caer a columnas base.
    res = (await run(QUOTE_COLS_BASE)) as { data: QuoteRow[] | null; error: { message: string } | null };
  }
  return (res.data ?? []).map((q) => ({
    ...q,
    contact_name: q.contact_name ?? null,
    contact_phone: q.contact_phone ?? null,
    contact_email: q.contact_email ?? null,
    amount_usd: q.amount_usd === null ? null : Number(q.amount_usd),
  }));
}

/** Todas las licitaciones de la org. */
export async function listTenders(orgId: string): Promise<TenderRow[]> {
  if (!orgId) return [];
  const supabase = await createClient();
  const { data } = (await supabase
    .from("tenders")
    .select(TENDER_COLS)
    .eq("org_id", orgId)
    .order("year", { ascending: false, nullsFirst: false })
    .order("acto_number", { ascending: false })) as { data: TenderRow[] | null };
  return (data ?? []).map((t) => ({
    ...t,
    amount_ref_usd: t.amount_ref_usd === null ? null : Number(t.amount_ref_usd),
  }));
}

const QUOTE_STATUSES: QuoteStatus[] = ["enviada", "aprobada", "rechazada"];
const TENDER_STATUSES: TenderStatus[] = ["ganada", "no_ganada", "presentada", "en_revision", "por_partir"];

type QuoteAggRow = { status: string; amount_usd: number | null; invoice_status: string | null };
type TenderAggRow = { status: string; amount_ref_usd: number | null; modalidad: string | null };

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
      .eq("year", year)) as { data: QuoteAggRow[] | null; error: { message: string } | null };
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
      .eq("org_id", orgId)) as { data: TenderAggRow[] | null };

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
