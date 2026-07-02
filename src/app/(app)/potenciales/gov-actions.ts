"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { hasPanamaCompraConfig, pcLogin, pcListProcesos, pcPliegoRaw, extractPrecioRef, type PcRegistro } from "@/lib/panamacompra/client";
import { matchKeywords, classifyWithAI } from "@/lib/panamacompra/relevance";

type Result<T> = { error: string } | { ok: true; data: T };

async function ctx() {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { ok: false as const, error: "Sesión expirada" };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false as const, error: "Sin organización" };
  return { ok: true as const, supabase, orgId };
}

// Tipos de proceso que consultaba el tool Java original.
const TIPOS: { idEstado: string; idTipoProceso: string; enviada?: string; key: string; maxPages: number }[] = [
  { idEstado: "36", idTipoProceso: "7", key: "licitacion_publica", maxPages: 10 },
  { idEstado: "36", idTipoProceso: "6", key: "compra_menor_50k", maxPages: 8 },
  { idEstado: "1011", idTipoProceso: "4", enviada: "1", key: "compra_menor_10k", maxPages: 6 },
  { idEstado: "15", idTipoProceso: "2", key: "programada", maxPages: 4 },
];

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
};

// Abrir la vista lee SOLO de la base (cero llamadas al gobierno).
export async function listGovTenders(): Promise<Result<{ rows: GovTenderRow[]; syncedAt: number | null }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const run = (cols: string) =>
    c.supabase.from("gov_tenders").select(cols).eq("org_id", c.orgId).order("fecha_cierre", { ascending: true, nullsFirst: false });
  let res = (await run(
    "id, num_proceso, titulo, entidad, fecha_cierre, tipo, precio_ref, url, seen_at, relevante, relevancia_motivo, converted_tender_id",
  )) as { data: GovTenderRow[] | null; error: { message: string } | null };
  if (res.error) {
    // migración 0011 pendiente: sin columnas de relevancia
    res = (await run("id, num_proceso, titulo, entidad, fecha_cierre, tipo, precio_ref, url, seen_at, converted_tender_id")) as {
      data: GovTenderRow[] | null;
      error: { message: string } | null;
    };
  }
  if (res.error) return { error: "Falta la migración 0010 (gov_tenders)" };
  let syncedAt: number | null = null;
  const rows = (res.data ?? []).map((r) => {
    if (r.seen_at) syncedAt = Math.max(syncedAt ?? 0, +new Date(r.seen_at));
    return {
      ...r,
      precio_ref: r.precio_ref === null ? null : Number(r.precio_ref),
      relevante: r.relevante ?? null,
      relevancia_motivo: r.relevancia_motivo ?? null,
    };
  });
  return { ok: true, data: { rows, syncedAt } };
}

// "Actualizar": login → todos los tipos → upsert dedup → clasificar relevancia
// (keywords gratis + IA para el resto, solo filas sin clasificar).
export async function refreshGovTenders(): Promise<Result<{ total: number; nuevos: number; relevantes: number; conPrecio: number }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  if (!hasPanamaCompraConfig()) return { error: "Faltan PANAMACOMPRA_USER / PANAMACOMPRA_PASSWORD en Vercel." };
  try {
    const session = await pcLogin();

    // 1) Traer todos los tipos (dedup por número de proceso dentro de la corrida).
    const byNum = new Map<string, { r: PcRegistro; tipo: string; idTipoProceso: string }>();
    for (const t of TIPOS) {
      try {
        const regs = await pcListProcesos(session, t);
        for (const r of regs) {
          const num = (r.numProcesoOriginal || r.numProceso || "").trim();
          if (num && !byNum.has(num)) byNum.set(num, { r, tipo: t.key, idTipoProceso: t.idTipoProceso });
        }
      } catch {
        /* un tipo caído no tumba el refresh */
      }
    }
    const list = Array.from(byNum.entries());

    // 2) Precio de referencia best-effort (suave, tope 60, prioriza licitaciones).
    const precios = new Map<string, number>();
    const prioridad = list
      .filter(([, v]) => v.r.idProcesosContratacionFlujos)
      .sort(([, a], [, b]) => (a.tipo === "licitacion_publica" ? -1 : 1) - (b.tipo === "licitacion_publica" ? -1 : 1))
      .slice(0, 60);
    for (let i = 0; i < prioridad.length; i += 3) {
      await Promise.all(
        prioridad.slice(i, i + 3).map(async ([num, v]) => {
          try {
            const raw = await pcPliegoRaw(session, v.idTipoProceso, String(v.r.idProcesosContratacionFlujos));
            const precio = extractPrecioRef(raw);
            if (precio !== null) precios.set(num, precio);
          } catch {
            /* sin precio */
          }
        }),
      );
    }

    // 3) Upsert.
    const { data: existing } = (await c.supabase.from("gov_tenders").select("num_proceso").eq("org_id", c.orgId)) as {
      data: { num_proceso: string }[] | null;
    };
    const have = new Set((existing ?? []).map((r) => r.num_proceso));
    const nowIso = new Date().toISOString();
    const rows = list.map(([num, v]) => ({
      org_id: c.orgId,
      num_proceso: num,
      titulo: v.r.titulo ?? null,
      entidad: v.r.nombre ?? null,
      fecha_cierre: v.r.fechaCierre ? new Date(v.r.fechaCierre).toISOString() : null,
      tipo: v.tipo,
      precio_ref: precios.get(num) ?? null,
      url: `https://www.panamacompra.gob.pa/Inicio/#!/vistaPreviaCP?NumLc=${encodeURIComponent(num)}&esap=1&nnc=0&it=1`,
      raw: v.r as unknown,
      seen_at: nowIso,
    }));
    if (rows.length) {
      const { error } = await c.supabase.from("gov_tenders").upsert(rows, { onConflict: "org_id,num_proceso" });
      if (error) return { error: error.message };
    }
    const nuevos = rows.filter((r) => !have.has(r.num_proceso)).length;

    // 4) Clasificar relevancia de lo sin clasificar (keywords → IA, tope 160).
    let relevantes = 0;
    const { data: pend } = (await c.supabase
      .from("gov_tenders")
      .select("id, titulo")
      .eq("org_id", c.orgId)
      .is("relevante", null)
      .limit(600)) as { data: { id: string; titulo: string | null }[] | null };
    const pending = pend ?? [];
    if (pending.length > 0) {
      const updates: { id: string; relevante: boolean; motivo: string | null }[] = [];
      const paraIA: { i: number; titulo: string }[] = [];
      pending.forEach((p, i) => {
        const kws = matchKeywords(p.titulo);
        // Fuertes (inequívocos HVAC) → relevante directo. Ambiguos (bomba,
        // ducto...) o sin match → decide la IA con la taxonomía del tool viejo.
        if (kws.strong.length > 0) updates.push({ id: p.id, relevante: true, motivo: kws.strong.slice(0, 3).join(", ") });
        else if (p.titulo) paraIA.push({ i, titulo: p.titulo });
        else updates.push({ id: p.id, relevante: false, motivo: null });
      });
      const ai = await classifyWithAI(paraIA);
      for (const { i, titulo } of paraIA) {
        void titulo;
        const v = ai.get(i);
        if (v) updates.push({ id: pending[i].id, relevante: v.relevante, motivo: v.motivo });
      }
      for (let i = 0; i < updates.length; i += 20) {
        await Promise.all(
          updates.slice(i, i + 20).map((u) =>
            c.supabase.from("gov_tenders").update({ relevante: u.relevante, relevancia_motivo: u.motivo }).eq("id", u.id).eq("org_id", c.orgId),
          ),
        );
      }
      relevantes = updates.filter((u) => u.relevante).length;
    }

    revalidatePath("/potenciales");
    return { ok: true, data: { total: rows.length, nuevos, relevantes, conPrecio: precios.size } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Error consultando PanamaCompra" };
  }
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

  await c.supabase.from("gov_tenders").update({ converted_tender_id: t.id }).eq("id", govId).eq("org_id", c.orgId);
  revalidatePath("/potenciales");
  return { ok: true, data: { tenderId: t.id } };
}
