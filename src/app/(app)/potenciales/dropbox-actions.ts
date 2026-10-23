"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { sinAcceso } from "@/lib/acceso";
import { hasDropboxConfig, listFolder, downloadFile } from "@/lib/dropbox/client";
import { parseQuotePdf } from "@/lib/ai/parse-quote-pdf";
import { matchClientByName } from "@/lib/clients/match";
import type { QuoteRow } from "@/lib/pipeline/types";
import { estadoNumeracion, type Db, type EstadoNumeracion } from "@/lib/quotes/store";
import { mismoNumero, numeroBase, numeroEnTexto, revisionSiguiente } from "@/lib/quotes/numeracion";
import { parseRev } from "@/lib/pipeline/revisions";
import { subirPdfManual, usosDelNumero, type DatosPdf, type Original, type UsoNumero } from "@/lib/quotes/subir-pdf";

type Result<T> = { error: string } | { ok: true; data: T };

const PDF_RE = /\.pdf$/i;
const IMG_RE = /\.(png|jpe?g|webp)$/i;

// (C) Captura el número incluyendo sufijos de revisión (Rev 2, R1.1) y letra
// (A/B), para que las revisiones NO colapsen al mismo número.
const guessNumber = numeroEnTexto;
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
  // Dropbox se lee con la cuenta de la empresa: RLS no llega.
  const sinPermiso = await sinAcceso("cotizaciones");
  if (sinPermiso) return { ok: false as const, error: sinPermiso };
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
    // MIME real según extensión: declarar "jpeg" para un .png hace que la API
    // de Claude rechace la imagen (bytes ≠ media_type declarado).
    const imageMime = isPdf
      ? undefined
      : /\.png$/i.test(name)
        ? ("image/png" as const)
        : /\.webp$/i.test(name)
          ? ("image/webp" as const)
          : ("image/jpeg" as const);
    const parsed = await parseQuotePdf({ filename: name, data, isPdf, imageMime });

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

    // Insert con file-id/path; SOLO si la columna no existe (migración 0003
    // pendiente) se reintenta sin ellas — ante un error real, reintentar sin el
    // file-id crearía una fila que el dedup por archivo nunca volvería a ver
    // (el mismo PDF aparecería como "nuevo" y se podría importar dos veces).
    let ins = (await c.supabase
      .from("sales_quotes")
      .insert({ ...base, dropbox_file_id: fileId, dropbox_path: path })
      .select("id")
      .single()) as { data: { id: string } | null; error: { message: string; code?: string } | null };
    const missingCol = ins.error && (ins.error.code === "42703" || /does not exist|could not find|schema cache/i.test(ins.error.message));
    if (missingCol) {
      ins = (await c.supabase.from("sales_quotes").insert(base).select("id").single()) as {
        data: { id: string } | null;
        error: { message: string; code?: string } | null;
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
        dropbox_path: path,
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
        qbo_job_id: null,
        qbo_sent_at: null,
        qbo_project_no: null,
        seguimiento_descartado_at: null,
        seguimiento_descartado_motivo: null,
      },
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Error importando" };
  }
}

// ── Próximo número y PDF hechos a mano ───────────────────────────────────────

export async function getProximoNumero(): Promise<Result<EstadoNumeracion>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  try {
    return { ok: true, data: await estadoNumeracion(c.supabase as unknown as Db, c.orgId) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo calcular el próximo número" };
  }
}

const MAX_PDF = 5_500_000; // el server action acepta 8 MB, y base64 infla ~33%

function pdfDe(base64: string): Buffer | string {
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0) return "Archivo vacío";
  if (bytes.length > MAX_PDF) return "El PDF pesa más de 5.5 MB";
  if (bytes.subarray(0, 4).toString() !== "%PDF") return "El archivo no es un PDF";
  return bytes;
}

export type LecturaPdf = {
  datos: DatosPdf;
  usos: UsoNumero[];
  siguiente: string;
  // La IA no pudo leerlo (sin saldo, PDF escaneado ilegible…): los datos van a
  // mano, pero el archivo se puede subir igual.
  iaError: string | null;
  aviso?: string | null;
};

/** Lee el PDF (con IA) y dice si su número ya está usado. No sube nada. */
export async function leerPdfManual(nombre: string, base64: string): Promise<Result<LecturaPdf>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const pdf = pdfDe(base64);
  if (typeof pdf === "string") return { error: pdf };

  let parsed: Awaited<ReturnType<typeof parseQuotePdf>> | null = null;
  let iaError: string | null = null;
  try {
    parsed = await parseQuotePdf({ filename: nombre, data: pdf, isPdf: true });
  } catch (e) {
    iaError = e instanceof Error ? e.message : "No se pudo leer con IA";
  }
  // El número que se VE en la cotización manda; el del nombre del archivo es
  // el respaldo.
  const numero = (parsed?.quote_number && numeroEnTexto(parsed.quote_number)) || numeroEnTexto(nombre) || "";
  const db = c.supabase as unknown as Db;
  const [usos, estado] = await Promise.all([numero ? usosDelNumero(db, c.orgId, numero) : Promise.resolve([]), estadoNumeracion(db, c.orgId)]);
  return {
    ok: true,
    data: {
      datos: {
        quote_number: numero,
        client_name: parsed?.client_name ?? null,
        amount_usd: parsed?.amount_usd ?? null,
        sent_date: parsed?.sent_date ?? null,
        description: parsed?.description ?? null,
        rubro: parsed?.rubro ?? null,
      },
      usos,
      siguiente: estado.siguiente,
      iaError,
    },
  };
}

/**
 * Para volver a avisar cuando cambian el número a mano. En una revisión las
 * demás revisiones del número son lo esperado: solo cuenta la misma exacta.
 */
export async function revisarNumeroCotizacion(numero: string, soloExacto = false): Promise<Result<UsoNumero[]>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const usos = await usosDelNumero(c.supabase as unknown as Db, c.orgId, numero);
  return { ok: true, data: soloExacto ? usos.filter((u) => mismoNumero(u.numero, numero)) : usos };
}

/** Sube el PDF a Dropbox sin tocarlo y crea la cotización. */
export async function subirPdfCotizacion(
  nombre: string,
  base64: string,
  datos: DatosPdf,
): Promise<Result<{ row: QuoteRow; aviso: string | null }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const pdf = pdfDe(base64);
  if (typeof pdf === "string") return { error: pdf };
  try {
    const r = await subirPdfManual(c.supabase as unknown as Db, c.orgId, { nombre, bytes: pdf, datos });
    if ("error" in r) return { error: r.error };
    revalidatePath("/potenciales");
    return { ok: true, data: { row: r.row, aviso: r.aviso } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo subir el PDF" };
  }
}

// ── Revisión de una cotización que ya existe ─────────────────────────────────

async function cargarOriginal(c: { supabase: Awaited<ReturnType<typeof createClient>>; orgId: string }, id: string): Promise<Original | null> {
  type Raw = Omit<Original, "client_std_name" | "location_name"> & { client: { name: string } | null; location: { name: string } | null };
  const { data } = (await c.supabase
    .from("sales_quotes")
    .select(
      "id, quote_number, status, client_name, client_id, location_id, contact_name, contact_phone, contact_email, description, amount_usd, rubro, client:clients(name), location:client_locations(name)",
    )
    .eq("org_id", c.orgId)
    .eq("id", id)
    .maybeSingle()) as { data: Raw | null };
  if (!data) return null;
  const { client, location, ...q } = data;
  return {
    ...q,
    client_std_name: client?.name ?? null,
    location_name: location?.name ?? null,
    amount_usd: q.amount_usd === null ? null : Number(q.amount_usd),
  };
}

/**
 * Lee el PDF de la revisión y propone su número: el que dice el PDF si es de
 * esta cotización y está libre, o la REV que sigue a todas las que ya hay en la
 * plataforma y en Dropbox. Cliente y contacto son los de la original.
 */
export async function leerRevisionPdf(quoteId: string, nombre: string, base64: string): Promise<Result<LecturaPdf>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const pdf = pdfDe(base64);
  if (typeof pdf === "string") return { error: pdf };
  const original = await cargarOriginal(c, quoteId);
  if (!original) return { error: "No encontré la cotización" };
  const base = numeroBase(original.quote_number);
  if (!base) return { error: `${original.quote_number} no tiene la forma "COT DC 26-211": corregí el número antes de subirle una revisión` };

  let parsed: Awaited<ReturnType<typeof parseQuotePdf>> | null = null;
  let iaError: string | null = null;
  try {
    parsed = await parseQuotePdf({ filename: nombre, data: pdf, isPdf: true });
  } catch (e) {
    iaError = e instanceof Error ? e.message : "No se pudo leer con IA";
  }

  const usosBase = await usosDelNumero(c.supabase as unknown as Db, c.orgId, base);
  const usados = [original.quote_number, ...usosBase.map((u) => u.numero)];
  const siguiente = revisionSiguiente(base, usados);
  const delPdf = (parsed?.quote_number && numeroEnTexto(parsed.quote_number)) || numeroEnTexto(nombre);
  const pdfSirve = delPdf !== null && numeroBase(delPdf) === base && parseRev(delPdf).rev > 0 && !usados.some((u) => mismoNumero(u, delPdf));
  const numero = pdfSirve ? delPdf : siguiente;

  // El PDF es lo que ve el cliente: si dice otro número, que se sepa antes de subirlo.
  const aviso =
    delPdf && numeroBase(delPdf) !== base
      ? `El PDF dice ${delPdf}, no ${base}: revisá que sea una revisión de esta cotización.`
      : delPdf && !mismoNumero(delPdf, numero)
        ? `El PDF dice ${delPdf}; se registra como ${numero}. Si el cliente tiene que ver ${numero}, corregilo en el PDF antes de subirlo.`
        : null;

  return {
    ok: true,
    data: {
      datos: {
        quote_number: numero,
        client_name: original.client_name,
        amount_usd: parsed?.amount_usd ?? original.amount_usd,
        sent_date: parsed?.sent_date ?? new Date().toLocaleDateString("en-CA", { timeZone: "America/Panama" }),
        description: parsed?.description ?? original.description,
        rubro: original.rubro ?? parsed?.rubro ?? null,
      },
      usos: usosBase.filter((u) => mismoNumero(u.numero, numero)),
      siguiente,
      iaError,
      aviso,
    },
  };
}

/** Sube el PDF de la revisión a Dropbox sin tocarlo y la crea con el cliente de la original. */
export async function subirRevisionPdf(
  quoteId: string,
  nombre: string,
  base64: string,
  datos: DatosPdf,
): Promise<Result<{ row: QuoteRow; aviso: string | null }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const pdf = pdfDe(base64);
  if (typeof pdf === "string") return { error: pdf };
  const original = await cargarOriginal(c, quoteId);
  if (!original) return { error: "No encontré la cotización" };
  try {
    const r = await subirPdfManual(c.supabase as unknown as Db, c.orgId, {
      nombre,
      bytes: pdf,
      datos: { ...datos, client_name: original.client_name },
      revisionDe: original,
    });
    if ("error" in r) return { error: r.error };
    revalidatePath("/potenciales");
    return { ok: true, data: { row: r.row, aviso: r.aviso } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo subir la revisión" };
  }
}
