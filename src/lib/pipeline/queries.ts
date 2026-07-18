import "server-only";
import { createClient } from "@/lib/supabase/server";
import { groupRevisions } from "./revisions";
import {
  emptyPipelineData,
  type PipelineData,
  type QuoteRow,
  type QuoteStatus,
  type TenderRow,
  type TenderStatus,
} from "./types";

// "la columna no existe" (migración pendiente → fallback OK) vs error real
// (RLS/conexión), que NO se debe degradar a lista vacía en silencio.
function isMissingColumn(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42703") return true;
  return /does not exist|could not find|schema cache/i.test(error.message ?? "");
}

const QUOTE_JOIN = "client_id, client:clients(name)";
const LOC_JOIN = "location_id, location:client_locations(name)";

// PostgREST corta en 1000 filas por request: TODA lista "completa" debe paginar
// o, pasadas 1000 cotizaciones, el board y los KPIs se calculan sobre un
// subconjunto silenciosamente (mismo bug ya corregido en gov_tenders).
const PAGE = 1000;
type PgErr = { message: string; code?: string } | null;
async function fetchAll<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PgErr }>,
): Promise<{ data: T[]; error: PgErr }> {
  const out: T[] = [];
  for (let from = 0; from < 100_000; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1);
    if (error) return { data: out, error };
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) break;
  }
  return { data: out, error: null };
}
const QUOTE_COLS =
  `id, quote_number, year, sent_date, amount_usd, status, payment_status, invoice_status, client_name, contact_name, contact_phone, contact_email, description, notes, rubro, progress, follow_up_date, rejection_reason, converted_project_id, ${QUOTE_JOIN}`;
// Sin columnas de contacto — fallback si la migración 0002 aún no se aplicó.
const QUOTE_COLS_BASE =
  `id, quote_number, year, sent_date, amount_usd, status, payment_status, invoice_status, client_name, description, notes, rubro, progress, follow_up_date, rejection_reason, converted_project_id, ${QUOTE_JOIN}`;
const TENDER_COLS =
  "id, acto_number, year, modalidad, entity, location_text, objeto, status, execution_status, amount_ref_usd, delivery_date, notes, folder_url, rubro, progress, converted_project_id, client_id, client:clients(name)";
const TENDER_QBO_COLS = "qbo_job_id, qbo_sent_at";

/** Todas las cotizaciones de la org (ambos años) para la tabla editable. */
export async function listQuotes(orgId: string): Promise<QuoteRow[]> {
  if (!orgId) return [];
  const supabase = await createClient();
  type Raw = Omit<
    QuoteRow,
    "client_std_name" | "location_name" | "dropbox_shared_url" | "dropbox_path" | "qbo_job_id" | "qbo_sent_at" | "seguimiento_descartado_at" | "seguimiento_descartado_motivo"
  > & {
    client: { name: string } | null;
    location?: { name: string } | null;
    dropbox_shared_url?: string | null;
    dropbox_path?: string | null;
    qbo_job_id?: string | null;
    qbo_sent_at?: string | null;
    seguimiento_descartado_at?: string | null;
    seguimiento_descartado_motivo?: string | null;
  };
  type Res = { data: Raw[] | null; error: ({ message: string; code?: string }) | null };
  const run = (cols: string) =>
    fetchAll<Raw>(
      (from, to) =>
        supabase
          .from("sales_quotes")
          .select(cols)
          .eq("org_id", orgId)
          .order("sent_date", { ascending: false, nullsFirst: false })
          .order("quote_number", { ascending: false })
          .order("id", { ascending: true }) // tiebreaker estable entre páginas
          .range(from, to) as unknown as PromiseLike<{ data: Raw[] | null; error: PgErr }>,
    );
  const QBO_COLS = "qbo_job_id, qbo_sent_at, seguimiento_descartado_at, seguimiento_descartado_motivo";
  let res = (await run(`${QUOTE_COLS}, ${LOC_JOIN}, dropbox_shared_url, dropbox_path, ${QBO_COLS}`)) as Res;
  if (isMissingColumn(res.error)) res = (await run(`${QUOTE_COLS}, ${LOC_JOIN}, dropbox_shared_url, dropbox_path`)) as Res; // sin 0022
  if (isMissingColumn(res.error)) res = (await run(`${QUOTE_COLS}, ${LOC_JOIN}, dropbox_path`)) as Res; // sin shared_url (0009 pendiente)
  if (isMissingColumn(res.error)) res = (await run(`${QUOTE_COLS}, ${LOC_JOIN}`)) as Res; // sin dropbox_path (0003 pendiente)
  if (isMissingColumn(res.error)) res = (await run(QUOTE_COLS)) as Res; // sin location (migración 0005 pendiente)
  if (isMissingColumn(res.error)) res = (await run(QUOTE_COLS_BASE)) as Res; // sin contacto (0002 pendiente)
  // Un error real (no de columna faltante) no debe verse como "sin cotizaciones".
  if (res.error) throw new Error(`No se pudieron cargar las cotizaciones: ${res.error.message}`);
  return (res.data ?? []).map(({ client, location, ...q }) => ({
    ...q,
    client_id: q.client_id ?? null,
    client_std_name: client?.name ?? null,
    location_id: q.location_id ?? null,
    location_name: location?.name ?? null,
    dropbox_shared_url: q.dropbox_shared_url ?? null,
    dropbox_path: q.dropbox_path ?? null,
    contact_name: q.contact_name ?? null,
    contact_phone: q.contact_phone ?? null,
    contact_email: q.contact_email ?? null,
    qbo_job_id: q.qbo_job_id ?? null,
    qbo_sent_at: q.qbo_sent_at ?? null,
    seguimiento_descartado_at: q.seguimiento_descartado_at ?? null,
    seguimiento_descartado_motivo: q.seguimiento_descartado_motivo ?? null,
    amount_usd: q.amount_usd === null ? null : Number(q.amount_usd),
  }));
}

/** Todas las licitaciones de la org. */
export async function listTenders(orgId: string): Promise<TenderRow[]> {
  if (!orgId) return [];
  const supabase = await createClient();
  type Raw = Omit<TenderRow, "client_std_name" | "location_name" | "qbo_job_id" | "qbo_sent_at"> & {
    client: { name: string } | null;
    location?: { name: string } | null;
    qbo_job_id?: string | null;
    qbo_sent_at?: string | null;
  };
  type Res = { data: Raw[] | null; error: PgErr };
  const run = (cols: string) =>
    fetchAll<Raw>(
      (from, to) =>
        supabase
          .from("tenders")
          .select(cols)
          .eq("org_id", orgId)
          .order("year", { ascending: false, nullsFirst: false })
          .order("acto_number", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: Raw[] | null; error: PgErr }>,
    );
  let res = (await run(`${TENDER_COLS}, ${LOC_JOIN}, ${TENDER_QBO_COLS}`)) as Res;
  if (isMissingColumn(res.error)) res = (await run(`${TENDER_COLS}, ${LOC_JOIN}`)) as Res; // sin 0024
  // Solo degradar si la columna falta (0005 pendiente); un error real (RLS,
  // conexión) NO debe verse como "0 licitaciones".
  if (isMissingColumn(res.error)) res = (await run(TENDER_COLS)) as Res;
  if (res.error) throw new Error(`No se pudieron cargar las licitaciones: ${res.error.message}`);
  return (res.data ?? []).map(({ client, location, ...t }) => ({
    ...t,
    client_id: t.client_id ?? null,
    client_std_name: client?.name ?? null,
    location_id: t.location_id ?? null,
    location_name: location?.name ?? null,
    qbo_job_id: t.qbo_job_id ?? null,
    qbo_sent_at: t.qbo_sent_at ?? null,
    amount_ref_usd: t.amount_ref_usd === null ? null : Number(t.amount_ref_usd),
  }));
}

const QUOTE_STATUSES: QuoteStatus[] = ["borrador", "enviada", "aprobada", "rechazada"];
const TENDER_STATUSES: TenderStatus[] = ["por_participar", "ganada", "orden_proceder", "por_cobrar", "cobrado", "no_ganada", "presentada", "en_revision", "por_partir"];

type QuoteAggRow = {
  quote_number: string;
  sent_date: string | null;
  status: string;
  amount_usd: number | null;
  invoice_status: string | null;
};
type TenderAggRow = { status: string; amount_ref_usd: number | null; modalidad: string | null };

function emptyByStatus<T extends string>(keys: T[]): Record<T, { count: number; monto: number }> {
  return Object.fromEntries(keys.map((k) => [k, { count: 0, monto: 0 }])) as Record<
    T,
    { count: number; monto: number }
  >;
}

/**
 * Agregados del pipeline para una org. Lee de `sales_quotes` / `tenders`. Si la
 * org no tiene cotizaciones en el año, devuelve un pipeline vacío (ceros) — NO
 * el snapshot demo, para no mostrar cifras fabricadas. Misma forma de datos.
 */
export async function getPipelineData(orgId: string, year = 2026): Promise<PipelineData> {
  if (!orgId) return emptyPipelineData(year);
  try {
    const supabase = await createClient();

    const { data: quotes, error: qErr } = await fetchAll<QuoteAggRow>(
      (from, to) =>
        supabase
          .from("sales_quotes")
          .select("quote_number, sent_date, status, amount_usd, invoice_status")
          .eq("org_id", orgId)
          .eq("year", year)
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: QuoteAggRow[] | null; error: PgErr }>,
    );
    if (qErr) throw new Error(qErr.message);
    if (!quotes || quotes.length === 0) return emptyPipelineData(year);

    // Borradores fuera ANTES de agrupar: un borrador con nº de revisión no debe
    // ganar como "vigente" y esconder la rev publicada real. Luego, solo la rev
    // vigente de cada base cuenta — misma lógica que la página de Cotizaciones.
    const publicadas = quotes.filter((q) => q.status !== "borrador");
    const vigentes = groupRevisions(publicadas).map((g) => g.main);

    const porEstado = emptyByStatus(QUOTE_STATUSES);
    const facturacion = { cobrada: 0, porCobrar: 0, sinEstado: 0 };
    let cTotalCount = 0;
    let cTotalMonto = 0;
    for (const q of vigentes) {
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
    const { data: tenders } = await fetchAll<TenderAggRow>(
      (from, to) =>
        supabase
          .from("tenders")
          .select("status, amount_ref_usd, modalidad")
          .eq("org_id", orgId)
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: TenderAggRow[] | null; error: PgErr }>,
    );

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
    // Ante un error, ceros (no cifras demo). La UI muestra un tablero vacío,
    // que es honesto, en vez de datos fabricados.
    return emptyPipelineData(year);
  }
}
