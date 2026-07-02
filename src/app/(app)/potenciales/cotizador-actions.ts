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
  updateQuoteLetter,
  publishQuote as publishQuoteCore,
  type DraftBundle,
  type SaveQuoteInput,
  type PublishOut,
  type Db,
} from "@/lib/quotes/store";
import type { QuoteImage } from "@/lib/ai/generate-quote";
import type { LetterData } from "@/lib/quotes/letter";
import type { QuoteRow, Rubro } from "@/lib/pipeline/types";

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

export async function generateQuoteDraft(brief: string, image?: QuoteImage | null): Promise<Result<CotizadorDraft>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  if (!brief.trim() && !image) return { error: "Contame qué hay que cotizar (o subí una foto)" };
  try {
    return { ok: true, data: await buildQuoteDraft(c.supabase, c.orgId, brief.trim(), image ?? null) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Error generando la cotización" };
  }
}

// Carta guardada de una cotización (para que un admin termine un borrador).
export type QuoteLetterBundle = {
  id: string;
  quote_number: string;
  client_name: string;
  client_std_name: string | null;
  rubro: Rubro;
  descripcion_corta: string;
  letter: LetterData;
};

export async function getQuoteLetter(quoteId: string): Promise<Result<QuoteLetterBundle>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  type Row = {
    id: string;
    quote_number: string;
    sent_date: string | null;
    client_name: string | null;
    description: string | null;
    amount_usd: number | null;
    rubro: Rubro | null;
    letter: LetterData | null;
    client: { name: string } | null;
    location: { name: string } | null;
  };
  const run = (cols: string) => c.supabase.from("sales_quotes").select(cols).eq("id", quoteId).eq("org_id", c.orgId).maybeSingle();
  let res = (await run(
    "id, quote_number, sent_date, client_name, description, amount_usd, rubro, letter, client:clients(name), location:client_locations(name)",
  )) as { data: Row | null; error: { message: string } | null };
  if (res.error) {
    res = (await run(
      "id, quote_number, sent_date, client_name, description, amount_usd, rubro, client:clients(name), location:client_locations(name)",
    )) as { data: Row | null; error: { message: string } | null };
  }
  const q = res.data;
  if (!q) return { error: "Cotización no encontrada" };
  const letter: LetterData =
    q.letter ?? {
      fecha: q.sent_date ?? new Date().toISOString().slice(0, 10),
      ubicacion: q.location?.name ?? null,
      tipo: "realizar",
      items: [{ cant: 1, desc: q.description ?? "", precio: q.amount_usd ?? 0 }],
      aplica_itbms: false,
      tasa: 7,
      validez: 30,
      condiciones: null,
      elaborado: null,
    };
  return {
    ok: true,
    data: {
      id: q.id,
      quote_number: q.quote_number,
      client_name: q.client_name ?? q.client?.name ?? "",
      client_std_name: q.client?.name ?? null,
      rubro: q.rubro ?? "DS",
      descripcion_corta: q.description ?? "",
      letter,
    },
  };
}

export async function updateGeneratedQuote(quoteId: string, input: SaveCotizacionInput): Promise<Result<QuoteRow>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const r = await updateQuoteLetter(c.supabase, c.orgId, quoteId, input);
  if ("error" in r) return { error: r.error };
  revalidatePath("/potenciales");
  return { ok: true, data: r.row };
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
