"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { hasDropboxConfig, listFolder, downloadFile } from "@/lib/dropbox/client";
import { parseQuotePdf } from "@/lib/ai/parse-quote-pdf";
import type { QuoteRow } from "@/lib/pipeline/types";

type Result<T> = { error: string } | { ok: true; data: T };

const PDF_RE = /\.pdf$/i;
const IMG_RE = /\.(png|jpe?g|webp)$/i;

function guessNumber(name: string): string | null {
  const m = name.match(/COT\s+[A-Za-z]{1,3}\s+\d{2}-\d{1,4}[A-Za-z]?/i);
  return m ? m[0].replace(/\s+/g, " ").toUpperCase() : null;
}
function yearFromNumber(num: string): number | null {
  const m = num.match(/(\d{2})-\d/);
  return m ? 2000 + Number(m[1]) : null;
}

async function ctx() {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { ok: false as const, error: "Sesión expirada" };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false as const, error: "Sin organización" };
  return { ok: true as const, supabase, orgId };
}

export async function dropboxConfigured(): Promise<boolean> {
  return hasDropboxConfig();
}

export type DropboxFileItem = {
  name: string;
  path: string;
  modified: string | null;
  size: number;
  guessedNumber: string | null;
  alreadyImported: boolean;
};

export async function listDropboxFolder(path: string): Promise<Result<{ files: DropboxFileItem[] }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  if (!hasDropboxConfig()) return { error: "Dropbox no está configurado (faltan las env vars)." };
  try {
    const entries = await listFolder(path);
    const files = entries.filter((e) => e.tag === "file" && (PDF_RE.test(e.name) || IMG_RE.test(e.name)));

    const numbers = files.map((f) => guessNumber(f.name)).filter((n): n is string => !!n);
    const existing = new Set<string>();
    if (numbers.length > 0) {
      const { data } = (await c.supabase
        .from("sales_quotes")
        .select("quote_number")
        .eq("org_id", c.orgId)
        .in("quote_number", numbers)) as { data: { quote_number: string }[] | null };
      for (const r of data ?? []) existing.add(r.quote_number.toUpperCase());
    }

    const items: DropboxFileItem[] = files
      .map((f) => {
        const num = guessNumber(f.name);
        return {
          name: f.name,
          path: f.path,
          modified: f.modified,
          size: f.size,
          guessedNumber: num,
          alreadyImported: num ? existing.has(num.toUpperCase()) : false,
        };
      })
      .sort((a, b) => (b.modified ?? "").localeCompare(a.modified ?? ""));

    return { ok: true, data: { files: items } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Error listando Dropbox" };
  }
}

/** Descarga un PDF, lo parsea con IA y crea la cotización. Una por llamada
 *  (para mostrar progreso y no exceder el timeout). */
export async function importDropboxFile(path: string, name: string): Promise<Result<QuoteRow>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  if (!hasDropboxConfig()) return { error: "Dropbox no configurado." };
  try {
    const isPdf = PDF_RE.test(name);
    const data = await downloadFile(path);
    const parsed = await parseQuotePdf({
      filename: name,
      data,
      isPdf,
      imageMime: isPdf ? undefined : "image/jpeg",
    });

    const number = (parsed.quote_number?.trim() || guessNumber(name) || name).toUpperCase();

    const { data: dup } = (await c.supabase
      .from("sales_quotes")
      .select("id")
      .eq("org_id", c.orgId)
      .eq("quote_number", number)
      .maybeSingle()) as { data: { id: string } | null };
    if (dup) return { error: `Ya existe ${number}` };

    const year = (parsed.sent_date ? Number(parsed.sent_date.slice(0, 4)) : yearFromNumber(number)) || new Date().getFullYear();

    const { data: row, error } = (await c.supabase
      .from("sales_quotes")
      .insert({
        org_id: c.orgId,
        quote_number: number,
        year,
        sent_date: parsed.sent_date,
        amount_usd: parsed.amount_usd,
        status: "enviada",
        client_name: parsed.client_name,
        description: parsed.description,
        rubro: parsed.rubro,
        notes: `Importado de Dropbox: ${name}`,
        source: "dropbox",
      })
      .select("id")
      .single()) as { data: { id: string } | null; error: { message: string } | null };
    if (error || !row) return { error: error?.message ?? "No se pudo guardar" };

    revalidatePath("/maintenance/potenciales");
    return {
      ok: true,
      data: {
        id: row.id,
        quote_number: number,
        year,
        sent_date: parsed.sent_date,
        amount_usd: parsed.amount_usd,
        status: "enviada",
        payment_status: null,
        invoice_status: null,
        client_name: parsed.client_name,
        contact_name: null,
        contact_phone: null,
        contact_email: null,
        description: parsed.description,
        notes: `Importado de Dropbox: ${name}`,
        rubro: parsed.rubro,
        progress: 0,
        follow_up_date: null,
        rejection_reason: null,
        converted_project_id: null,
      },
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Error importando" };
  }
}
