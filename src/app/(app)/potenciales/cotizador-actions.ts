"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase/admin";
import { getActiveOrgId } from "@/lib/org-context";
import {
  buildQuoteDraft,
  insertQuote,
  publishQuote as publishQuoteCore,
  type DraftBundle,
  type SaveQuoteInput,
  type PublishOut,
  type Db,
} from "@/lib/quotes/store";
import type { QuoteRow } from "@/lib/pipeline/types";

type Result<T> = { error: string } | { ok: true; data: T };

async function ctx() {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { ok: false as const, error: "Sesión expirada" };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false as const, error: "Sin organización" };
  return { ok: true as const, supabase, orgId };
}

export type CotizadorDraft = DraftBundle;
export type SaveCotizacionInput = SaveQuoteInput;

export async function generateQuoteDraft(brief: string): Promise<Result<CotizadorDraft>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  if (!brief.trim()) return { error: "Contame qué hay que cotizar" };
  try {
    return { ok: true, data: await buildQuoteDraft(c.supabase, c.orgId, brief.trim()) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Error generando la cotización" };
  }
}

export async function saveGeneratedQuote(input: SaveCotizacionInput): Promise<Result<QuoteRow>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const r = await insertQuote(c.supabase, c.orgId, input);
  if ("error" in r) return { error: r.error };
  revalidatePath("/potenciales");
  return { ok: true, data: r.row };
}

export async function publishQuote(quoteId: string): Promise<Result<PublishOut>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const r = await publishQuoteCore(c.supabase, c.orgId, quoteId);
  if ("error" in r) return { error: r.error };
  revalidatePath("/potenciales");
  return { ok: true, data: r.data };
}

// ── Link del portal para ingenieros (/q/<token>) ─────────────────────────────

async function portalUrl(token: string): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  return `${proto}://${host}/q/${token}`;
}

export async function getEngineerLink(): Promise<Result<{ url: string | null }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const { data, error } = (await c.supabase
    .from("organizations")
    .select("cotizador_token")
    .eq("id", c.orgId)
    .maybeSingle()) as { data: { cotizador_token: string | null } | null; error: { message: string } | null };
  if (error) return { error: "Falta la migración 0009 (cotizador_token)" };
  return { ok: true, data: { url: data?.cotizador_token ? await portalUrl(data.cotizador_token) : null } };
}

export async function regenerateEngineerLink(): Promise<Result<{ url: string }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  if (!hasAdminCredentials()) return { error: "SUPABASE_SERVICE_ROLE_KEY no está configurada" };
  const token = randomBytes(24).toString("hex");
  const admin = createAdminClient() as unknown as Db;
  const { error } = await admin.from("organizations").update({ cotizador_token: token }).eq("id", c.orgId);
  if (error) return { error: error.message };
  return { ok: true, data: { url: await portalUrl(token) } };
}
