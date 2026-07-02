"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { generateQuote, type GeneratedQuote } from "@/lib/ai/generate-quote";
import { matchClientByName } from "@/lib/clients/match";
import { hasDropboxConfig, listFolder } from "@/lib/dropbox/client";
import { quotesFolder } from "@/lib/dropbox/folders";
import type { LetterData } from "@/lib/quotes/letter";
import { letterTotals } from "@/lib/quotes/letter";
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

// Próximo número de la serie anual (todas las cartas usan "COT DC YY-NNN";
// el rubro es clasificación aparte). Toma el máximo entre la BD y la carpeta
// de cartas en Dropbox — la carpeta es la fuente real del correlativo.
async function nextNumber(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string): Promise<string> {
  const yy = String(new Date().getFullYear()).slice(2);
  const re = new RegExp(`COT\\s+[A-Z]{1,3}\\s+${yy}-(\\d+)`, "i");
  let max = 0;

  const { data } = (await supabase
    .from("sales_quotes")
    .select("quote_number")
    .eq("org_id", orgId)
    .ilike("quote_number", `%${yy}-%`)) as { data: { quote_number: string }[] | null };
  for (const r of data ?? []) {
    const m = r.quote_number.match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }

  if (hasDropboxConfig()) {
    try {
      const entries = await listFolder(quotesFolder());
      for (const e of entries) {
        if (e.tag !== "file") continue;
        const m = e.name.match(re);
        if (m) max = Math.max(max, parseInt(m[1], 10));
      }
    } catch {
      /* sin Dropbox accesible: la BD alcanza */
    }
  }

  return `COT DC ${yy}-${String(max + 1).padStart(3, "0")}`;
}

export type CotizadorDraft = {
  generated: GeneratedQuote;
  suggestedNumber: string;
  matchedClientId: string | null;
  matchedClientName: string | null;
};

export async function generateQuoteDraft(brief: string): Promise<Result<CotizadorDraft>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  if (!brief.trim()) return { error: "Contame qué hay que cotizar" };
  try {
    const { data: clients } = (await c.supabase.from("clients").select("name").eq("org_id", c.orgId).order("name")) as {
      data: { name: string }[] | null;
    };
    const generated = await generateQuote(brief.trim(), (clients ?? []).map((r) => r.name));
    const [suggestedNumber, matched] = await Promise.all([
      nextNumber(c.supabase, c.orgId),
      matchClientByName(c.supabase, c.orgId, generated.client_name),
    ]);
    return {
      ok: true,
      data: {
        generated,
        suggestedNumber,
        matchedClientId: matched?.id ?? null,
        matchedClientName: matched?.name ?? null,
      },
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Error generando la cotización" };
  }
}

export type SaveCotizacionInput = {
  quote_number: string;
  client_name: string;
  rubro: "DC" | "DM" | "DS" | "DV";
  descripcion_corta: string;
  letter: LetterData;
};

export async function saveGeneratedQuote(input: SaveCotizacionInput): Promise<Result<QuoteRow>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  if (!input.quote_number.trim()) return { error: "Número requerido" };
  if (input.letter.items.length === 0) return { error: "Agregá al menos un renglón" };

  const { total } = letterTotals(input.letter);
  const matched = await matchClientByName(c.supabase, c.orgId, input.client_name);
  const year = Number(input.letter.fecha.slice(0, 4)) || new Date().getFullYear();

  const base = {
    org_id: c.orgId,
    quote_number: input.quote_number.trim().toUpperCase(),
    year,
    sent_date: input.letter.fecha,
    amount_usd: Math.round(total * 100) / 100,
    status: "enviada" as const,
    client_name: input.client_name,
    client_id: matched?.id ?? null,
    description: input.descripcion_corta,
    rubro: input.rubro,
    notes: "Generada con el cotizador IA",
    source: "manual" as const,
  };

  // Insert con letter; si la columna no existe (migración 0008 pendiente), sin ella.
  let ins = (await c.supabase
    .from("sales_quotes")
    .insert({ ...base, letter: input.letter })
    .select("id")
    .single()) as { data: { id: string } | null; error: { message: string } | null };
  if (ins.error) {
    ins = (await c.supabase.from("sales_quotes").insert(base).select("id").single()) as {
      data: { id: string } | null;
      error: { message: string } | null;
    };
  }
  if (ins.error || !ins.data) return { error: ins.error?.message ?? "No se pudo guardar" };

  revalidatePath("/potenciales");
  return {
    ok: true,
    data: {
      id: ins.data.id,
      quote_number: base.quote_number,
      year,
      sent_date: base.sent_date,
      amount_usd: base.amount_usd,
      status: "enviada",
      payment_status: null,
      invoice_status: null,
      client_name: base.client_name,
      client_id: matched?.id ?? null,
      client_std_name: matched?.name ?? null,
      location_id: matched?.location_id ?? null,
      location_name: matched?.location_name ?? null,
      contact_name: null,
      contact_phone: null,
      contact_email: null,
      description: base.description,
      notes: base.notes,
      rubro: input.rubro,
      progress: 0,
      follow_up_date: null,
      rejection_reason: null,
      converted_project_id: null,
    },
  };
}
