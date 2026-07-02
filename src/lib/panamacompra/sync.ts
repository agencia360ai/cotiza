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

export type SyncStats = {
  total: number;
  nuevos: number;
  relevantes: number;
  conPrecio: number;
  pendientesPrecio: number;
  incremental: boolean;
};

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

    // 2) Upsert (seen_at refresca en los que siguen apareciendo). El precio no
    //    va acá: se completa en el paso 4 y nunca se pisa el ya guardado.
    const nowIso = new Date().toISOString();
    const rows = list.map(([num, v]) => ({
      org_id: orgId,
      num_proceso: num,
      titulo: v.r.titulo ?? null,
      entidad: v.r.nombre ?? null,
      fecha_cierre: v.r.fechaCierre ? new Date(v.r.fechaCierre).toISOString() : null,
      tipo: v.tipo,
      url: `https://www.panamacompra.gob.pa/Inicio/#!/vistaPreviaCP?NumLc=${encodeURIComponent(num)}&esap=1&nnc=0&it=1`,
      raw: v.r as unknown,
      seen_at: nowIso,
    }));
    if (rows.length) {
      const { error } = await db.from("gov_tenders").upsert(rows, { onConflict: "org_id,num_proceso" });
      if (error) return { error: error.message };
    }
    const nuevos = rows.filter((r) => !have.has(r.num_proceso)).length;

    // 3) Clasificar lo sin clasificar (keywords fuertes directo; resto IA).
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

    // 4) Montos: backfill de precio_ref para TODO lo abierto sin precio (no solo
    //    los nuevos). Relevantes y cierres próximos primero. Primero se intenta
    //    extraer del JSON ya guardado (gratis); el resto consulta el pliego con
    //    presupuesto por corrida — el cron diario va completando el backlog.
    //    Los que el gobierno no publica quedan marcados para no reintentarlos.
    let conPrecio = 0;
    let pendientesPrecio = 0;
    const { data: sinPrecio } = (await db
      .from("gov_tenders")
      .select("id, tipo, raw")
      .eq("org_id", orgId)
      .is("precio_ref", null)
      .is("raw->>_precio_checked", null)
      .or(`fecha_cierre.is.null,fecha_cierre.gte.${nowIso}`)
      .order("relevante", { ascending: false, nullsFirst: false })
      .order("fecha_cierre", { ascending: true, nullsFirst: false })
      .limit(400)) as { data: { id: string; tipo: string | null; raw: unknown }[] | null };

    const setPrecio = (id: string, precio: number) =>
      db.from("gov_tenders").update({ precio_ref: precio }).eq("id", id).eq("org_id", orgId);
    const marcarSinPrecio = (id: string, raw: unknown) =>
      db
        .from("gov_tenders")
        .update({ raw: { ...(raw as Record<string, unknown>), _precio_checked: true } })
        .eq("id", id)
        .eq("org_id", orgId);

    // 4a) Del registro ya guardado, sin tocar la API.
    const paraPliego: { id: string; tipo: string | null; raw: unknown }[] = [];
    const locales: { id: string; precio: number }[] = [];
    for (const p of sinPrecio ?? []) {
      const local = extractPrecioRef(p.raw);
      if (local !== null) locales.push({ id: p.id, precio: local });
      else paraPliego.push(p);
    }
    for (let i = 0; i < locales.length; i += 20) {
      await Promise.all(locales.slice(i, i + 20).map((l) => setPrecio(l.id, l.precio)));
    }
    conPrecio += locales.length;

    // 4b) Pliego para el resto, hasta el presupuesto.
    const PRECIO_BUDGET = 60;
    const tipoToId = new Map(TIPOS.map((t) => [t.key, t.idTipoProceso]));
    const intentar = paraPliego.slice(0, PRECIO_BUDGET);
    for (let i = 0; i < intentar.length; i += 3) {
      await Promise.all(
        intentar.slice(i, i + 3).map(async (p) => {
          const rw = p.raw as { idProcesosContratacionFlujos?: string | number } | null;
          const idFlujos = rw?.idProcesosContratacionFlujos;
          const idTipo = p.tipo ? tipoToId.get(p.tipo) : undefined;
          if (!idFlujos || !idTipo) {
            await marcarSinPrecio(p.id, p.raw);
            return;
          }
          try {
            const rawPliego = await pcPliegoRaw(session, idTipo, String(idFlujos));
            const precio = rawPliego ? extractPrecioRef(rawPliego) : null;
            if (precio !== null) {
              await setPrecio(p.id, precio);
              conPrecio++;
            } else {
              // El pliego respondió pero no publica precio: no reintentar.
              await marcarSinPrecio(p.id, p.raw);
            }
          } catch {
            /* error de red: se reintenta en la próxima corrida */
          }
        }),
      );
    }
    pendientesPrecio = Math.max(0, paraPliego.length - intentar.length);

    return { ok: true, data: { total: rows.length, nuevos, relevantes, conPrecio, pendientesPrecio, incremental } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Error consultando PanamaCompra" };
  }
}
