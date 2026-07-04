"use server";

import { createAdminClient, hasAdminCredentials } from "@/lib/supabase/admin";
import {
  buildQuoteDraft,
  insertQuote,
  publishQuote as publishQuoteCore,
  type DraftBundle,
  type SaveQuoteInput,
  type PublishOut,
  type Db,
} from "@/lib/quotes/store";
import type { QuoteImage } from "@/lib/ai/generate-quote";
import type { QuoteRow } from "@/lib/pipeline/types";

type Result<T> = { error: string } | { ok: true; data: T };

// Valida el token del portal y devuelve el org. Todo corre con el admin client
// (server-only); el ingeniero no necesita cuenta.
async function orgFromToken(token: string): Promise<{ ok: true; db: Db; orgId: string } | { ok: false; error: string }> {
  // Token = random de 48 hex o código corto memorizable (3–30 chars). El match
  // exacto contra organizations.cotizador_token es lo que realmente valida.
  if (!token || token.length < 3 || token.length > 64) return { ok: false, error: "Link inválido" };
  if (!hasAdminCredentials()) return { ok: false, error: "El portal no está configurado (falta SUPABASE_SERVICE_ROLE_KEY)" };
  const admin = createAdminClient() as unknown as Db;
  const { data, error } = (await admin.from("organizations").select("id").eq("cotizador_token", token).maybeSingle()) as {
    data: { id: string } | null;
    error: { message: string } | null;
  };
  if (error || !data) return { ok: false, error: "Link inválido o revocado" };
  return { ok: true, db: admin, orgId: data.id };
}

export async function portalGenerate(token: string, brief: string, image?: QuoteImage | null): Promise<Result<DraftBundle>> {
  const c = await orgFromToken(token);
  if (!c.ok) return { error: c.error };
  if (!brief.trim() && !image) return { error: "Contame qué hay que cotizar (o subí una foto)" };
  try {
    return { ok: true, data: await buildQuoteDraft(c.db, c.orgId, brief.trim(), image ?? null) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Error generando la cotización" };
  }
}

export async function portalSave(token: string, input: SaveQuoteInput): Promise<Result<QuoteRow>> {
  const c = await orgFromToken(token);
  if (!c.ok) return { error: c.error };
  const r = await insertQuote(c.db, c.orgId, { ...input, elaborado_por: input.letter.elaborado ?? input.elaborado_por ?? null });
  if ("error" in r) return { error: r.error };
  return { ok: true, data: r.row };
}

export async function portalPublish(token: string, quoteId: string): Promise<Result<PublishOut>> {
  const c = await orgFromToken(token);
  if (!c.ok) return { error: c.error };
  // El portal (sin login) solo puede publicar BORRADORES — lo que él mismo crea.
  // Sin este chequeo, con el token se podría forzar la publicación (y acuñar un
  // link público de Dropbox) de cualquier cotización de la org, incluidas las
  // enviadas/aprobadas confidenciales.
  const { data: q } = (await c.db
    .from("sales_quotes")
    .select("status")
    .eq("id", quoteId)
    .eq("org_id", c.orgId)
    .maybeSingle()) as { data: { status: string } | null };
  if (!q) return { error: "Cotización no encontrada" };
  if (q.status !== "borrador") return { error: "Esta cotización ya no es un borrador" };
  const r = await publishQuoteCore(c.db, c.orgId, quoteId);
  if ("error" in r) return { error: r.error };
  return { ok: true, data: r.data };
}
