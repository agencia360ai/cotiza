"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { matchClientByName } from "@/lib/clients/match";
import { nextQuoteNumber } from "@/lib/quotes/store";
import type { LeadRow, LeadStatus, LeadActivity } from "@/lib/leads/types";

type Result<T = void> = { error: string } | (T extends void ? { ok: true } : { ok: true; data: T });

async function ctx() {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { ok: false as const, error: "Sesión expirada" };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false as const, error: "Sin organización" };
  return { ok: true as const, supabase, orgId };
}

const REVALIDATE = "/leads";

const COLS =
  "id, company_name, contact_name, whatsapp, email, description, status, estimated_value, source, next_follow_up, last_contact_at, lost_reason, client_id, converted_quote_id, activity, created_at, updated_at";

function mapRow(r: Record<string, unknown>): LeadRow {
  return {
    id: r.id as string,
    company_name: (r.company_name as string) ?? null,
    contact_name: (r.contact_name as string) ?? null,
    whatsapp: (r.whatsapp as string) ?? null,
    email: (r.email as string) ?? null,
    description: (r.description as string) ?? null,
    status: (r.status as LeadStatus) ?? "nuevo",
    estimated_value: r.estimated_value === null || r.estimated_value === undefined ? null : Number(r.estimated_value),
    source: (r.source as string) ?? null,
    next_follow_up: (r.next_follow_up as string) ?? null,
    last_contact_at: (r.last_contact_at as string) ?? null,
    lost_reason: (r.lost_reason as string) ?? null,
    client_id: (r.client_id as string) ?? null,
    converted_quote_id: (r.converted_quote_id as string) ?? null,
    activity: Array.isArray(r.activity) ? (r.activity as LeadActivity[]) : [],
    created_at: (r.created_at as string) ?? null,
    updated_at: (r.updated_at as string) ?? null,
  };
}

export async function listLeads(): Promise<Result<LeadRow[]>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const { data, error } = (await c.supabase
    .from("leads")
    .select(COLS)
    .eq("org_id", c.orgId)
    .order("updated_at", { ascending: false })) as { data: Record<string, unknown>[] | null; error: { message: string } | null };
  if (error) return { error: error.message };
  return { ok: true, data: (data ?? []).map(mapRow) };
}

export type LeadInput = {
  company_name: string | null;
  contact_name: string | null;
  whatsapp: string | null;
  email: string | null;
  description: string | null;
  status: LeadStatus;
  estimated_value: number | null;
  source: string | null;
  next_follow_up: string | null;
};

export async function createLead(input: LeadInput): Promise<Result<LeadRow>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const company = input.company_name?.trim() || null;
  const contact = input.contact_name?.trim() || null;
  if (!company && !contact) return { error: "Agrega al menos el cliente o el contacto." };
  const matched = await matchClientByName(c.supabase, c.orgId, company);
  const { data, error } = (await c.supabase
    .from("leads")
    .insert({
      org_id: c.orgId,
      company_name: company,
      contact_name: contact,
      whatsapp: input.whatsapp?.trim() || null,
      email: input.email?.trim() || null,
      description: input.description?.trim() || null,
      status: input.status,
      estimated_value: input.estimated_value,
      source: input.source,
      next_follow_up: input.next_follow_up,
      client_id: matched?.id ?? null,
    })
    .select(COLS)
    .single()) as { data: Record<string, unknown> | null; error: { message: string } | null };
  if (error || !data) return { error: error?.message ?? "No se pudo crear el lead" };
  revalidatePath(REVALIDATE);
  return { ok: true, data: mapRow(data) };
}

export async function updateLead(
  id: string,
  patch: Partial<{
    company_name: string | null;
    contact_name: string | null;
    whatsapp: string | null;
    email: string | null;
    description: string | null;
    status: LeadStatus;
    estimated_value: number | null;
    source: string | null;
    next_follow_up: string | null;
    lost_reason: string | null;
  }>,
): Promise<Result> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const { error } = await c.supabase.from("leads").update(patch).eq("id", id).eq("org_id", c.orgId);
  if (error) return { error: error.message };
  revalidatePath(REVALIDATE);
  return { ok: true };
}

// Mover de etapa (drag & drop en el tablero).
export async function setLeadStatus(id: string, status: LeadStatus): Promise<Result> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const { error } = await c.supabase.from("leads").update({ status }).eq("id", id).eq("org_id", c.orgId);
  if (error) return { error: error.message };
  revalidatePath(REVALIDATE);
  return { ok: true };
}

// Registrar una interacción en la bitácora + marcar último contacto. Devuelve la
// bitácora nueva para refrescar la UI. read-modify-write (baja concurrencia).
export async function addLeadNote(id: string, text: string): Promise<Result<{ activity: LeadActivity[]; nowIso: string }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const nota = text.trim();
  if (!nota) return { error: "Escribe la nota." };
  const { data: cur } = (await c.supabase
    .from("leads")
    .select("activity")
    .eq("id", id)
    .eq("org_id", c.orgId)
    .maybeSingle()) as { data: { activity: LeadActivity[] | null } | null };
  const nowIso = new Date().toISOString();
  const activity: LeadActivity[] = [{ at: nowIso, text: nota }, ...(Array.isArray(cur?.activity) ? cur!.activity : [])];
  const { error } = await c.supabase
    .from("leads")
    .update({ activity, last_contact_at: nowIso })
    .eq("id", id)
    .eq("org_id", c.orgId);
  if (error) return { error: error.message };
  revalidatePath(REVALIDATE);
  return { ok: true, data: { activity, nowIso } };
}

export async function deleteLead(id: string): Promise<Result> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const { error } = await c.supabase.from("leads").delete().eq("id", id).eq("org_id", c.orgId);
  if (error) return { error: error.message };
  revalidatePath(REVALIDATE);
  return { ok: true };
}

// Convertir el lead en una cotización (borrador) prellenada con sus datos, y
// dejar el lead en 'cotizado' enlazado a la cotización creada.
export async function convertLeadToQuote(id: string): Promise<Result<{ quoteId: string; quoteNumber: string }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const { data: lead } = (await c.supabase
    .from("leads")
    .select("company_name, contact_name, whatsapp, email, description, converted_quote_id")
    .eq("id", id)
    .eq("org_id", c.orgId)
    .maybeSingle()) as {
    data: {
      company_name: string | null;
      contact_name: string | null;
      whatsapp: string | null;
      email: string | null;
      description: string | null;
      converted_quote_id: string | null;
    } | null;
  };
  if (!lead) return { error: "Lead no encontrado" };
  if (lead.converted_quote_id) return { error: "Este lead ya tiene una cotización creada." };

  const quoteNumber = await nextQuoteNumber(c.supabase, c.orgId);
  const year = Number(new Date().toLocaleDateString("en-CA", { timeZone: "America/Panama" }).slice(0, 4));
  const matched = await matchClientByName(c.supabase, c.orgId, lead.company_name);
  const { data: q, error } = (await c.supabase
    .from("sales_quotes")
    .insert({
      org_id: c.orgId,
      quote_number: quoteNumber,
      year,
      status: "borrador",
      client_name: lead.company_name,
      client_id: matched?.id ?? null,
      contact_name: lead.contact_name,
      contact_phone: lead.whatsapp,
      contact_email: lead.email,
      description: lead.description,
      source: "lead",
    })
    .select("id")
    .single()) as { data: { id: string } | null; error: { message: string } | null };
  if (error || !q) return { error: error?.message ?? "No se pudo crear la cotización" };

  await c.supabase
    .from("leads")
    .update({ status: "cotizado", converted_quote_id: q.id })
    .eq("id", id)
    .eq("org_id", c.orgId);
  revalidatePath(REVALIDATE);
  revalidatePath("/potenciales");
  return { ok: true, data: { quoteId: q.id, quoteNumber } };
}
