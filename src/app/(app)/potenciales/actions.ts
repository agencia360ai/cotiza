"use server";

import { revalidatePath } from "next/cache";
import { notificarCotizacionAprobada } from "@/lib/quotes/notify";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import type { ProjectType } from "@/lib/projects/types";
import type { QuoteStatus, Rubro, TenderStatus, TenderRow, Modalidad } from "@/lib/pipeline/types";
import { listTenders } from "@/lib/pipeline/queries";
import { matchClientByName } from "@/lib/clients/match";
import { norm } from "@/lib/clients/normalize";

type Result<T = void> = { error: string } | (T extends void ? { ok: true; warning?: string } : { ok: true; data: T; warning?: string });

async function ctx() {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { ok: false as const, error: "Sesión expirada" };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false as const, error: "Sin organización" };
  return { ok: true as const, supabase, orgId, userId: u.user.id, userEmail: u.user.email ?? null };
}

const REVALIDATE = "/potenciales";

// ¿Existe location_id? (migración 0005). Evita romper create/update si falta.
async function locationSupported(supabase: Awaited<ReturnType<typeof createClient>>): Promise<boolean> {
  return !(await supabase.from("sales_quotes").select("location_id").limit(1)).error;
}

// ── Cotizaciones ────────────────────────────────────────────────────────────

export async function updateQuote(
  id: string,
  patch: Partial<{
    quote_number: string;
    sent_date: string | null;
    amount_usd: number | null;
    status: QuoteStatus;
    payment_status: "facturado" | null;
    invoice_status: "pendiente" | "cancelada" | null;
    client_name: string | null;
    client_id: string | null;
    location_id: string | null;
    contact_name: string | null;
    contact_phone: string | null;
    contact_email: string | null;
    description: string | null;
    notes: string | null;
    rubro: Rubro | null;
    follow_up_date: string | null;
    rejection_reason: string | null;
    qbo_project_no: string | null;
  }>,
): Promise<Result> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const p = { ...patch };
  if ("location_id" in p && !(await locationSupported(c.supabase))) delete p.location_id;
  // Estado ANTES de guardar: el aviso sale solo en la TRANSICIÓN a aprobada, no
  // cada vez que se guarda una cotización que ya estaba aprobada.
  let recienAprobada = false;
  if (p.status === "aprobada") {
    const { data: previo } = (await c.supabase
      .from("sales_quotes")
      .select("status")
      .eq("id", id)
      .eq("org_id", c.orgId)
      .maybeSingle()) as { data: { status: string } | null };
    recienAprobada = !!previo && previo.status !== "aprobada";
  }
  const { error } = await c.supabase.from("sales_quotes").update(p).eq("id", id).eq("org_id", c.orgId);
  // 0037 pendiente: se guarda el RESTO (no perder lo demás que se editó) pero se
  // AVISA — el Nº de proyecto lo escribe el usuario a mano y creer que quedó
  // guardado cuando no es peor que fallar.
  if (error && "qbo_project_no" in p && /qbo_project_no/.test(error.message ?? "")) {
    delete p.qbo_project_no;
    const reintento = await c.supabase.from("sales_quotes").update(p).eq("id", id).eq("org_id", c.orgId);
    if (reintento.error) return { error: reintento.error.message };
    return { error: "Se guardó todo menos el Nº de proyecto: falta la migración 0037 — corre el SQL en Supabase." };
  }
  if (error) return { error: error.message };
  // Aviso a administración para registrar el proyecto en QBO a mano. Best-effort:
  // un fallo de correo NO debe deshacer ni ensuciar el guardado del usuario.
  let avisoCorreo: string | null = null;
  if (recienAprobada) {
    try {
      avisoCorreo = await notificarCotizacionAprobada(c.supabase, c.orgId, id, c.userEmail ?? null);
    } catch (e) {
      avisoCorreo = e instanceof Error ? e.message : "no se pudo enviar";
    }
    if (avisoCorreo) console.error("[cotiza] aviso de aprobación falló:", avisoCorreo);
  }
  // Aprende del ajuste manual: guarda el alias (con sucursal si se asignó) para
  // que la próxima importación con ese mismo nombre se auto-linkee.
  // ignoreDuplicates:false → una CORRECCIÓN (mismo alias, otro cliente) sí
  // actualiza el mapeo; con DO NOTHING el alias viejo seguía auto-linkeando mal.
  if (patch.client_id && patch.client_name) {
    await c.supabase
      .from("client_aliases")
      .upsert(
        { org_id: c.orgId, client_id: patch.client_id, location_id: patch.location_id ?? null, alias_norm: norm(patch.client_name), source: "manual" },
        { onConflict: "org_id,alias_norm", ignoreDuplicates: false },
      );
  }
  revalidatePath(REVALIDATE);
  // El guardado fue bien; si el correo falló, se reporta como AVISO (no error):
  // la cotización quedó aprobada, pero administración no fue notificada.
  return avisoCorreo ? { ok: true, warning: `Se guardó, pero el aviso por correo no salió: ${avisoCorreo}` } : { ok: true };
}

export async function createQuote(input: {
  quote_number: string;
  year: number;
  sent_date: string | null;
  amount_usd: number | null;
  status: QuoteStatus;
  client_name: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  description: string | null;
  rubro: Rubro | null;
  follow_up_date: string | null;
}): Promise<Result<{ id: string; client_id: string | null; client_std_name: string | null; location_id: string | null; location_name: string | null }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  if (!input.quote_number.trim()) return { error: "Número requerido" };
  const matched = await matchClientByName(c.supabase, c.orgId, input.client_name);
  const base = {
    org_id: c.orgId,
    quote_number: input.quote_number.trim(),
    year: input.year,
    sent_date: input.sent_date,
    amount_usd: input.amount_usd,
    status: input.status,
    client_name: input.client_name,
    client_id: matched?.id ?? null,
    contact_name: input.contact_name,
    contact_phone: input.contact_phone,
    contact_email: input.contact_email,
    description: input.description,
    rubro: input.rubro,
    follow_up_date: input.follow_up_date,
    source: "manual" as const,
  };
  const insertObj = (await locationSupported(c.supabase)) ? { ...base, location_id: matched?.location_id ?? null } : base;
  const { data, error } = (await c.supabase.from("sales_quotes").insert(insertObj).select("id").single()) as {
    data: { id: string } | null;
    error: { message: string } | null;
  };
  if (error || !data) return { error: error?.message ?? "No se pudo crear" };
  revalidatePath(REVALIDATE);
  return {
    ok: true,
    data: {
      id: data.id,
      client_id: matched?.id ?? null,
      client_std_name: matched?.name ?? null,
      location_id: matched?.location_id ?? null,
      location_name: matched?.location_name ?? null,
    },
  };
}

export async function deleteQuote(id: string): Promise<Result> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const { error } = await c.supabase.from("sales_quotes").delete().eq("id", id).eq("org_id", c.orgId);
  if (error) return { error: error.message };
  revalidatePath(REVALIDATE);
  return { ok: true };
}

/** Crea un proyecto a partir de una cotización aprobada y los enlaza. */
export async function convertQuoteToProject(
  quoteId: string,
  opts: {
    clientId: string | null;
    newClientName: string | null;
    name: string;
    projectType: ProjectType;
    locationLabel: string | null;
  },
): Promise<Result<{ projectId: string }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  if (!opts.name.trim()) return { error: "Nombre del proyecto requerido" };

  // Chequear ANTES de crear nada: cotización existe y no fue ya convertida.
  // (Antes se creaba el cliente nuevo primero → cliente huérfano al reconvertir.)
  const { data: quote } = (await c.supabase
    .from("sales_quotes")
    .select("description, converted_project_id")
    .eq("id", quoteId)
    .eq("org_id", c.orgId)
    .maybeSingle()) as { data: { description: string | null; converted_project_id: string | null } | null };
  if (!quote) return { error: "No se encontró la cotización" };
  if (quote.converted_project_id) return { error: "Esta cotización ya fue convertida a proyecto" };

  // Resolver cliente: existente o crear uno nuevo desde el nombre.
  let clientId = opts.clientId;
  if (!clientId) {
    const name = opts.newClientName?.trim();
    if (!name) return { error: "Elige o crea un cliente" };
    const { data: nc, error: ce } = (await c.supabase
      .from("clients")
      .insert({ org_id: c.orgId, name })
      .select("id")
      .single()) as { data: { id: string } | null; error: { message: string } | null };
    if (ce || !nc) return { error: ce?.message ?? "No se pudo crear el cliente" };
    clientId = nc.id;
  }

  const { data: project, error: pe } = (await c.supabase
    .from("client_projects")
    .insert({
      org_id: c.orgId,
      client_id: clientId,
      name: opts.name.trim(),
      project_type: opts.projectType,
      description_es: quote?.description ?? null,
      new_location_label: opts.locationLabel?.trim() || null,
      status: "planificado",
      created_by_user_id: c.userId,
    })
    .select("id")
    .single()) as { data: { id: string } | null; error: { message: string } | null };
  if (pe || !project) return { error: pe?.message ?? "No se pudo crear el proyecto" };

  // Backlink con guarda: .select() para detectar el caso "0 filas actualizadas"
  // (dos conversiones concurrentes — la otra ganó). Sin el select, un update
  // vacío pasaba como éxito y quedaba un proyecto huérfano duplicado.
  const { data: linked, error: linkErr } = (await c.supabase
    .from("sales_quotes")
    .update({ converted_project_id: project.id })
    .eq("id", quoteId)
    .eq("org_id", c.orgId)
    .is("converted_project_id", null)
    .select("id")) as { data: { id: string }[] | null; error: { message: string } | null };
  if (linkErr || !linked || linked.length === 0) {
    await c.supabase.from("client_projects").delete().eq("id", project.id).eq("org_id", c.orgId);
    return { error: linkErr ? linkErr.message : "Esta cotización ya fue convertida a proyecto" };
  }

  revalidatePath(REVALIDATE);
  revalidatePath("/proyectos");
  return { ok: true, data: { projectId: project.id } };
}

// ── Licitaciones ──────────────────────────────────────────────────────────

export async function updateTender(
  id: string,
  patch: Partial<{
    status: TenderStatus;
    execution_status: string | null;
    amount_ref_usd: number | null;
    delivery_date: string | null;
    notes: string | null;
    folder_url: string | null;
    rubro: Rubro | null;
    client_id: string | null;
    location_id: string | null;
    qbo_project_no: string | null;
  }>,
): Promise<Result> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const p = { ...patch };
  if ("location_id" in p && !(await locationSupported(c.supabase))) delete p.location_id;
  const { error } = await c.supabase.from("tenders").update(p).eq("id", id).eq("org_id", c.orgId);
  // 0038 pendiente: se guarda el resto, pero se AVISA — el Nº lo escribe el
  // usuario y creer que quedó guardado cuando no, es peor que fallar.
  if (error && "qbo_project_no" in p && /qbo_project_no/.test(error.message)) {
    delete p.qbo_project_no;
    const reintento = await c.supabase.from("tenders").update(p).eq("id", id).eq("org_id", c.orgId);
    if (reintento.error) return { error: reintento.error.message };
    return { error: "Se guardó todo menos el Nº de proyecto: falta la migración 0038." };
  }
  if (error) return { error: error.message };
  revalidatePath(REVALIDATE);
  return { ok: true };
}

// Crear licitación MANUAL en Mis Licitaciones — para procesos donde ya se
// participó y que no vienen de PanamaCompra (o son viejos). source='manual'.
export async function createManualTender(input: {
  acto_number: string | null;
  entity: string | null;
  objeto: string | null;
  modalidad: Modalidad | null;
  status: TenderStatus;
  amount_ref_usd: number | null;
  delivery_date: string | null;
  rubro: Rubro | null;
  folder_url: string | null;
  notes: string | null;
  client_id: string | null;
  execution_status: string | null;
}): Promise<Result<{ id: string }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const entity = input.entity?.trim() || null;
  const objeto = input.objeto?.trim() || null;
  if (!entity && !objeto) return { error: "Agrega al menos la entidad o el objeto de la licitación." };
  const row: Record<string, unknown> = {
    org_id: c.orgId,
    acto_number: input.acto_number?.trim() || null,
    // Año del acto: de la fecha de entrega si la hay, si no el año actual.
    year: input.delivery_date ? Number(input.delivery_date.slice(0, 4)) : new Date().getFullYear(),
    modalidad: input.modalidad,
    entity,
    objeto,
    status: input.status,
    execution_status: input.execution_status?.trim() || null,
    amount_ref_usd: input.amount_ref_usd,
    delivery_date: input.delivery_date,
    rubro: input.rubro,
    folder_url: input.folder_url?.trim() || null,
    notes: input.notes?.trim() || null,
    client_id: input.client_id,
    source: "manual",
  };
  const { data, error } = (await c.supabase.from("tenders").insert(row).select("id").single()) as {
    data: { id: string } | null;
    error: { message: string } | null;
  };
  if (error || !data) return { error: error?.message ?? "No se pudo crear la licitación" };
  revalidatePath(REVALIDATE);
  return { ok: true, data: { id: data.id } };
}

// Cambio rápido de estatus (picker inline en Mis Licitaciones).
export async function setTenderStatus(id: string, status: TenderStatus): Promise<Result> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const { error } = await c.supabase.from("tenders").update({ status }).eq("id", id).eq("org_id", c.orgId);
  if (error) return { error: error.message };
  revalidatePath(REVALIDATE);
  return { ok: true };
}

// Archivar / desarchivar una licitación (la esconde de la lista, no la borra).
export async function setTenderArchived(id: string, archived: boolean): Promise<Result> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const { error } = await c.supabase
    .from("tenders")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("org_id", c.orgId);
  if (error) return { error: /does not exist|schema cache|column/i.test(error.message) ? "Falta la migración 0035 — corre el SQL y reintenta." : error.message };
  revalidatePath(REVALIDATE);
  return { ok: true };
}

// Nº del proyecto de QBO al que corresponde la licitación (se escribe a mano:
// el proyecto se crea directo en QuickBooks). Vacío = borrar.
export async function setTenderProjectNo(id: string, numero: string | null): Promise<Result> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const v = numero?.trim() ? numero.trim().toUpperCase() : null;
  const { error } = await c.supabase.from("tenders").update({ qbo_project_no: v }).eq("id", id).eq("org_id", c.orgId);
  if (error) {
    return { error: /qbo_project_no/.test(error.message) ? "Falta la migración 0038 — corre el SQL y reintenta." : error.message };
  }
  revalidatePath(REVALIDATE);
  return { ok: true };
}

// Recarga las licitaciones propias (tras participar desde el board del gobierno).
export async function listMyTenders(): Promise<Result<TenderRow[]>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  try {
    const tenders = await listTenders(c.orgId);
    return { ok: true, data: tenders };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudieron cargar las licitaciones" };
  }
}
