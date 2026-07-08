import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasPanamaCompraConfig, pcLogin, pcListProcesos, pcPliegoRaw, extractPrecioBreakdown, type PcRegistro } from "./client";
import { matchKeywords, classifyWithAI } from "./relevance";

// Sync de licitaciones del gobierno — compartido entre la action (botón
// Actualizar) y el cron diario. Incremental: si ya hay data, corta el paginado
// al topar con una página entera ya conocida (lo nuevo aparece primero).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = SupabaseClient<any, any, any>;

// Topes generosos (50 procesos por página): el corte incremental hace que el
// costo diario sea bajo; el tope solo protege el serverless en escaneos llenos.
const TIPOS: { idEstado: string; idTipoProceso: string; enviada?: string; key: string; maxPages: number }[] = [
  { idEstado: "36", idTipoProceso: "7", key: "licitacion_publica", maxPages: 20 },
  { idEstado: "36", idTipoProceso: "6", key: "compra_menor_50k", maxPages: 16 },
  { idEstado: "1011", idTipoProceso: "4", enviada: "1", key: "compra_menor_10k", maxPages: 24 },
  { idEstado: "15", idTipoProceso: "2", key: "programada", maxPages: 8 },
];

// tipo guardado → idTipoProceso de la API (lo usan el backfill y la evaluación).
export const TIPO_TO_ID: Record<string, string> = Object.fromEntries(TIPOS.map((t) => [t.key, t.idTipoProceso]));

// "la columna no existe" (migración pendiente → fallback) vs error real.
function isMissingColumn(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42703") return true;
  return /does not exist|could not find|schema cache/i.test(error.message ?? "");
}

// Fecha del gobierno → ISO, sin romper el sync si viene malformada (poison pill).
function safeIso(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export type SyncStats = {
  total: number;
  nuevos: number;
  relevantes: number;
  conPrecio: number;
  pendientesPrecio: number;
  incremental: boolean;
  // Auditoría de cobertura: cuántos trajo cada tipo y si algún tipo quedó
  // truncado por el tope de páginas (⇒ hay más en PanamaCompra).
  porTipo: Record<string, number>;
  truncados: string[];
};

export async function syncGovTenders(
  db: Db,
  orgId: string,
  opts?: { full?: boolean },
): Promise<{ error: string } | { ok: true; data: SyncStats }> {
  if (!hasPanamaCompraConfig()) return { error: "Faltan PANAMACOMPRA_USER / PANAMACOMPRA_PASSWORD en Vercel." };
  try {
    const session = await pcLogin();

    // Conocidos (para modo incremental + conteo de nuevos).
    const { data: existing } = (await db.from("gov_tenders").select("num_proceso").eq("org_id", orgId)) as {
      data: { num_proceso: string }[] | null;
    };
    const have = new Set((existing ?? []).map((r) => r.num_proceso));
    // "Escaneo completo" recorre todas las páginas aunque ya conozca procesos —
    // para recuperar cualquier cosa que el corte incremental se haya perdido.
    const incremental = have.size > 0 && !opts?.full;

    // 1) Traer tipos; corte temprano cuando la página entera ya es conocida.
    const byNum = new Map<string, { r: PcRegistro; tipo: string; idTipoProceso: string }>();
    const porTipo: Record<string, number> = {};
    const truncados: string[] = [];
    for (const t of TIPOS) {
      try {
        const { registros, truncado } = await pcListProcesos(session, {
          ...t,
          shouldStop: incremental ? (nums) => nums.every((n) => have.has(n)) : undefined,
        });
        porTipo[t.key] = registros.length;
        if (truncado) truncados.push(t.key);
        for (const r of registros) {
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
      fecha_cierre: safeIso(v.r.fechaCierre),
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
      .order("fecha_cierre", { ascending: true, nullsFirst: false })
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
    // precio_checked: columna (migración 0014). El backfill solo mira lo abierto,
    // sin precio, no chequeado, y que NO sea explícitamente irrelevante (ahorra
    // presupuesto). Relevantes y cierres próximos primero.
    const backfillCols = "id, tipo, raw";
    const runSinPrecio = (useCol: boolean) => {
      let qy = db
        .from("gov_tenders")
        .select(backfillCols)
        .eq("org_id", orgId)
        .is("precio_ref", null)
        .or("relevante.is.null,relevante.is.true")
        .or(`fecha_cierre.is.null,fecha_cierre.gte.${nowIso}`);
      qy = useCol ? qy.eq("precio_checked", false) : qy.is("raw->>_precio_checked", null);
      return qy
        .order("relevante", { ascending: false, nullsFirst: false })
        .order("fecha_cierre", { ascending: true, nullsFirst: false })
        .limit(400);
    };
    let spRes = (await runSinPrecio(true)) as {
      data: { id: string; tipo: string | null; raw: unknown }[] | null;
      error: ({ message: string; code?: string }) | null;
    };
    if (isMissingColumn(spRes.error)) spRes = (await runSinPrecio(false)) as typeof spRes; // 0014 pendiente
    const sinPrecio = spRes.data ?? [];

    // Guarda precio + desglose auditable (si la columna 0019 no existe, cae a
    // guardar solo el precio).
    const setPrecio = async (id: string, precio: number, breakdown: unknown) => {
      const { error } = await db.from("gov_tenders").update({ precio_ref: precio, precio_breakdown: breakdown }).eq("id", id).eq("org_id", orgId);
      if (isMissingColumn(error)) {
        await db.from("gov_tenders").update({ precio_ref: precio }).eq("id", id).eq("org_id", orgId);
      }
    };
    // Marca "el gobierno no publica precio" en la columna (no pisa raw). Fallback
    // al marcador viejo dentro de raw si la migración 0014 no corrió.
    const marcarSinPrecio = async (id: string, raw: unknown) => {
      const { error } = await db.from("gov_tenders").update({ precio_checked: true }).eq("id", id).eq("org_id", orgId);
      if (isMissingColumn(error)) {
        await db
          .from("gov_tenders")
          .update({ raw: { ...(raw as Record<string, unknown>), _precio_checked: true } })
          .eq("id", id)
          .eq("org_id", orgId);
      }
    };

    // El precio SIEMPRE sale del PLIEGO (tiene el total del proceso + los
    // renglones); el registro de la lista puede traer un valor parcial/de un
    // renglón. Presupuesto por corrida (el cron nocturno completa el backlog).
    const PRECIO_BUDGET = 120;
    const intentar = sinPrecio.slice(0, PRECIO_BUDGET);
    for (let i = 0; i < intentar.length; i += 3) {
      await Promise.all(
        intentar.slice(i, i + 3).map(async (p) => {
          const rw = p.raw as { idProcesosContratacionFlujos?: string | number } | null;
          const idFlujos = rw?.idProcesosContratacionFlujos;
          const idTipo = p.tipo ? TIPO_TO_ID[p.tipo] : undefined;
          if (!idFlujos || !idTipo) {
            await marcarSinPrecio(p.id, p.raw);
            return;
          }
          try {
            const rawPliego = await pcPliegoRaw(session, idTipo, String(idFlujos));
            const bd = rawPliego ? extractPrecioBreakdown(rawPliego) : null;
            if (bd && bd.elegido !== null) {
              await setPrecio(p.id, bd.elegido, bd);
              conPrecio++;
            } else {
              // El pliego respondió y no publica precio: no reintentar.
              await marcarSinPrecio(p.id, p.raw);
            }
          } catch {
            /* error de red/auth: se reintenta en la próxima corrida (no se marca) */
          }
        }),
      );
    }
    pendientesPrecio = Math.max(0, sinPrecio.length - intentar.length);

    return { ok: true, data: { total: rows.length, nuevos, relevantes, conPrecio, pendientesPrecio, incremental, porTipo, truncados } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Error consultando PanamaCompra" };
  }
}
