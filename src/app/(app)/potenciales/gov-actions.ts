"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { hasPanamaCompraConfig, pcLogin, pcListProcesos, pcPliegoRaw, extractPrecioRef, type PcRegistro } from "@/lib/panamacompra/client";

type Result<T> = { error: string } | { ok: true; data: T };

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
  precio_ref: number | null;
  url: string | null;
  seen_at: string | null;
  converted_tender_id: string | null;
};

// Abrir la vista lee SOLO de la base (patrón de siempre: cero llamadas afuera).
export async function listGovTenders(): Promise<Result<{ rows: GovTenderRow[]; syncedAt: number | null }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const { data, error } = (await c.supabase
    .from("gov_tenders")
    .select("id, num_proceso, titulo, entidad, fecha_cierre, precio_ref, url, seen_at, converted_tender_id")
    .eq("org_id", c.orgId)
    .order("fecha_cierre", { ascending: true, nullsFirst: false })) as {
    data: GovTenderRow[] | null;
    error: { message: string } | null;
  };
  if (error) return { error: "Falta la migración 0010 (gov_tenders)" };
  let syncedAt: number | null = null;
  const rows = (data ?? []).map((r) => {
    if (r.seen_at) syncedAt = Math.max(syncedAt ?? 0, +new Date(r.seen_at));
    return { ...r, precio_ref: r.precio_ref === null ? null : Number(r.precio_ref) };
  });
  return { ok: true, data: { rows, syncedAt } };
}

// "Actualizar": login → paginar Licitación Pública Vigente (36/7) → precio de
// referencia best-effort (concurrencia 3, tope 60) → upsert dedup por proceso.
export async function refreshGovTenders(): Promise<Result<{ total: number; nuevos: number; conPrecio: number }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  if (!hasPanamaCompraConfig()) return { error: "Faltan PANAMACOMPRA_USER / PANAMACOMPRA_PASSWORD en Vercel." };
  try {
    const session = await pcLogin();
    const regs = await pcListProcesos(session, { idEstado: "36", idTipoProceso: "7", maxPages: 10 });

    // dedup dentro de la corrida por número de proceso
    const byNum = new Map<string, PcRegistro>();
    for (const r of regs) {
      const num = (r.numProcesoOriginal || r.numProceso || "").trim();
      if (num && !byNum.has(num)) byNum.set(num, r);
    }
    const list = Array.from(byNum.entries());

    // precio de referencia (best-effort, suave)
    const precios = new Map<string, number>();
    const withFlujos = list.filter(([, r]) => r.idProcesosContratacionFlujos).slice(0, 60);
    for (let i = 0; i < withFlujos.length; i += 3) {
      await Promise.all(
        withFlujos.slice(i, i + 3).map(async ([num, r]) => {
          try {
            const raw = await pcPliegoRaw(session, "7", String(r.idProcesosContratacionFlujos));
            const precio = extractPrecioRef(raw);
            if (precio !== null) precios.set(num, precio);
          } catch {
            /* sin precio */
          }
        }),
      );
    }

    // existentes (para contar nuevos)
    const { data: existing } = (await c.supabase.from("gov_tenders").select("num_proceso").eq("org_id", c.orgId)) as {
      data: { num_proceso: string }[] | null;
    };
    const have = new Set((existing ?? []).map((r) => r.num_proceso));

    const nowIso = new Date().toISOString();
    const rows = list.map(([num, r]) => ({
      org_id: c.orgId,
      num_proceso: num,
      titulo: r.titulo ?? null,
      entidad: r.nombre ?? null,
      fecha_cierre: r.fechaCierre ? new Date(r.fechaCierre).toISOString() : null,
      tipo: "licitacion_publica",
      precio_ref: precios.get(num) ?? null,
      url: `https://www.panamacompra.gob.pa/Inicio/#!/vistaPreviaCP?NumLc=${encodeURIComponent(num)}&esap=1&nnc=0&it=1`,
      raw: r as unknown,
      seen_at: nowIso,
    }));
    if (rows.length) {
      const { error } = await c.supabase.from("gov_tenders").upsert(rows, { onConflict: "org_id,num_proceso" });
      if (error) return { error: error.message };
    }
    const nuevos = rows.filter((r) => !have.has(r.num_proceso)).length;
    revalidatePath("/potenciales");
    return { ok: true, data: { total: rows.length, nuevos, conPrecio: precios.size } };
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
    .select("num_proceso, titulo, entidad, fecha_cierre, precio_ref, url, converted_tender_id")
    .eq("id", govId)
    .eq("org_id", c.orgId)
    .maybeSingle()) as {
    data: (Omit<GovTenderRow, "id" | "seen_at"> & { converted_tender_id: string | null }) | null;
  };
  if (!g) return { error: "No encontrada" };
  if (g.converted_tender_id) return { error: "Ya la estás siguiendo" };

  const { data: t, error } = (await c.supabase
    .from("tenders")
    .insert({
      org_id: c.orgId,
      acto_number: g.num_proceso,
      year: g.fecha_cierre ? Number(String(g.fecha_cierre).slice(0, 4)) : new Date().getFullYear(),
      modalidad: "licitacion_publica",
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
