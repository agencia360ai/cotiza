"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { syncGovTenders, TIPO_TO_ID } from "@/lib/panamacompra/sync";
import { evaluateTender } from "@/lib/panamacompra/evaluate";
import {
  hasPanamaCompraConfig,
  pcLogin,
  pcLoginCached,
  pcPliegoRaw,
  pcDownloadArchivo,
  pcProponentes,
  extractDetalle,
  extractArchivos,
  extractPrecioBreakdown,
  type GovDetalle,
  type PcProponente,
} from "@/lib/panamacompra/client";
import { hasDropboxConfig, createFolder, getSharedLink, listFolder, uploadFile, copyFile, searchFiles, type DbxEntry } from "@/lib/dropbox/client";
import { analyzeTenderDocs, type GovDocAnalisis } from "@/lib/panamacompra/docs";
import { extractRequiredDocs, type SubmissionDoc, type SubmissionDocEstado, type SubmissionPlan } from "@/lib/panamacompra/submit-docs";

// ── Puente Mis Licitaciones ↔ gov_tenders (para el análisis/checklist) ────────
// Una licitación propia (tender) creada al PARTICIPAR guarda el back-link en
// gov_tenders.converted_tender_id. Desde el tender resolvemos su gov_tender para
// mostrar/editar el análisis y el checklist en Mis Licitaciones.
export type GovForTender = {
  govId: string;
  dropboxFolderPath: string | null;
  dropboxFolderUrl: string | null;
  docAnalisis: import("@/lib/panamacompra/docs").GovDocAnalisis | null;
  docsSometer: SubmissionPlan | null;
  competidores: CompetidoresData | null;
};
const GOV_FOR_TENDER_COLSETS = [
  "id, dropbox_folder_path, dropbox_folder_url, doc_analisis, docs_someter, competidores",
  "id, dropbox_folder_path, dropbox_folder_url, doc_analisis, docs_someter",
  "id, dropbox_folder_path, dropbox_folder_url",
];
export async function getGovTenderForTender(tenderId: string): Promise<{ error: string } | { ok: true; data: GovForTender | null }> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const run = (cols: string) =>
    c.supabase.from("gov_tenders").select(cols).eq("org_id", c.orgId).eq("converted_tender_id", tenderId).maybeSingle();
  type Res = {
    data: {
      id: string;
      dropbox_folder_path: string | null;
      dropbox_folder_url: string | null;
      doc_analisis?: unknown;
      docs_someter?: unknown;
      competidores?: unknown;
    } | null;
    error: { message: string; code?: string } | null;
  };
  let res: Res = { data: null, error: null };
  for (const cols of GOV_FOR_TENDER_COLSETS) {
    res = (await run(cols)) as Res;
    if (!isMissingColumn(res.error)) break;
  }
  if (res.error) return { error: res.error.message };
  if (!res.data) return { ok: true, data: null }; // tender manual (no vino del gobierno)
  return {
    ok: true,
    data: {
      govId: res.data.id,
      dropboxFolderPath: res.data.dropbox_folder_path ?? null,
      dropboxFolderUrl: res.data.dropbox_folder_url ?? null,
      docAnalisis: (res.data.doc_analisis ?? null) as GovForTender["docAnalisis"],
      docsSometer: (res.data.docs_someter ?? null) as SubmissionPlan | null,
      competidores: (res.data.competidores ?? null) as CompetidoresData | null,
    },
  };
}

// Cambia el estado de UN documento del checklist (interacción del usuario).
export async function setSubmissionDocEstado(
  govId: string,
  index: number,
  estado: SubmissionDocEstado,
): Promise<Result<{ docs_someter: SubmissionPlan }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const { data, error } = (await c.supabase
    .from("gov_tenders")
    .select("docs_someter")
    .eq("id", govId)
    .eq("org_id", c.orgId)
    .maybeSingle()) as { data: { docs_someter: SubmissionPlan | null } | null; error: { message: string; code?: string } | null };
  if (error) return { error: error.message };
  const plan = data?.docs_someter;
  if (!plan || !Array.isArray(plan.documentos)) return { error: "Todavía no hay checklist para editar." };
  if (index < 0 || index >= plan.documentos.length) return { error: "Documento fuera de rango." };
  plan.documentos[index] = { ...plan.documentos[index], estado };
  const { error: upErr } = await c.supabase.from("gov_tenders").update({ docs_someter: plan }).eq("id", govId).eq("org_id", c.orgId);
  if (upErr) return { error: upErr.message };
  revalidatePath("/potenciales");
  return { ok: true, data: { docs_someter: plan } };
}
import type { GovTenderEval } from "@/lib/panamacompra/tamiz";
import type { TenderStatus } from "@/lib/pipeline/types";

// Carpeta base en Dropbox donde viven las licitaciones (override por env).
const LICITACIONES_BASE =
  process.env.DROPBOX_LICITACIONES_PATH?.replace(/\/+$/, "") || "/Dicec/Proyectos/02 Licitaciones/LICITACIONES 2026";

// Nombre de carpeta estilo DICEC ("Acto #<num> <título>"), saneado para Dropbox
// (sin / \ : ? * " < > | y colapsando espacios).
function folderName(numProceso: string, titulo: string | null): string {
  const base = `Acto #${numProceso} ${titulo ?? ""}`.trim();
  return base
    .replace(/[/\\:?*"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

// Nombre de archivo seguro para Dropbox. Le agrega extensión según content-type
// si el nombre del pliego no la trae.
function sanitizeFileName(nombre: string, contentType: string | null): string {
  let name = (nombre || "documento").replace(/[/\\:?*"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 150);
  if (!/\.[a-z0-9]{2,5}$/i.test(name)) {
    const ct = contentType ?? "";
    const ext = /pdf/i.test(ct) ? ".pdf" : /word|msword|wordprocessing/i.test(ct) ? ".docx" : /excel|spreadsheet/i.test(ct) ? ".xlsx" : /zip/i.test(ct) ? ".zip" : "";
    name += ext;
  }
  return name || "documento";
}
// Base del nombre (sin extensión, minúsculas) para detectar "ya está descargado".
function baseName(name: string): string {
  return name.replace(/\.[a-z0-9]{2,5}$/i, "").trim().toLowerCase();
}

type Result<T> = { error: string } | { ok: true; data: T };

function isMissingColumn(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42703") return true;
  return /does not exist|could not find|schema cache/i.test(error.message ?? "");
}

async function ctx() {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { ok: false as const, error: "Sesión expirada" };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false as const, error: "Sin organización" };
  return { ok: true as const, supabase, orgId };
}

export type GovTenderRow = {
  id: string;
  num_proceso: string;
  titulo: string | null;
  entidad: string | null;
  fecha_cierre: string | null;
  tipo: string | null;
  precio_ref: number | null;
  url: string | null;
  seen_at: string | null;
  created_at: string | null; // cuándo se agregó por PRIMERA vez (el upsert no lo toca)
  relevante: boolean | null;
  relevancia_motivo: string | null;
  converted_tender_id: string | null;
  eval: GovTenderEval | null;
  detalle: GovDetalle | null;
  dropbox_folder_path: string | null;
  dropbox_folder_url: string | null;
  doc_analisis: GovDocAnalisis | null;
  docs_someter: SubmissionPlan | null;
  competidores: CompetidoresData | null;
};

// Column sets de más completo a más básico (fallback por migraciones pendientes).
const GOV_COLSETS = [
  "id, num_proceso, titulo, entidad, fecha_cierre, tipo, precio_ref, url, seen_at, created_at, relevante, relevancia_motivo, converted_tender_id, eval, detalle, dropbox_folder_path, dropbox_folder_url, doc_analisis, docs_someter, competidores",
  "id, num_proceso, titulo, entidad, fecha_cierre, tipo, precio_ref, url, seen_at, created_at, relevante, relevancia_motivo, converted_tender_id, eval, detalle, dropbox_folder_path, dropbox_folder_url, doc_analisis, docs_someter",
  "id, num_proceso, titulo, entidad, fecha_cierre, tipo, precio_ref, url, seen_at, created_at, relevante, relevancia_motivo, converted_tender_id, eval, detalle, dropbox_folder_path, dropbox_folder_url, doc_analisis",
  "id, num_proceso, titulo, entidad, fecha_cierre, tipo, precio_ref, url, seen_at, created_at, relevante, relevancia_motivo, converted_tender_id, eval, detalle, dropbox_folder_path, dropbox_folder_url",
  "id, num_proceso, titulo, entidad, fecha_cierre, tipo, precio_ref, url, seen_at, created_at, relevante, relevancia_motivo, converted_tender_id, eval, detalle",
  "id, num_proceso, titulo, entidad, fecha_cierre, tipo, precio_ref, url, seen_at, created_at, relevante, relevancia_motivo, converted_tender_id, eval",
  "id, num_proceso, titulo, entidad, fecha_cierre, tipo, precio_ref, url, seen_at, created_at, relevante, relevancia_motivo, converted_tender_id",
  "id, num_proceso, titulo, entidad, fecha_cierre, tipo, precio_ref, url, seen_at, created_at, converted_tender_id",
];
const PAGE_SIZE = 1000;

// Abrir la vista lee SOLO de la base (cero llamadas al gobierno). PostgREST
// corta en 1000 filas; con miles de procesos hay que PAGINAR — si no, se cargan
// solo las 1000 más viejas (ya cerradas) y las abiertas quedan afuera.
export async function listGovTenders(): Promise<Result<{ rows: GovTenderRow[]; syncedAt: number | null }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  type Res = { data: GovTenderRow[] | null; error: ({ message: string; code?: string }) | null };
  // Tiebreaker por id: con miles de empates en fecha_cierre (y muchos NULL), el
  // orden entre páginas no es estable → filas duplicadas o perdidas al paginar.
  const page = (cols: string, from: number) =>
    c.supabase
      .from("gov_tenders")
      .select(cols)
      .eq("org_id", c.orgId)
      .order("fecha_cierre", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1) as unknown as Promise<Res>;

  // Resolver el set de columnas disponible (según migraciones) con la 1ª página.
  let cols = GOV_COLSETS[0];
  let first: Res | null = null;
  for (const cs of GOV_COLSETS) {
    const r = (await page(cs, 0)) as Res;
    if (!r.error) {
      cols = cs;
      first = r;
      break;
    }
    if (!isMissingColumn(r.error)) return { error: r.error.message };
  }
  if (!first) return { error: "Falta la migración 0010 (gov_tenders)" };

  // Traer el resto de las páginas (tope de seguridad: 30k filas).
  const data: GovTenderRow[] = [...(first.data ?? [])];
  if ((first.data?.length ?? 0) === PAGE_SIZE) {
    for (let from = PAGE_SIZE; from < 30_000; from += PAGE_SIZE) {
      const r = (await page(cols, from)) as Res;
      if (r.error) return { error: r.error.message };
      const batch = r.data ?? [];
      data.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
  }

  let syncedAt: number | null = null;
  const rows = data.map((r) => {
    if (r.seen_at) syncedAt = Math.max(syncedAt ?? 0, +new Date(r.seen_at));
    return {
      ...r,
      precio_ref: r.precio_ref === null ? null : Number(r.precio_ref),
      created_at: r.created_at ?? null,
      relevante: r.relevante ?? null,
      relevancia_motivo: r.relevancia_motivo ?? null,
      eval: r.eval ?? null,
      detalle: r.detalle ?? null,
      dropbox_folder_path: r.dropbox_folder_path ?? null,
      dropbox_folder_url: r.dropbox_folder_url ?? null,
      doc_analisis: r.doc_analisis ?? null,
      docs_someter: r.docs_someter ?? null,
      competidores: r.competidores ?? null,
    };
  });
  return { ok: true, data: { rows, syncedAt } };
}

// Evaluación IA "¿cumplimos?" bajo demanda (botón en el detalle de la fila).
export async function evaluateGovTender(govId: string): Promise<Result<{ eval: GovTenderEval }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const { data: g } = (await c.supabase
    .from("gov_tenders")
    .select("titulo, entidad, tipo, precio_ref, raw")
    .eq("id", govId)
    .eq("org_id", c.orgId)
    .maybeSingle()) as {
    data: { titulo: string | null; entidad: string | null; tipo: string | null; precio_ref: number | null; raw: unknown } | null;
  };
  if (!g) return { error: "No encontrada" };
  try {
    const ev = await evaluateTender({
      titulo: g.titulo,
      entidad: g.entidad,
      tipo: g.tipo,
      precioRef: g.precio_ref === null ? null : Number(g.precio_ref),
      raw: g.raw,
    });
    const { error } = await c.supabase.from("gov_tenders").update({ eval: ev }).eq("id", govId).eq("org_id", c.orgId);
    if (error) return { error: "Falta la migración 0013 (eval) — corre el SQL y reintenta" };
    revalidatePath("/potenciales");
    return { ok: true, data: { eval: ev } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo evaluar" };
  }
}

// Detalle completo del pliego bajo demanda (procesos de alto puntaje): renglones,
// contacto, entidad, forma de pago/entrega — para decidir si podemos licitar.
// Consulta PanamaCompra y guarda; si de paso encuentra un precio y no había, lo completa.
export async function enrichGovTender(govId: string): Promise<Result<{ detalle: GovDetalle }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  if (!hasPanamaCompraConfig()) return { error: "Faltan PANAMACOMPRA_USER / PANAMACOMPRA_PASSWORD en Vercel." };
  const { data: g } = (await c.supabase
    .from("gov_tenders")
    .select("tipo, precio_ref, raw")
    .eq("id", govId)
    .eq("org_id", c.orgId)
    .maybeSingle()) as { data: { tipo: string | null; precio_ref: number | null; raw: unknown } | null };
  if (!g) return { error: "No encontrada" };
  const rw = g.raw as { idProcesosContratacionFlujos?: string | number } | null;
  const idFlujos = rw?.idProcesosContratacionFlujos;
  const idTipo = g.tipo ? TIPO_TO_ID[g.tipo] : undefined;
  if (!idFlujos || !idTipo) return { error: "Este proceso no tiene pliego consultable." };
  try {
    const session = await pcLogin();
    const pliego = await pcPliegoRaw(session, idTipo, String(idFlujos));
    if (!pliego) return { error: "PanamaCompra no devolvió el pliego (puede no estar publicado)." };
    const detalle = extractDetalle(pliego, new Date().toISOString());
    // Recalcular el precio SIEMPRE desde el pliego (autoridad); guardar el desglose.
    const bd = extractPrecioBreakdown(pliego);
    const patch: Record<string, unknown> = { detalle };
    if (bd.elegido !== null) {
      patch.precio_ref = bd.elegido;
      patch.precio_breakdown = bd;
    }
    let { error } = await c.supabase.from("gov_tenders").update(patch).eq("id", govId).eq("org_id", c.orgId);
    if (isMissingColumn(error)) {
      // migración 0019 (precio_breakdown) pendiente: guardar sin el desglose
      delete patch.precio_breakdown;
      ({ error } = await c.supabase.from("gov_tenders").update(patch).eq("id", govId).eq("org_id", c.orgId));
    }
    if (error) return { error: "Falta la migración 0015 (detalle) — corre el SQL y reintenta" };
    revalidatePath("/potenciales");
    return { ok: true, data: { detalle } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo traer el detalle" };
  }
}

// Crea la carpeta de la licitación en Dropbox (bajo LICITACIONES 2026) y guarda
// su path + link compartido. Idempotente: si ya existe, reusa.
export async function createGovTenderFolder(
  govId: string,
): Promise<Result<{ path: string; url: string | null }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  if (!hasDropboxConfig()) return { error: "Faltan las credenciales de Dropbox en Vercel." };
  const { data: g } = (await c.supabase
    .from("gov_tenders")
    .select("num_proceso, titulo, dropbox_folder_path, dropbox_folder_url")
    .eq("id", govId)
    .eq("org_id", c.orgId)
    .maybeSingle()) as {
    data: { num_proceso: string; titulo: string | null; dropbox_folder_path: string | null; dropbox_folder_url: string | null } | null;
  };
  if (!g) return { error: "No encontrada" };
  try {
    const path = g.dropbox_folder_path ?? `${LICITACIONES_BASE}/${folderName(g.num_proceso, g.titulo)}`;
    if (!g.dropbox_folder_path) await createFolder(path);
    let url = g.dropbox_folder_url;
    if (!url) {
      try {
        url = await getSharedLink(path);
      } catch {
        url = null; // la carpeta se creó; el link se puede reintentar
      }
    }
    const { error } = await c.supabase
      .from("gov_tenders")
      .update({ dropbox_folder_path: path, dropbox_folder_url: url })
      .eq("id", govId)
      .eq("org_id", c.orgId);
    if (error) return { error: "Falta la migración 0017 (dropbox) — corre el SQL y reintenta" };
    revalidatePath("/potenciales");
    return { ok: true, data: { path, url } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo crear la carpeta en Dropbox" };
  }
}

// Documentos del pliego para bajar a Dropbox. Fetchea el pliego, extrae los
// archivos y ASEGURA la carpeta de Dropbox (la crea si no existe). No descarga
// nada todavía — cada archivo lo baja uploadGovTenderDocToDropbox por separado,
// para poder mostrar el % de avance en la UI.
export async function listGovTenderDocs(
  govId: string,
): Promise<Result<{ docs: { nombre: string; url: string; existe: boolean }[]; folderPath: string; folderUrl: string | null }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  if (!hasPanamaCompraConfig()) return { error: "Faltan PANAMACOMPRA_USER / PANAMACOMPRA_PASSWORD en Vercel." };
  if (!hasDropboxConfig()) return { error: "Faltan las credenciales de Dropbox en Vercel." };
  const { data: g } = (await c.supabase
    .from("gov_tenders")
    .select("num_proceso, titulo, tipo, raw, dropbox_folder_path, dropbox_folder_url")
    .eq("id", govId)
    .eq("org_id", c.orgId)
    .maybeSingle()) as {
    data: {
      num_proceso: string;
      titulo: string | null;
      tipo: string | null;
      raw: unknown;
      dropbox_folder_path: string | null;
      dropbox_folder_url: string | null;
    } | null;
  };
  if (!g) return { error: "No encontrada" };
  const rw = g.raw as { idProcesosContratacionFlujos?: string | number } | null;
  const idFlujos = rw?.idProcesosContratacionFlujos;
  const idTipo = g.tipo ? TIPO_TO_ID[g.tipo] : undefined;
  if (!idFlujos || !idTipo) return { error: "Este proceso no tiene pliego consultable." };
  try {
    const session = await pcLoginCached();
    const pliego = await pcPliegoRaw(session, idTipo, String(idFlujos));
    if (!pliego) return { error: "PanamaCompra no devolvió el pliego (puede no estar publicado)." };
    const archivos = extractArchivos(pliego);

    // Asegurar la carpeta de Dropbox (crear + link si no existe).
    let path = g.dropbox_folder_path;
    let url = g.dropbox_folder_url;
    if (!path) {
      path = `${LICITACIONES_BASE}/${folderName(g.num_proceso, g.titulo)}`;
      await createFolder(path);
      try {
        url = await getSharedLink(path);
      } catch {
        url = null;
      }
      const { error } = await c.supabase
        .from("gov_tenders")
        .update({ dropbox_folder_path: path, dropbox_folder_url: url })
        .eq("id", govId)
        .eq("org_id", c.orgId);
      if (error) return { error: "Falta la migración 0017 (dropbox) — corre el SQL y reintenta." };
    }

    // ¿Cuáles ya están en la carpeta? (para saltarlos y no duplicar). OJO: en la
    // carpeta viven con el nombre SANEADO — comparar contra el mismo saneo, si
    // no un "ANEXO: PLANOS.pdf" se re-bajaría como "(1)", "(2)"… en cada corrida.
    let existentes = new Set<string>();
    try {
      const entries = await listFolder(path);
      existentes = new Set(entries.filter((e) => e.tag === "file").map((e) => baseName(e.name)));
    } catch {
      /* carpeta recién creada / vacía */
    }
    const docs = archivos.map((a) => ({ ...a, existe: existentes.has(baseName(sanitizeFileName(a.nombre, null))) }));
    return { ok: true, data: { docs, folderPath: path, folderUrl: url } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo leer el pliego" };
  }
}

// Baja UN documento de PanamaCompra y lo sube a la carpeta de Dropbox. Se llama
// una vez por archivo desde el cliente (así la UI muestra el % de avance).
// Falla suave: si el archivo no existe (404), lo marca no-subido sin romper.
export async function uploadGovTenderDocToDropbox(
  govId: string,
  nombre: string,
  url: string,
): Promise<Result<{ nombre: string; subido: boolean; path: string | null }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  if (!hasPanamaCompraConfig()) return { error: "Faltan credenciales de PanamaCompra." };
  if (!hasDropboxConfig()) return { error: "Faltan las credenciales de Dropbox en Vercel." };
  const { data: g } = (await c.supabase
    .from("gov_tenders")
    .select("dropbox_folder_path")
    .eq("id", govId)
    .eq("org_id", c.orgId)
    .maybeSingle()) as { data: { dropbox_folder_path: string | null } | null };
  if (!g) return { error: "No encontrada" };
  if (!g.dropbox_folder_path) return { error: "Primero crea la carpeta en Dropbox." };
  try {
    const session = await pcLoginCached();
    const file = await pcDownloadArchivo(session, url);
    if (!file || file.bytes.length === 0) return { ok: true, data: { nombre, subido: false, path: null } }; // 404 → saltado
    const safe = sanitizeFileName(nombre, file.contentType);
    const up = await uploadFile(`${g.dropbox_folder_path}/${safe}`, file.bytes);
    return { ok: true, data: { nombre: safe, subido: true, path: up.path } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo bajar/subir el documento" };
  }
}

// ── Check status: competidores + resultado automático ─────────────────────────
// "Check status" consulta las propuestas del acto en PanamaCompra y, si el
// proceso tiene tender vinculado, aplica el veredicto: DICEC adjudicado →
// Ganada + monto = el precio con el que se ganó. El resultado se PERSISTE en
// gov_tenders.competidores (migración 0029) para no depender del gobierno.

export type CompetidoresAuto = { estatus: "ganada" | "no_ganada" | null; monto: number | null };
export type CompetidoresData = {
  proponentes: PcProponente[];
  vistaUsada: string | null;
  abierta: boolean;
  at: string;
  auto: CompetidoresAuto | null;
};

// La empresa PROPIA en el portal (modo single-org DICEC): así detectamos cuál
// de los proponentes somos nosotros. Override por env si algún día cambia.
const RE_EMPRESA_PROPIA = new RegExp(process.env.PANAMACOMPRA_EMPRESA_MATCH || "dicec", "i");

// Veredicto a partir del cuadro: ganamos si NUESTRA oferta salió adjudicada;
// perdimos solo si estamos en la lista SIN adjudicar y OTRO sí quedó adjudicado
// (mientras nadie esté adjudicado, el acto sigue en evaluación — no se toca).
function decidirResultado(proponentes: PcProponente[]): { ganamos: boolean; perdimos: boolean; montoGanador: number | null } {
  const propio = proponentes.find((p) => RE_EMPRESA_PROPIA.test(p.nombre));
  const rivalGano = proponentes.some((p) => !RE_EMPRESA_PROPIA.test(p.nombre) && p.extra === "Adjudicado");
  const ganamos = !!propio && propio.extra === "Adjudicado";
  return { ganamos, perdimos: !!propio && !ganamos && rivalGano, montoGanador: ganamos ? propio.monto : null };
}

// Estados desde los que el veredicto puede ASCENDER el tender. Nunca degrada lo
// que el usuario avanzó a mano: una Orden de proceder no vuelve a Ganada, y una
// Ganada manual no baja a No ganada.
const ASCENDIBLES_A_GANADA: TenderStatus[] = ["por_participar", "por_partir", "presentada", "en_revision", "no_ganada"];
const ASCENDIBLES_A_NO_GANADA: TenderStatus[] = ["por_participar", "por_partir", "presentada", "en_revision"];

async function aplicarResultadoAlTender(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  tenderId: string,
  proponentes: PcProponente[],
): Promise<CompetidoresAuto | null> {
  const { ganamos, perdimos, montoGanador } = decidirResultado(proponentes);
  if (!ganamos && !perdimos) return null;
  const { data: t } = (await supabase
    .from("tenders")
    .select("status, amount_ref_usd")
    .eq("id", tenderId)
    .eq("org_id", orgId)
    .maybeSingle()) as { data: { status: TenderStatus; amount_ref_usd: number | null } | null };
  if (!t) return null;
  const patch: Record<string, unknown> = {};
  let estatus: CompetidoresAuto["estatus"] = null;
  if (ganamos) {
    if (ASCENDIBLES_A_GANADA.includes(t.status)) {
      patch.status = "ganada";
      estatus = "ganada";
    }
    // El monto pasa a ser el precio GANADOR aunque el estatus ya estuviera al
    // día (Ganada u Orden de proceder): es el número real del negocio.
    const montoActual = t.amount_ref_usd === null ? null : Number(t.amount_ref_usd);
    if (montoGanador !== null && montoActual !== montoGanador) patch.amount_ref_usd = montoGanador;
  } else if (perdimos && ASCENDIBLES_A_NO_GANADA.includes(t.status)) {
    patch.status = "no_ganada";
    estatus = "no_ganada";
  }
  if (Object.keys(patch).length === 0) return null;
  const { error } = await supabase.from("tenders").update(patch).eq("id", tenderId).eq("org_id", orgId);
  if (error) return null;
  return { estatus, monto: typeof patch.amount_ref_usd === "number" ? patch.amount_ref_usd : null };
}

export async function getGovTenderCompetidores(govId: string): Promise<Result<CompetidoresData>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  if (!hasPanamaCompraConfig()) return { error: "Faltan PANAMACOMPRA_USER / PANAMACOMPRA_PASSWORD en Vercel." };
  const { data: g } = (await c.supabase
    .from("gov_tenders")
    .select("tipo, raw, fecha_cierre, converted_tender_id")
    .eq("id", govId)
    .eq("org_id", c.orgId)
    .maybeSingle()) as {
    data: { tipo: string | null; raw: unknown; fecha_cierre: string | null; converted_tender_id: string | null } | null;
  };
  if (!g) return { error: "No encontrada" };
  const rw = g.raw as { idProcesosContratacionFlujos?: string | number } | null;
  const idFlujos = rw?.idProcesosContratacionFlujos;
  const idTipo = g.tipo ? TIPO_TO_ID[g.tipo] : undefined;
  if (!idFlujos || !idTipo) return { error: "Este proceso no tiene detalle consultable en PanamaCompra." };
  // "Abierta" = SABEMOS que sigue abierta (cierra en el futuro) → ahí sí las
  // propuestas son secretas. fecha_cierre null o pasada NO es "abierta": una
  // ganada/adjudicada ya cerró, así que no afirmamos "aún no cierra" cuando en
  // realidad no expusieron la tabla o no supimos leerla.
  const abierta = !!g.fecha_cierre && +new Date(g.fecha_cierre) > Date.now();
  try {
    const session = await pcLogin();
    const { proponentes, vistaUsada } = await pcProponentes(session, idTipo, String(idFlujos));
    let auto: CompetidoresAuto | null = null;
    if (g.converted_tender_id && proponentes.length > 0) {
      auto = await aplicarResultadoAlTender(c.supabase, c.orgId, g.converted_tender_id, proponentes);
    }
    const data: CompetidoresData = { proponentes, vistaUsada, abierta, at: new Date().toISOString(), auto };
    // Guardar "por siempre" — solo cuando trajo algo (no pisar data buena con
    // un reintento vacío). Si la migración 0029 falta, la consulta igual sirve.
    if (proponentes.length > 0) {
      await c.supabase.from("gov_tenders").update({ competidores: data }).eq("id", govId).eq("org_id", c.orgId);
    }
    if (auto) revalidatePath("/potenciales");
    return { ok: true, data };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudieron consultar las propuestas" };
  }
}

// Sincroniza tenders.folder_url con la carpeta Dropbox de su gov_tender. Las
// licitaciones seguidas ANTES de crear la carpeta quedaron apuntando a
// PanamaCompra (o sin link). Best-effort al cargar la página: nunca rompe la
// carga y solo pisa links vacíos o del portal — un link puesto a mano se respeta.
export async function syncTenderDropboxLinks(): Promise<void> {
  try {
    const c = await ctx();
    if (!c.ok) return;
    const { supabase, orgId } = c;
    const { data: govs } = (await supabase
      .from("gov_tenders")
      .select("converted_tender_id, dropbox_folder_url")
      .eq("org_id", orgId)
      .not("converted_tender_id", "is", null)
      .not("dropbox_folder_url", "is", null)) as {
      data: { converted_tender_id: string; dropbox_folder_url: string }[] | null;
    };
    if (!govs || govs.length === 0) return;
    const { data: tenders } = (await supabase
      .from("tenders")
      .select("id, folder_url")
      .eq("org_id", orgId)
      .in("id", govs.map((g) => g.converted_tender_id))) as { data: { id: string; folder_url: string | null }[] | null };
    const actual = new Map((tenders ?? []).map((t) => [t.id, t.folder_url]));
    for (const g of govs) {
      if (!actual.has(g.converted_tender_id)) continue; // tender borrado
      const url = actual.get(g.converted_tender_id);
      const pisable = !url || /panamacompra\.gob\.pa/i.test(url);
      if (pisable && url !== g.dropbox_folder_url) {
        await supabase.from("tenders").update({ folder_url: g.dropbox_folder_url }).eq("id", g.converted_tender_id).eq("org_id", orgId);
      }
    }
  } catch {
    /* best-effort */
  }
}

// Lee los PDFs que haya en la carpeta de Dropbox de la licitación y extrae los
// requerimientos reales con IA (Sonnet). Reemplaza al viejo "¿cumplimos?" que
// solo miraba el título.
export async function analyzeGovTenderDocs(govId: string): Promise<Result<{ analisis: GovDocAnalisis }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const { data: g } = (await c.supabase
    .from("gov_tenders")
    .select("titulo, dropbox_folder_path")
    .eq("id", govId)
    .eq("org_id", c.orgId)
    .maybeSingle()) as { data: { titulo: string | null; dropbox_folder_path: string | null } | null };
  if (!g) return { error: "No encontrada" };
  if (!g.dropbox_folder_path) return { error: "Crea primero la carpeta en Dropbox y sube los documentos del pliego." };
  const r = await analyzeTenderDocs({ folderPath: g.dropbox_folder_path, titulo: g.titulo });
  if (!r.ok) return { error: r.error };
  const { error } = await c.supabase.from("gov_tenders").update({ doc_analisis: r.data }).eq("id", govId).eq("org_id", c.orgId);
  if (error) return { error: "Falta la migración 0018 (doc_analisis) — corre el SQL y reintenta" };
  revalidatePath("/potenciales");
  return { ok: true, data: { analisis: r.data } };
}

// ── Documentos a someter (checklist + copia de licitaciones pasadas) ──────────
const SOMETER_SUBFOLDER = "DOCUMENTOS A SOMETER";
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Carpeta de licitación (primer segmento bajo la base) de donde salió un archivo.
function carpetaDe(path: string): string {
  const rel = path.startsWith(LICITACIONES_BASE) ? path.slice(LICITACIONES_BASE.length) : path;
  return rel.replace(/^\/+/, "").split("/")[0] || path;
}

// Busca en las carpetas de LICITACIONES el archivo que mejor matchea un documento
// requerido. Excluye la carpeta de la licitación actual (para no copiar el pliego).
async function buscarDocReutilizable(doc: SubmissionDoc, excluirPrefix: string): Promise<DbxEntry | null> {
  const kws = (doc.keywords ?? []).map(norm).filter(Boolean);
  const query = doc.keywords?.[0] || doc.nombre;
  let results: DbxEntry[] = [];
  try {
    results = await searchFiles(query, { path: LICITACIONES_BASE, maxResults: 100 });
  } catch {
    return null;
  }
  // Prefijo con separador: sin él, "Acto #123 Chiller" también excluiría a
  // "Acto #123 Chiller Fase 2" (otra licitación cuyo nombre lo extiende).
  const excl = norm(excluirPrefix).replace(/\/+$/, "") + "/";
  const scored = results
    .filter((r) => r.path && !(norm(r.path) + "/").startsWith(excl)) // no la carpeta actual
    .filter((r) => /\.(pdf|docx?|xlsx?|jpe?g|png)$/i.test(r.name))
    .map((r) => {
      const n = norm(r.name);
      const hits = kws.filter((k) => n.includes(k)).length || (norm(query) && n.includes(norm(query)) ? 1 : 0);
      const someterBonus = /someter/.test(norm(r.path)) ? 0.5 : 0; // preferí una copia ya curada
      return { r, score: hits + someterBonus };
    })
    .filter((x) => x.score >= 1)
    .sort((a, b) => b.score - a.score || (b.r.modified ?? "").localeCompare(a.r.modified ?? ""));
  return scored[0]?.r ?? null;
}

// Paso 1: la IA lee los PDFs del pliego y saca la lista de documentos a someter;
// crea la subcarpeta "DOCUMENTOS A SOMETER". Aún no copia nada (eso va por doc,
// para el medidor de %).
export async function analyzeSubmissionDocs(
  govId: string,
): Promise<Result<{ resumen: string; documentos: SubmissionDoc[]; someterPath: string }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  if (!hasDropboxConfig()) return { error: "Faltan las credenciales de Dropbox en Vercel." };
  const { data: g } = (await c.supabase
    .from("gov_tenders")
    .select("titulo, dropbox_folder_path")
    .eq("id", govId)
    .eq("org_id", c.orgId)
    .maybeSingle()) as { data: { titulo: string | null; dropbox_folder_path: string | null } | null };
  if (!g) return { error: "No encontrada" };
  if (!g.dropbox_folder_path) return { error: "Primero crea la carpeta y baja los documentos del pliego." };
  const r = await extractRequiredDocs({ folderPath: g.dropbox_folder_path, titulo: g.titulo });
  if (!r.ok) return { error: r.error };
  const someterPath = `${g.dropbox_folder_path}/${SOMETER_SUBFOLDER}`;
  try {
    await createFolder(someterPath);
  } catch {
    /* si falla, se reintenta al copiar el primer documento */
  }
  return { ok: true, data: { resumen: r.data.resumen, documentos: r.data.documentos, someterPath } };
}

// Paso 2 (por documento reutilizable): busca en licitaciones pasadas y copia el
// match a "DOCUMENTOS A SOMETER". Devuelve el documento con su estado resuelto.
export async function resolveSubmissionDoc(govId: string, doc: SubmissionDoc): Promise<Result<SubmissionDoc>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  if (!hasDropboxConfig()) return { error: "Faltan las credenciales de Dropbox en Vercel." };
  const { data: g } = (await c.supabase
    .from("gov_tenders")
    .select("dropbox_folder_path")
    .eq("id", govId)
    .eq("org_id", c.orgId)
    .maybeSingle()) as { data: { dropbox_folder_path: string | null } | null };
  if (!g?.dropbox_folder_path) return { error: "Primero crea la carpeta y baja los documentos." };
  const someterPath = `${g.dropbox_folder_path}/${SOMETER_SUBFOLDER}`;
  // No reutilizable = específico de esta licitación → hay que hacerlo a la medida.
  if (!doc.reutilizable) return { ok: true, data: { ...doc, estado: "por_hacer", copiadoDe: null, archivoPath: null } };
  try {
    const match = await buscarDocReutilizable(doc, g.dropbox_folder_path);
    if (!match) return { ok: true, data: { ...doc, estado: "falta", copiadoDe: null, archivoPath: null } };
    let archivoPath: string | null = null;
    try {
      const copied = await copyFile(match.path, `${someterPath}/${match.name}`);
      archivoPath = copied.path;
    } catch {
      archivoPath = null; // se encontró pero no se pudo copiar (permiso/conflicto)
    }
    const copiadoDe = carpetaDe(match.path);
    const estado: SubmissionDocEstado = !archivoPath ? "falta" : doc.renovable ? "por_renovar" : "copiado";
    return { ok: true, data: { ...doc, estado, copiadoDe, archivoPath } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo resolver el documento" };
  }
}

const ESTADO_TXT: Record<SubmissionDocEstado, string> = {
  pendiente: "[ ] PENDIENTE",
  copiado: "[x] COPIADO  ",
  por_renovar: "[!] RENOVAR  ",
  falta: "[ ] FALTA    ",
  por_hacer: "[~] HACER    ",
};
function buildChecklistText(num: string, titulo: string | null, plan: SubmissionPlan): string {
  const lines = [
    "CHECKLIST — DOCUMENTOS A SOMETER",
    `Licitación: ${titulo ?? ""} (${num})`,
    `Generado: ${plan.at}`,
    "",
    plan.resumen,
    "",
  ];
  for (const d of plan.documentos) {
    const est = ESTADO_TXT[d.estado] ?? d.estado;
    const extra = (d.estado === "copiado" || d.estado === "por_renovar") && d.copiadoDe ? ` — de: ${d.copiadoDe}` : "";
    const nota = d.notas ? `  (${d.notas})` : "";
    lines.push(`${est}  ${d.nombre}${extra}${nota}`);
  }
  lines.push("", "Leyenda: [x] copiado · [!] copiado, verificar vigencia/renovar · [ ] falta (conseguir) · [~] hacer a la medida de esta licitación");
  return lines.join("\n");
}

// Paso 3: persiste el plan y escribe el checklist como archivo en la carpeta.
export async function saveSubmissionPlan(
  govId: string,
  resumen: string,
  documentos: SubmissionDoc[],
): Promise<Result<{ plan: SubmissionPlan }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const { data: g } = (await c.supabase
    .from("gov_tenders")
    .select("num_proceso, titulo, dropbox_folder_path")
    .eq("id", govId)
    .eq("org_id", c.orgId)
    .maybeSingle()) as { data: { num_proceso: string; titulo: string | null; dropbox_folder_path: string | null } | null };
  if (!g?.dropbox_folder_path) return { error: "Sin carpeta de Dropbox" };
  const someterPath = `${g.dropbox_folder_path}/${SOMETER_SUBFOLDER}`;
  const plan: SubmissionPlan = { resumen, someterPath, documentos, at: new Date().toISOString() };
  if (hasDropboxConfig()) {
    try {
      await createFolder(someterPath).catch(() => {});
      const txt = buildChecklistText(g.num_proceso, g.titulo, plan);
      await uploadFile(`${someterPath}/_CHECKLIST DOCUMENTOS A SOMETER.txt`, new TextEncoder().encode(txt), { overwrite: true });
    } catch {
      /* el checklist en archivo es opcional; el de la app es la fuente de verdad */
    }
  }
  const { error } = await c.supabase.from("gov_tenders").update({ docs_someter: plan }).eq("id", govId).eq("org_id", c.orgId);
  if (isMissingColumn(error)) return { error: "Falta la migración 0020 (docs_someter) — corre el SQL y reintenta." };
  if (error) return { error: error.message };
  revalidatePath("/potenciales");
  return { ok: true, data: { plan } };
}

// "Actualizar": delega al sync compartido (mismo código que el cron diario).
// full=true recorre todas las páginas (auditoría/recuperación de cobertura).
export async function refreshGovTenders(full?: boolean): Promise<
  Result<{
    total: number;
    nuevos: number;
    relevantes: number;
    conPrecio: number;
    pendientesPrecio: number;
    porTipo: Record<string, number>;
    truncados: string[];
  }>
> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const r = await syncGovTenders(c.supabase, c.orgId, full ? { full: true } : undefined);
  if ("error" in r) return { error: r.error };
  revalidatePath("/potenciales");
  return { ok: true, data: r.data };
}

// "Seguir": copia la licitación del gobierno a tus tenders (pipeline propio).
export async function followGovTender(govId: string): Promise<Result<{ tenderId: string }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const { data: g } = (await c.supabase
    .from("gov_tenders")
    .select("num_proceso, titulo, entidad, fecha_cierre, tipo, precio_ref, url, converted_tender_id, dropbox_folder_url")
    .eq("id", govId)
    .eq("org_id", c.orgId)
    .maybeSingle()) as {
    data: {
      num_proceso: string;
      titulo: string | null;
      entidad: string | null;
      fecha_cierre: string | null;
      tipo: string | null;
      precio_ref: number | null;
      url: string | null;
      converted_tender_id: string | null;
      dropbox_folder_url: string | null;
    } | null;
  };
  if (!g) return { error: "No encontrada" };
  if (g.converted_tender_id) return { error: "Ya la estás participando" };

  const modalidad =
    g.tipo === "licitacion_publica" ? "licitacion_publica" : g.tipo?.startsWith("compra_menor") ? "compra_menor" : "otro";

  const { data: t, error } = (await c.supabase
    .from("tenders")
    .insert({
      org_id: c.orgId,
      acto_number: g.num_proceso,
      year: g.fecha_cierre ? Number(String(g.fecha_cierre).slice(0, 4)) : new Date().getFullYear(),
      modalidad,
      entity: g.entidad,
      objeto: g.titulo,
      // "presentada" = Participada (el primer estado del pipeline propio).
      status: "presentada",
      amount_ref_usd: g.precio_ref,
      delivery_date: g.fecha_cierre ? String(g.fecha_cierre).slice(0, 10) : null,
      // Carpeta de Dropbox si ya existe (paso 1); si no, el link a PanamaCompra.
      folder_url: g.dropbox_folder_url ?? g.url,
      notes: `Participada desde PanamaCompra${g.url ? ` · ${g.url}` : ""}`,
      source: "panamacompra",
    })
    .select("id")
    .single()) as { data: { id: string } | null; error: { message: string } | null };
  if (error || !t) return { error: error?.message ?? "No se pudo crear" };

  // Backlink con guarda: solo si sigue sin vincular (evita doble-follow por
  // dos clicks concurrentes). Si falla o ya lo tomó otro, borrar el tender
  // recién creado para no dejar duplicados huérfanos.
  const { data: linked, error: linkErr } = (await c.supabase
    .from("gov_tenders")
    .update({ converted_tender_id: t.id })
    .eq("id", govId)
    .eq("org_id", c.orgId)
    .is("converted_tender_id", null)
    .select("id")) as { data: { id: string }[] | null; error: { message: string } | null };
  if (linkErr || !linked || linked.length === 0) {
    await c.supabase.from("tenders").delete().eq("id", t.id).eq("org_id", c.orgId);
    return { error: linkErr ? linkErr.message : "Ya la estás siguiendo" };
  }
  revalidatePath("/potenciales");
  return { ok: true, data: { tenderId: t.id } };
}
