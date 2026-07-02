import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateQuote, type GeneratedQuote, type QuoteImage } from "@/lib/ai/generate-quote";
import { matchClientByName } from "@/lib/clients/match";
import { hasDropboxConfig, listFolder, uploadFile, getSharedLink } from "@/lib/dropbox/client";
import { quotesFolder } from "@/lib/dropbox/folders";
import { letterTotals, type LetterData } from "./letter";
import { renderQuotePdf } from "./pdf";
import type { QuoteRow } from "@/lib/pipeline/types";

// Core del cotizador, compartido entre las actions autenticadas y el portal de
// ingenieros (/q/<token>, admin client). El caller resuelve orgId y permisos.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = SupabaseClient<any, any, any>;

const asMatchDb = (db: Db) => db as unknown as Parameters<typeof matchClientByName>[0];

// Próximo número de la serie anual única "COT DC YY-NNN". Máximo entre la BD y
// la carpeta de cartas en Dropbox (la carpeta es la fuente real del correlativo).
export async function nextQuoteNumber(db: Db, orgId: string): Promise<string> {
  const yy = String(new Date().getFullYear()).slice(2);
  const re = new RegExp(`COT\\s+[A-Z]{1,3}\\s+${yy}-(\\d+)`, "i");
  let max = 0;

  const { data } = (await db.from("sales_quotes").select("quote_number").eq("org_id", orgId).ilike("quote_number", `%${yy}-%`)) as {
    data: { quote_number: string }[] | null;
  };
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

export type DraftBundle = {
  generated: GeneratedQuote;
  suggestedNumber: string;
  matchedClientId: string | null;
  matchedClientName: string | null;
};

export async function buildQuoteDraft(db: Db, orgId: string, brief: string, image?: QuoteImage | null): Promise<DraftBundle> {
  const { data: clients } = (await db.from("clients").select("name").eq("org_id", orgId).order("name")) as {
    data: { name: string }[] | null;
  };
  const generated = await generateQuote(brief, (clients ?? []).map((r) => r.name), image);
  const [suggestedNumber, matched] = await Promise.all([
    nextQuoteNumber(db, orgId),
    matchClientByName(asMatchDb(db), orgId, generated.client_name),
  ]);
  return {
    generated,
    suggestedNumber,
    matchedClientId: matched?.id ?? null,
    matchedClientName: matched?.name ?? null,
  };
}

export type SaveQuoteInput = {
  quote_number: string;
  client_name: string;
  rubro: "DC" | "DM" | "DS" | "DV";
  descripcion_corta: string;
  letter: LetterData;
  elaborado_por?: string | null; // nota de quién la hizo (portal)
};

// Guarda como BORRADOR (el PDF aún no existe). Fallbacks: si la migración 0009
// (status borrador) o la 0008 (letter) no están, degrada con gracia.
export async function insertQuote(db: Db, orgId: string, input: SaveQuoteInput): Promise<{ error: string } | { ok: true; row: QuoteRow }> {
  if (!input.quote_number.trim()) return { error: "Número requerido" };
  if (input.letter.items.length === 0) return { error: "Agregá al menos un renglón" };

  const { total } = letterTotals(input.letter);
  const matched = await matchClientByName(asMatchDb(db), orgId, input.client_name);
  const year = Number(input.letter.fecha.slice(0, 4)) || new Date().getFullYear();

  const base = {
    org_id: orgId,
    quote_number: input.quote_number.trim().toUpperCase(),
    year,
    sent_date: input.letter.fecha,
    amount_usd: Math.round(total * 100) / 100,
    client_name: input.client_name,
    client_id: matched?.id ?? null,
    description: input.descripcion_corta,
    rubro: input.rubro,
    notes: input.elaborado_por ? `Cotizador IA · elaborada por ${input.elaborado_por}` : "Generada con el cotizador IA",
    source: "manual" as const,
  };

  const attempts: Record<string, unknown>[] = [
    { ...base, status: "borrador", letter: input.letter },
    { ...base, status: "borrador" },
    { ...base, status: "enviada", letter: input.letter },
    { ...base, status: "enviada" },
  ];
  let id: string | null = null;
  let statusUsed: "borrador" | "enviada" = "borrador";
  let lastErr = "No se pudo guardar";
  for (const payload of attempts) {
    const { data, error } = (await db.from("sales_quotes").insert(payload).select("id").single()) as {
      data: { id: string } | null;
      error: { message: string } | null;
    };
    if (!error && data) {
      id = data.id;
      statusUsed = payload.status as "borrador" | "enviada";
      break;
    }
    lastErr = error?.message ?? lastErr;
  }
  if (!id) return { error: lastErr };

  return {
    ok: true,
    row: {
      id,
      quote_number: base.quote_number,
      year,
      sent_date: base.sent_date,
      amount_usd: base.amount_usd,
      status: statusUsed,
      payment_status: null,
      invoice_status: null,
      client_name: base.client_name,
      client_id: matched?.id ?? null,
      client_std_name: matched?.name ?? null,
      location_id: matched?.location_id ?? null,
      location_name: matched?.location_name ?? null,
      dropbox_shared_url: null,
      dropbox_path: null,
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

// Actualiza una cotización existente (terminar un borrador): campos + carta.
// No toca el estado; publicar es el paso siguiente.
export async function updateQuoteLetter(
  db: Db,
  orgId: string,
  quoteId: string,
  input: SaveQuoteInput,
): Promise<{ error: string } | { ok: true; row: QuoteRow }> {
  if (!input.quote_number.trim()) return { error: "Número requerido" };
  if (input.letter.items.length === 0) return { error: "Agregá al menos un renglón" };

  const { data: cur } = (await db
    .from("sales_quotes")
    .select("status, dropbox_shared_url, dropbox_path, contact_name, contact_phone, contact_email, notes, follow_up_date")
    .eq("id", quoteId)
    .eq("org_id", orgId)
    .maybeSingle()) as {
    data: {
      status: QuoteRow["status"];
      dropbox_shared_url?: string | null;
      dropbox_path?: string | null;
      contact_name: string | null;
      contact_phone: string | null;
      contact_email: string | null;
      notes: string | null;
      follow_up_date: string | null;
    } | null;
  };
  if (!cur) return { error: "Cotización no encontrada" };

  const { total } = letterTotals(input.letter);
  const matched = await matchClientByName(asMatchDb(db), orgId, input.client_name);
  const year = Number(input.letter.fecha.slice(0, 4)) || new Date().getFullYear();

  const patch = {
    quote_number: input.quote_number.trim().toUpperCase(),
    year,
    sent_date: input.letter.fecha,
    amount_usd: Math.round(total * 100) / 100,
    client_name: input.client_name,
    client_id: matched?.id ?? null,
    description: input.descripcion_corta,
    rubro: input.rubro,
  };
  let upd = await db.from("sales_quotes").update({ ...patch, letter: input.letter }).eq("id", quoteId).eq("org_id", orgId);
  if (upd.error) upd = await db.from("sales_quotes").update(patch).eq("id", quoteId).eq("org_id", orgId);
  if (upd.error) return { error: upd.error.message };

  return {
    ok: true,
    row: {
      id: quoteId,
      quote_number: patch.quote_number,
      year,
      sent_date: patch.sent_date,
      amount_usd: patch.amount_usd,
      status: cur.status,
      payment_status: null,
      invoice_status: null,
      client_name: patch.client_name,
      client_id: matched?.id ?? null,
      client_std_name: matched?.name ?? null,
      location_id: matched?.location_id ?? null,
      location_name: matched?.location_name ?? null,
      dropbox_shared_url: cur.dropbox_shared_url ?? null,
      dropbox_path: cur.dropbox_path ?? null,
      contact_name: cur.contact_name,
      contact_phone: cur.contact_phone,
      contact_email: cur.contact_email,
      description: patch.description,
      notes: cur.notes,
      rubro: input.rubro,
      progress: 0,
      follow_up_date: cur.follow_up_date,
      rejection_reason: null,
      converted_project_id: null,
    },
  };
}

function sanitizeFileName(s: string): string {
  return s.replace(/[/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
}

export type PublishOut = {
  url: string | null; // link compartido (null si faltó el scope sharing.write)
  path: string;
  fileName: string;
  waText: string;
  linkWarning: string | null;
};

// Publica: genera el PDF con membrete, lo sube a la carpeta de cartas en
// Dropbox, crea el link compartido y marca la cotización como ENVIADA.
export async function publishQuote(db: Db, orgId: string, quoteId: string): Promise<{ error: string } | { ok: true; data: PublishOut }> {
  if (!hasDropboxConfig()) return { error: "Dropbox no está configurado (faltan las env vars)." };

  type Row = {
    quote_number: string;
    sent_date: string | null;
    client_name: string | null;
    description: string | null;
    amount_usd: number | null;
    letter: LetterData | null;
    client: { name: string } | null;
    location: { name: string } | null;
  };
  const run = (cols: string) => db.from("sales_quotes").select(cols).eq("id", quoteId).eq("org_id", orgId).maybeSingle();
  let res = (await run(
    "quote_number, sent_date, client_name, description, amount_usd, letter, client:clients(name), location:client_locations(name)",
  )) as { data: Row | null; error: { message: string } | null };
  if (res.error) {
    res = (await run(
      "quote_number, sent_date, client_name, description, amount_usd, client:clients(name), location:client_locations(name)",
    )) as { data: Row | null; error: { message: string } | null };
  }
  const q = res.data;
  if (!q) return { error: "Cotización no encontrada" };

  const letter: LetterData =
    q.letter ?? {
      fecha: q.sent_date ?? new Date().toISOString().slice(0, 10),
      ubicacion: q.location?.name ?? null,
      tipo: "realizar",
      items: [{ cant: 1, desc: q.description ?? "Trabajos según cotización", precio: q.amount_usd ?? 0 }],
      aplica_itbms: false,
      tasa: 7,
      validez: null,
      condiciones: null,
      elaborado: null,
    };
  const cliente = q.client?.name ?? q.client_name ?? "Cliente";

  const pdf = await renderQuotePdf({ quoteNumber: q.quote_number, cliente, letter });

  let desc = q.description ? sanitizeFileName(q.description) : "";
  if (desc.length > 60) desc = desc.slice(0, 57).trim() + "...";
  const loc = q.location?.name ? ` (${sanitizeFileName(q.location.name)})` : "";
  const fileName = sanitizeFileName(`${q.quote_number} - ${sanitizeFileName(cliente)}${loc}${desc ? ` - ${desc}` : ""}`) + ".pdf";

  const uploaded = await uploadFile(`${quotesFolder()}/${fileName}`, pdf);

  let url: string | null = null;
  let linkWarning: string | null = null;
  try {
    url = await getSharedLink(uploaded.path);
  } catch (e) {
    linkWarning =
      "El PDF quedó en Dropbox pero no se pudo crear el link compartido" +
      (e instanceof Error && /scope|permission/i.test(e.message) ? " (falta el scope sharing.write en la app de Dropbox)." : ".");
  }

  const upd = {
    status: "enviada" as const,
    sent_date: letter.fecha,
    dropbox_file_id: uploaded.id,
    dropbox_path: uploaded.path,
  };
  let updRes = await db.from("sales_quotes").update({ ...upd, dropbox_shared_url: url }).eq("id", quoteId).eq("org_id", orgId);
  if (updRes.error) updRes = await db.from("sales_quotes").update(upd).eq("id", quoteId).eq("org_id", orgId);
  if (updRes.error) return { error: updRes.error.message };

  const waText = `Cotización ${q.quote_number} - ${cliente}${url ? `: ${url}` : ""}`;
  return { ok: true, data: { url, path: uploaded.path, fileName: uploaded.name, waText, linkWarning } };
}
