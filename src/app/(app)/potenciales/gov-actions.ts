"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { syncGovTenders } from "@/lib/panamacompra/sync";
import { evaluateTender } from "@/lib/panamacompra/evaluate";
import type { GovTenderEval } from "@/lib/panamacompra/tamiz";

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
};

// Abrir la vista lee SOLO de la base (cero llamadas al gobierno).
export async function listGovTenders(): Promise<Result<{ rows: GovTenderRow[]; syncedAt: number | null }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  type Res = { data: GovTenderRow[] | null; error: ({ message: string; code?: string }) | null };
  const run = (cols: string) =>
    c.supabase.from("gov_tenders").select(cols).eq("org_id", c.orgId).order("fecha_cierre", { ascending: true, nullsFirst: false });
  let res = (await run(
    "id, num_proceso, titulo, entidad, fecha_cierre, tipo, precio_ref, url, seen_at, relevante, relevancia_motivo, converted_tender_id, eval",
  )) as Res;
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
