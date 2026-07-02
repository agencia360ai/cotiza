import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasPanamaCompraConfig, pcLogin, pcListProcesos, pcPliegoRaw, extractPrecioRef, type PcRegistro } from "./client";
import { matchKeywords, classifyWithAI } from "./relevance";

// Sync de licitaciones del gobierno — compartido entre la action (botón
// Actualizar) y el cron diario. Incremental: si ya hay data, corta el paginado
// al topar con una página entera ya conocida (lo nuevo aparece primero).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = SupabaseClient<any, any, any>;

const TIPOS: { idEstado: string; idTipoProceso: string; enviada?: string; key: string; maxPages: number }[] = [
  { idEstado: "36", idTipoProceso: "7", key: "licitacion_publica", maxPages: 10 },
  { idEstado: "36", idTipoProceso: "6", key: "compra_menor_50k", maxPages: 8 },
  { idEstado: "1011", idTipoProceso: "4", enviada: "1", key: "compra_menor_10k", maxPages: 6 },
  { idEstado: "15", idTipoProceso: "2", key: "programada", maxPages: 4 },
];

export type SyncStats = { total: number; nuevos: number; relevantes: number; conPrecio: number; incremental: boolean };

export async function syncGovTenders(db: Db, orgId: string): Promise<{ error: string } | { ok: true; data: SyncStats }> {
  if (!hasPanamaCompraConfig()) return { error: "Faltan PANAMACOMPRA_USER / PANAMACOMPRA_PASSWORD en Vercel." };
  try {
    const session = await pcLogin();

    // Conocidos (para modo incremental + conteo de nuevos).
    const { data: existing } = (await db.from("gov_tenders").select("num_proceso").eq("org_id", orgId)) as {
      data: { num_proceso: string }[] | null;
    };
    const have = new Set((existing ?? []).map((r) => r.num_proceso));
    const incremental = have.size > 0;

    // 1) Traer tipos; corte temprano cuando la página entera ya es conocida.
    const byNum = new Map<string, { r: PcRegistro; tipo: string; idTipoProceso: string }>();
    for (const t of TIPOS) {
      try {
        const regs = await pcListProcesos(session, {
          ...t,
          shouldStop: incremental ? (nums) => nums.every((n) => have.has(n)) : undefined,
        });
        for (const r of regs) {
          const num = (r.numProcesoOriginal || r.numProceso || "").trim();
          if (num && !byNum.has(num)) byNum.set(num, { r, tipo: t.key, idTipoProceso: t.idTipoProceso });
        }
      } catch {
        /* un tipo caído no tumba el sync */
      }
    }
    const list = Array.from(byNum.entries());

    // 2) Precio de referencia: solo para los NUEVOS (los viejos ya lo tienen o no).
    const precios = new Map<string, number>();
    const paraPrecio = list
      .filter(([num, v]) => !have.has(num) && v.r.idProcesosContratacionFlujos)
      .sort(([, a], [, b]) => (a.tipo === "licitacion_publica" ? -1 : 1) - (b.tipo === "licitacion_publica" ? -1 : 1))
      .slice(0, 60);
    for (let i = 0; i < paraPrecio.length; i += 3) {
      await Promise.all(
        paraPrecio.slice(i, i + 3).map(async ([num, v]) => {
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

    // 3) Upsert (seen_at refresca en los que siguen apareciendo).
    const nowIso = new Date().toISOString();
    const rows = list.map(([num, v]) => ({
      org_id: orgId,
      num_proceso: num,
      titulo: v.r.titulo ?? null,
      entidad: v.r.nombre ?? null,
      fecha_cierre: v.r.fechaCierre ? new Date(v.r.fechaCierre).toISOString() : null,
      tipo: v.tipo,
      ...(precios.has(num) ? { precio_ref: precios.get(num) } : {}),
      url: `https://www.panamacompra.gob.pa/Inicio/#!/vistaPreviaCP?NumLc=${encodeURIComponent(num)}&esap=1&nnc=0&it=1`,
      raw: v.r as unknown,
      seen_at: nowIso,
    }));
    if (rows.length) {
      const { error } = await db.from("gov_tenders").upsert(rows, { onConflict: "org_id,num_proceso" });
      if (error) return { error: error.message };
    }
    const nuevos = rows.filter((r) => !have.has(r.num_proceso)).length;

    // 4) Clasificar lo sin clasificar (keywords fuertes directo; resto IA).
    let relevantes = 0;
    const { data: pend } = (await db
      .from("gov_tenders")
      .select("id, titulo")
      .eq("org_id", orgId)
      .is("relevante", null)
      .limit(600)) as { data: { id: string; titulo: string | null }[] | null };
    const pending = pend ?? [];
    if (pending.length > 0) {
      const updates: { id: string; relevante: boolean; motivo: string | null }[] = [];
      const paraIA: { i: number; titulo: string }[] = [];
      pending.forEach((p, i) => {
        const kws = matchKeywords(p.titulo);
        if (kws.strong.length > 0) updates.push({ id: p.id, relevante: true, motivo: kws.strong.slice(0, 3).join(", ") });
        else if (p.titulo) paraIA.push({ i, titulo: p.titulo });
        else updates.push({ id: p.id, relevante: false, motivo: null });
      });
      const ai = await classifyWithAI(paraIA);
      for (const { i } of paraIA) {
        const v = ai.get(i);
        if (v) updates.push({ id: pending[i].id, relevante: v.relevante, motivo: v.motivo });
      }
      for (let i = 0; i < updates.length; i += 20) {
        await Promise.all(
          updates.slice(i, i + 20).map((u) =>
            db.from("gov_tenders").update({ relevante: u.relevante, relevancia_motivo: u.motivo }).eq("id", u.id).eq("org_id", orgId),
          ),
        );
      }
      relevantes = updates.filter((u) => u.relevante).length;
    }

    return { ok: true, data: { total: rows.length, nuevos, relevantes, conPrecio: precios.size, incremental } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Error consultando PanamaCompra" };
  }
}
