"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { syncGovTenders, TIPO_TO_ID } from "@/lib/panamacompra/sync";
import { evaluateTender } from "@/lib/panamacompra/evaluate";
import {
  hasPanamaCompraConfig,
  pcLogin,
  pcPliegoRaw,
  extractDetalle,
  extractPrecioRef,
  type GovDetalle,
} from "@/lib/panamacompra/client";
import { hasDropboxConfig, createFolder, getSharedLink } from "@/lib/dropbox/client";
import { analyzeTenderDocs, type GovDocAnalisis } from "@/lib/panamacompra/docs";
import type { GovTenderEval } from "@/lib/panamacompra/tamiz";

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
  relevante: boolean | null;
  relevancia_motivo: string | null;
  converted_tender_id: string | null;
  eval: GovTenderEval | null;
  detalle: GovDetalle | null;
  dropbox_folder_path: string | null;
  dropbox_folder_url: string | null;
  doc_analisis: GovDocAnalisis | null;
};

// Abrir la vista lee SOLO de la base (cero llamadas al gobierno).
export async function listGovTenders(): Promise<Result<{ rows: GovTenderRow[]; syncedAt: number | null }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  type Res = { data: GovTenderRow[] | null; error: ({ message: string; code?: string }) | null };
  const run = (cols: string) =>
    c.supabase.from("gov_tenders").select(cols).eq("org_id", c.orgId).order("fecha_cierre", { ascending: true, nullsFirst: false });
  let res = (await run(
    "id, num_proceso, titulo, entidad, fecha_cierre, tipo, precio_ref, url, seen_at, relevante, relevancia_motivo, converted_tender_id, eval, detalle, dropbox_folder_path, dropbox_folder_url, doc_analisis",
  )) as Res;
  if (isMissingColumn(res.error)) {
    // migración 0018 pendiente: sin columna doc_analisis
    res = (await run(
      "id, num_proceso, titulo, entidad, fecha_cierre, tipo, precio_ref, url, seen_at, relevante, relevancia_motivo, converted_tender_id, eval, detalle, dropbox_folder_path, dropbox_folder_url",
    )) as Res;
  }
  if (isMissingColumn(res.error)) {
    // migración 0017 pendiente: sin columnas de dropbox
    res = (await run(
      "id, num_proceso, titulo, entidad, fecha_cierre, tipo, precio_ref, url, seen_at, relevante, relevancia_motivo, converted_tender_id, eval, detalle",
    )) as Res;
  }
  if (isMissingColumn(res.error)) {
    // migración 0015 pendiente: sin columna detalle
    res = (await run(
      "id, num_proceso, titulo, entidad, fecha_cierre, tipo, precio_ref, url, seen_at, relevante, relevancia_motivo, converted_tender_id, eval",
    )) as Res;
  }
  if (isMissingColumn(res.error)) {
    // migración 0013 pendiente: sin columna eval
    res = (await run(
      "id, num_proceso, titulo, entidad, fecha_cierre, tipo, precio_ref, url, seen_at, relevante, relevancia_motivo, converted_tender_id",
    )) as Res;
  }
  if (isMissingColumn(res.error)) {
    // migración 0011 pendiente: sin columnas de relevancia
    res = (await run("id, num_proceso, titulo, entidad, fecha_cierre, tipo, precio_ref, url, seen_at, converted_tender_id")) as Res;
  }
  // Error de esquema base → probablemente falta 0010; error real se reporta tal cual.
  if (res.error) {
    return { error: isMissingColumn(res.error) ? "Falta la migración 0010 (gov_tenders)" : res.error.message };
  }
  let syncedAt: number | null = null;
  const rows = (res.data ?? []).map((r) => {
    if (r.seen_at) syncedAt = Math.max(syncedAt ?? 0, +new Date(r.seen_at));
    return {
      ...r,
      precio_ref: r.precio_ref === null ? null : Number(r.precio_ref),
      relevante: r.relevante ?? null,
      relevancia_motivo: r.relevancia_motivo ?? null,
      eval: r.eval ?? null,
      detalle: r.detalle ?? null,
      dropbox_folder_path: r.dropbox_folder_path ?? null,
      dropbox_folder_url: r.dropbox_folder_url ?? null,
      doc_analisis: r.doc_analisis ?? null,
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
    if (error) return { error: "Falta la migración 0013 (eval) — corré el SQL y reintentá" };
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
    const precio = g.precio_ref === null ? extractPrecioRef(pliego) : null;
    const patch: Record<string, unknown> = { detalle };
    if (precio !== null) patch.precio_ref = precio;
    const { error } = await c.supabase.from("gov_tenders").update(patch).eq("id", govId).eq("org_id", c.orgId);
    if (error) return { error: "Falta la migración 0015 (detalle) — corré el SQL y reintentá" };
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
    if (error) return { error: "Falta la migración 0017 (dropbox) — corré el SQL y reintentá" };
    revalidatePath("/potenciales");
    return { ok: true, data: { path, url } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo crear la carpeta en Dropbox" };
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
  if (!g.dropbox_folder_path) return { error: "Creá primero la carpeta en Dropbox y subí los documentos del pliego." };
  const r = await analyzeTenderDocs({ folderPath: g.dropbox_folder_path, titulo: g.titulo });
  if (!r.ok) return { error: r.error };
  const { error } = await c.supabase.from("gov_tenders").update({ doc_analisis: r.data }).eq("id", govId).eq("org_id", c.orgId);
  if (error) return { error: "Falta la migración 0018 (doc_analisis) — corré el SQL y reintentá" };
  revalidatePath("/potenciales");
  return { ok: true, data: { analisis: r.data } };
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
    .select("num_proceso, titulo, entidad, fecha_cierre, tipo, precio_ref, url, converted_tender_id")
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
    } | null;
  };
  if (!g) return { error: "No encontrada" };
  if (g.converted_tender_id) return { error: "Ya la estás siguiendo" };

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
      status: "por_partir",
      amount_ref_usd: g.precio_ref,
      delivery_date: g.fecha_cierre ? String(g.fecha_cierre).slice(0, 10) : null,
      folder_url: g.url,
      notes: "Importada de PanamaCompra",
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
