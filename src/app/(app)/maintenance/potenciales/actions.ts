"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import type { ProjectType } from "@/lib/projects/types";
import type { QuoteStatus, Rubro, TenderStatus } from "@/lib/pipeline/types";
import { matchClientByName } from "@/lib/clients/match";
import { norm } from "@/lib/clients/normalize";

type Result<T = void> = { error: string } | (T extends void ? { ok: true } : { ok: true; data: T });

async function ctx() {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { ok: false as const, error: "Sesión expirada" };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false as const, error: "Sin organización" };
  return { ok: true as const, supabase, orgId, userId: u.user.id };
}

const REVALIDATE = "/maintenance/potenciales";

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
    contact_name: string | null;
    contact_phone: string | null;
    contact_email: string | null;
    description: string | null;
    notes: string | null;
    rubro: Rubro | null;
    follow_up_date: string | null;
    rejection_reason: string | null;
  }>,
): Promise<Result> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const { error } = await c.supabase
    .from("sales_quotes")
    .update(patch)
    .eq("id", id)
    .eq("org_id", c.orgId);
  if (error) return { error: error.message };
  // Aprendé del ajuste manual: guardá el alias para que la próxima importación
  // con ese mismo nombre se auto-linkee.
  if (patch.client_id && patch.client_name) {
    await c.supabase
      .from("client_aliases")
      .upsert(
        { org_id: c.orgId, client_id: patch.client_id, alias_norm: norm(patch.client_name), source: "manual" },
        { onConflict: "org_id,alias_norm", ignoreDuplicates: true },
      );
  }
  revalidatePath(REVALIDATE);
  return { ok: true };
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
}): Promise<Result<{ id: string; client_id: string | null; client_std_name: string | null }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  if (!input.quote_number.trim()) return { error: "Número requerido" };
  const matched = await matchClientByName(c.supabase, c.orgId, input.client_name);
  const { data, error } = (await c.supabase
    .from("sales_quotes")
    .insert({
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
      source: "manual",
    })
    .select("id")
    .single()) as { data: { id: string } | null; error: { message: string } | null };
  if (error || !data) return { error: error?.message ?? "No se pudo crear" };
  revalidatePath(REVALIDATE);
  return { ok: true, data: { id: data.id, client_id: matched?.id ?? null, client_std_name: matched?.name ?? null } };
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

  // Resolver cliente: existente o crear uno nuevo desde el nombre.
  let clientId = opts.clientId;
  if (!clientId) {
    const name = opts.newClientName?.trim();
    if (!name) return { error: "Elegí o creá un cliente" };
    const { data: nc, error: ce } = (await c.supabase
      .from("clients")
      .insert({ org_id: c.orgId, name })
      .select("id")
      .single()) as { data: { id: string } | null; error: { message: string } | null };
    if (ce || !nc) return { error: ce?.message ?? "No se pudo crear el cliente" };
    clientId = nc.id;
  }

  const { data: quote } = (await c.supabase
    .from("sales_quotes")
    .select("description, converted_project_id")
    .eq("id", quoteId)
    .eq("org_id", c.orgId)
    .maybeSingle()) as { data: { description: string | null; converted_project_id: string | null } | null };
  if (quote?.converted_project_id) {
    return { error: "Esta cotización ya fue convertida a proyecto" };
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

  await c.supabase
    .from("sales_quotes")
    .update({ converted_project_id: project.id })
    .eq("id", quoteId)
    .eq("org_id", c.orgId);

  revalidatePath(REVALIDATE);
  revalidatePath("/maintenance/projects");
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
  }>,
): Promise<Result> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const { error } = await c.supabase.from("tenders").update(patch).eq("id", id).eq("org_id", c.orgId);
  if (error) return { error: error.message };
  revalidatePath(REVALIDATE);
  return { ok: true };
}
