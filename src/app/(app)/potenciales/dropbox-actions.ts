"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { hasDropboxConfig, listFolder, downloadFile } from "@/lib/dropbox/client";
import { parseQuotePdf } from "@/lib/ai/parse-quote-pdf";
import { matchClientByName } from "@/lib/clients/match";
import type { QuoteRow } from "@/lib/pipeline/types";

type Result<T> = { error: string } | { ok: true; data: T };

const PDF_RE = /\.pdf$/i;
const IMG_RE = /\.(png|jpe?g|webp)$/i;

// (C) Captura el número incluyendo sufijos de revisión (Rev 2, R1.1) y letra
// (A/B), para que las revisiones NO colapsen al mismo número.
function guessNumber(name: string): string | null {
  const m = name.match(/COT\s+[A-Za-z]{1,3}\s+\d{2}-\d{1,4}[A-Za-z]?(?:\s+(?:rev\.?\s*\d+|r\d+(?:\.\d+)?))?/i);
  return m ? m[0].replace(/\s+/g, " ").trim().toUpperCase() : null;
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
  fileId: string;
  modified: string | null;
  size: number;
  guessedNumber: string | null;
  // (A) ya importada por archivo (mismo file-id). Si la migración 0003 no está,
  // cae a dedup por número.
  alreadyImported: boolean;
  // (B) archivo nuevo cuyo número coincide con una cotización existente: no se
  // saltea, se avisa y el usuario decide.
  possibleDuplicate: { number: string; client: string | null; amount: number | null } | null;
};

export async function listDropboxFolder(path: string): Promise<Result<{ files: DropboxFileItem[] }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  if (!hasDropboxConfig()) return { error: "Dropbox no está configurado (faltan las env vars)." };
  try {
    const entries = await listFolder(path);
    const files = entries.filter((e) => e.tag === "file" && (PDF_RE.test(e.name) || IMG_RE.test(e.name)));

    // (A) ¿qué file-ids ya están importados? (resiliente: si la columna no existe aún)
    let fileIdSupported = true;
    const importedFileIds = new Set<string>();
    {
      const ids = files.map((f) => f.id);
      if (ids.length > 0) {
        const { data, error } = (await c.supabase
          .from("sales_quotes")
          .select("dropbox_file_id")
          .eq("org_id", c.orgId)
          .in("dropbox_file_id", ids)) as { data: { dropbox_file_id: string | null }[] | null; error: { message: string } | null };
        if (error) fileIdSupported = false;
        else for (const r of data ?? []) if (r.dropbox_file_id) importedFileIds.add(r.dropbox_file_id);
      }
    }

    // (B) cotizaciones existentes por número, para avisar de posibles duplicados.
    const byNumber = new Map<string, { client: string | null; amount: number | null }>();
    const numbers = files.map((f) => guessNumber(f.name)).filter((n): n is string => !!n);
    if (numbers.length > 0) {
      const { data } = (await c.supabase
        .from("sales_quotes")
        .select("quote_number, client_name, amount_usd")
        .eq("org_id", c.orgId)
        .in("quote_number", numbers)) as { data: { quote_number: string; client_name: string | null; amount_usd: number | null }[] | null };
      for (const r of data ?? []) {
        if (!byNumber.has(r.quote_number.toUpperCase())) {
          byNumber.set(r.quote_number.toUpperCase(), { client: r.client_name, amount: r.amount_usd === null ? null : Number(r.amount_usd) });
        }
      }
    }

    const items: DropboxFileItem[] = files
      .map((f) => {
        const num = guessNumber(f.name);
        const importedByFile = fileIdSupported && importedFileIds.has(f.id);
        const numMatch = num ? byNumber.get(num.toUpperCase()) : undefined;
        // Sin soporte de file-id (migración pendiente): caemos a dedup por número.
        const alreadyImported = importedByFile || (!fileIdSupported && !!numMatch);
        const possibleDuplicate =
          !alreadyImported && numMatch ? { number: num!, client: numMatch.client, amount: numMatch.amount } : null;
        return {
          name: f.name,
          path: f.path,
          fileId: f.id,
          modified: f.modified,
          size: f.size,
          guessedNumber: num,
          alreadyImported,
          possibleDuplicate,
        };
      })
      .sort((a, b) => (b.modified ?? "").localeCompare(a.modified ?? ""));

    return { ok: true, data: { files: items } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Error listando Dropbox" };
  }
}

export async function importDropboxFile(path: string, name: string, fileId: string): Promise<Result<QuoteRow>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  if (!hasDropboxConfig()) return { error: "Dropbox no configurado." };
  try {
    // (A) dedup por archivo (si la columna existe).
    if (fileId) {
      const { data: existsF, error } = (await c.supabase
        .from("sales_quotes")
        .select("id")
        .eq("org_id", c.orgId)
        .eq("dropbox_file_id", fileId)
        .maybeSingle()) as { data: { id: string } | null; error: { message: string } | null };
      if (!error && existsF) return { error: "Este archivo ya fue importado" };
    }

    const isPdf = PDF_RE.test(name);
    const data = await downloadFile(path);
    const parsed = await parseQuotePdf({ filename: name, data, isPdf, imageMime: isPdf ? undefined : "image/jpeg" });

    const number = (parsed.quote_number?.trim() || guessNumber(name) || name).toUpperCase();
    const year = (parsed.sent_date ? Number(parsed.sent_date.slice(0, 4)) : yearFromNumber(number)) || new Date().getFullYear();
    const notes = `Importado de Dropbox: ${name}`;
    const matched = await matchClientByName(c.supabase, c.orgId, parsed.client_name);
    const locOk = !(await c.supabase.from("sales_quotes").select("location_id").limit(1)).error;

    const base = {
      org_id: c.orgId,
      quote_number: number,
      year,
      sent_date: parsed.sent_date,
      amount_usd: parsed.amount_usd,
      status: "enviada" as const,
      client_name: parsed.client_name,
      client_id: matched?.id ?? null,
      ...(locOk ? { location_id: matched?.location_id ?? null } : {}),
      description: parsed.description,
      rubro: parsed.rubro,
      notes,
      source: "dropbox" as const,
    };

    // Insert con file-id/path; si la columna no existe (migración 0003 pendiente),
    // reintenta sin ellas.
    let ins = (await c.supabase
      .from("sales_quotes")
      .insert({ ...base, dropbox_file_id: fileId, dropbox_path: path })
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
        quote_number: number,
        year,
        sent_date: parsed.sent_date,
        amount_usd: parsed.amount_usd,
        status: "enviada",
        payment_status: null,
        invoice_status: null,
        client_name: parsed.client_name,
        client_id: matched?.id ?? null,
        client_std_name: matched?.name ?? null,
        location_id: matched?.location_id ?? null,
        location_name: matched?.location_name ?? null,
        dropbox_shared_url: null,
        contact_name: null,
        contact_phone: null,
        contact_email: null,
        description: parsed.description,
        notes,
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
