"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import type { LetterData, LetterFirma, LetterTextos } from "@/lib/quotes/letter";

type Result<T> = { error: string } | { ok: true; data: T };

async function ctx() {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { ok: false as const, error: "Sesión expirada" };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false as const, error: "Sin organización" };
  return { ok: true as const, supabase, orgId, userId: u.user.id };
}

function faltaMigracion(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "42703") return true;
  return /does not exist|could not find|schema cache/i.test(error.message ?? "");
}

const MIGRACION_0036 = "Falta la migración 0036 (quote_signatures) — corre el SQL en Supabase y reintenta.";

export type Signature = { id: string; label: string; data_url: string };

export async function listSignatures(): Promise<Result<Signature[]>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const { data, error } = (await c.supabase
    .from("quote_signatures")
    .select("id, label, data_url")
    .eq("org_id", c.orgId)
    .order("created_at", { ascending: true })) as {
    data: Signature[] | null;
    error: { message: string; code?: string } | null;
  };
  if (faltaMigracion(error)) return { error: MIGRACION_0036 };
  if (error) return { error: error.message };
  return { ok: true, data: data ?? [] };
}

// ~1.4 MB de data URL ≈ 1 MB de PNG. Una firma real pesa mucho menos; el tope
// evita que alguien suba una foto enorme y engorde la fila.
const MAX_DATA_URL = 1_400_000;

export async function createSignature(label: string, dataUrl: string): Promise<Result<Signature>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const nombre = label.trim();
  if (!nombre) return { error: "Ponle un nombre a la firma (p. ej. quién firma)." };
  if (!/^data:image\/(png|jpe?g);base64,/i.test(dataUrl)) return { error: "La firma debe ser una imagen PNG o JPG." };
  if (dataUrl.length > MAX_DATA_URL) return { error: "La imagen es muy pesada (máx. ~1 MB). Recórtala o bájale la resolución." };

  const { data, error } = (await c.supabase
    .from("quote_signatures")
    .insert({ org_id: c.orgId, label: nombre, data_url: dataUrl, created_by: c.userId })
    .select("id, label, data_url")
    .single()) as { data: Signature | null; error: { message: string; code?: string } | null };
  if (faltaMigracion(error)) return { error: MIGRACION_0036 };
  if (error || !data) return { error: error?.message ?? "No se pudo guardar la firma" };
  return { ok: true, data };
}

export async function deleteSignature(id: string): Promise<Result<{ id: string }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const { error } = await c.supabase.from("quote_signatures").delete().eq("id", id).eq("org_id", c.orgId);
  if (faltaMigracion(error)) return { error: MIGRACION_0036 };
  if (error) return { error: error.message };
  return { ok: true, data: { id } };
}

// Guarda SOLO los textos reescritos y la firma. El resto de la carta (renglones,
// fecha, ITBMS…) se preserva tal cual: este editor no los toca.
export async function saveLetterEdits(
  quoteId: string,
  textos: LetterTextos,
  firma: LetterFirma | null,
): Promise<Result<{ saved: true }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };

  const { data: q, error: readErr } = (await c.supabase
    .from("sales_quotes")
    .select("letter")
    .eq("id", quoteId)
    .eq("org_id", c.orgId)
    .maybeSingle()) as { data: { letter: LetterData | null } | null; error: { message: string; code?: string } | null };
  if (faltaMigracion(readErr)) return { error: "Falta la migración 0008 (letter) — corre el SQL en Supabase." };
  if (readErr) return { error: readErr.message };
  if (!q) return { error: "Cotización no encontrada" };
  if (!q.letter) return { error: "Esta cotización todavía no tiene carta guardada. Ábrela en el cotizador y guárdala primero." };

  const letter: LetterData = { ...q.letter, textos, firma };
  const { error } = await c.supabase.from("sales_quotes").update({ letter }).eq("id", quoteId).eq("org_id", c.orgId);
  if (error) return { error: error.message };

  revalidatePath(`/carta/${quoteId}`);
  revalidatePath("/potenciales");
  return { ok: true, data: { saved: true } };
}
