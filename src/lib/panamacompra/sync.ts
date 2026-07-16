import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasPanamaCompraConfig, pcLogin, pcListProcesos, pcPliegoRaw, extractPrecioBreakdown, type PcRegistro } from "./client";
import { matchKeywords, classifyWithAI, esVehicular } from "./relevance";

// Sync de licitaciones del gobierno — compartido entre la action (botón
// Actualizar) y el cron diario. Incremental: si ya hay data, corta el paginado
// al topar con una página entera ya conocida (lo nuevo aparece primero).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = SupabaseClient<any, any, any>;

// Topes generosos (50 procesos por página): el corte incremental hace que el
// costo diario sea bajo; el tope solo protege el serverless en escaneos llenos.
// maxPages = tope POR PASADA. Con cursores reanudables (0026) el escaneo
// completo continúa entre corridas, así que estos topes solo acotan cuánto
// avanza cada pasada; el ciclo entero cubre TODAS las páginas en varios loops.
const TIPOS: { idEstado: string; idTipoProceso: string; enviada?: string; key: string; maxPages: number }[] = [
  { idEstado: "36", idTipoProceso: "7", key: "licitacion_publica", maxPages: 20 },
  { idEstado: "36", idTipoProceso: "6", key: "compra_menor_50k", maxPages: 20 },
  { idEstado: "1011", idTipoProceso: "4", enviada: "1", key: "compra_menor_10k", maxPages: 24 },
  { idEstado: "15", idTipoProceso: "2", key: "programada", maxPages: 30 },
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
  opts?: { full?: boolean; deadlineTs?: number },
): Promise<{ error: string } | { ok: true; data: SyncStats }> {
  if (!hasPanamaCompraConfig()) return { error: "Faltan PANAMACOMPRA_USER / PANAMACOMPRA_PASSWORD en Vercel." };
  // Time-box: la función de Vercel corta a los 300s. Cortamos ANTES (~235s) para
  // no timeoutear nunca; lo que quede se completa en la próxima corrida / el cron.
  // El cron multi-org pasa SU deadline global — si cada org usara 235s propios,
  // la segunda org correría más allá del límite de la función.
  const deadline = Math.min(opts?.deadlineTs ?? Infinity, Date.now() + 235_000);
  const vencido = () => Date.now() > deadline;
  try {
    const session = await pcLogin();

    // Conocidos (para modo incremental + conteo de nuevos). PAGINADO: PostgREST
    // corta en 1000 filas; con miles de procesos el set quedaría incompleto, el
    // corte incremental casi nunca dispararía y "nuevos" se sobrecontaría.
    const have = new Set<string>();
    for (let from = 0; from < 30_000; from += 1000) {
      const { data: pageRows } = (await db
        .from("gov_tenders")
        .select("num_proceso")
        .eq("org_id", orgId)
        .order("num_proceso")
        .range(from, from + 999)) as { data: { num_proceso: string }[] | null };
      for (const r of pageRows ?? []) have.add(r.num_proceso);
      if ((pageRows?.length ?? 0) < 1000) break;
    }
    // "Escaneo completo" recorre todas las páginas aunque ya conozca procesos —
    // para recuperar cualquier cosa que el corte incremental se haya perdido.
    const incremental = have.size > 0 && !opts?.full;

    // Cursores de paginación (SOLO escaneo completo): permiten CONTINUAR entre
    // corridas en vez de re-topar siempre el mismo cap → el escaneo "lo hace
    // todo" en varios loops sin timeoutear.
    const cursores = new Map<string, { cursor: string | null; done: boolean }>();
    if (opts?.full) {
      const { data: cur } = (await db
        .from("gov_scan_cursors")
        .select("tipo, cursor, done")
        .eq("org_id", orgId)) as { data: { tipo: string; cursor: string | null; done: boolean }[] | null };
      for (const c of cur ?? []) cursores.set(c.tipo, { cursor: c.cursor, done: c.done });
    }

    // 1) Traer tipos; corte temprano cuando la página entera ya es conocida.
    const byNum = new Map<string, { r: PcRegistro; tipo: string; idTipoProceso: string }>();
    const porTipo: Record<string, number> = {};
    const truncados: string[] = [];
    for (const t of TIPOS) {
      // Escaneo completo: saltar los tipos ya AGOTADOS este ciclo (no re-listar).
      if (opts?.full && cursores.get(t.key)?.done) continue;
      if (vencido()) {
        truncados.push(t.key); // no dio el tiempo para este tipo → hay más
        continue;
      }
      try {
        const cs = cursores.get(t.key);
        const { registros, truncado, cursor, agotado } = await pcListProcesos(session, {
          ...t,
          shouldStop: incremental ? (nums) => nums.every((n) => have.has(n)) : undefined,
          deadlineTs: deadline,
          startCursor: opts?.full ? (cs?.cursor ?? undefined) : undefined,
        });
        porTipo[t.key] = registros.length;
        if (opts?.full) {
          // Persistir avance: done si se agotó el listado; si no, guardar cursor
          // para continuar en la próxima pasada (y marcarlo como pendiente).
          await db.from("gov_scan_cursors").upsert(
            { org_id: orgId, tipo: t.key, cursor: agotado ? null : cursor, done: agotado, updated_at: new Date().toISOString() },
            { onConflict: "org_id,tipo" },
          );
          if (!agotado) truncados.push(t.key);
        } else if (truncado) {
          truncados.push(t.key);
        }
        for (const r of registros) {
          const num = (r.numProcesoOriginal || r.numProceso || "").trim();
          if (num && !byNum.has(num)) byNum.set(num, { r, tipo: t.key, idTipoProceso: t.idTipoProceso });
        }
      } catch {
        /* un tipo caído no tumba el sync */
      }
    }
    // Ciclo completo (todos los tipos agotados): resetear los cursores para que
    // el próximo escaneo arranque fresco (recobra removidos/actualizados).
    if (opts?.full && truncados.length === 0) {
      await db.from("gov_scan_cursors").update({ done: false, cursor: null }).eq("org_id", orgId);
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
    //    SOLO ABIERTAS: clasificar cerradas es tirar presupuesto (no se pueden
    //    licitar) y peor: al ordenar por cierre ascendente, las cientos de ya
    //    cerradas se comían el límite ANTES de llegar a las vivas — las HVAC
    //    próximas a cerrar quedaban "sin clasificar" para siempre. El match por
    //    keywords es gratis (regex) y resuelve las inequívocas al instante;
    //    solo lo ambiguo va a la IA (con presupuesto de tiempo). Límite alto
    //    para drenar el backlog de abiertas en pocas corridas.
    let relevantes = 0;
    const { data: pend } = (await db
      .from("gov_tenders")
      .select("id, titulo")
      .eq("org_id", orgId)
      .is("relevante", null)
      .or(`fecha_cierre.is.null,fecha_cierre.gte.${nowIso}`)
      .order("fecha_cierre", { ascending: true, nullsFirst: false })
      .limit(1200)) as { data: { id: string; titulo: string | null }[] | null };
    const pending = pend ?? [];
    if (pending.length > 0) {
      const updates: { id: string; relevante: boolean; motivo: string | null }[] = [];
      const paraIA: { i: number; titulo: string }[] = [];
      pending.forEach((p, i) => {
        const kws = matchKeywords(p.titulo);
        // Keyword fuerte + contexto vehicular (A/A de auto/flota) → no auto-marcar;
        // la IA distingue el A/A automotriz del HVAC de edificios.
        if (kws.strong.length > 0 && !esVehicular(p.titulo)) {
          updates.push({ id: p.id, relevante: true, motivo: kws.strong.slice(0, 3).join(", ") });
        } else if (p.titulo) paraIA.push({ i, titulo: p.titulo });
        else updates.push({ id: p.id, relevante: false, motivo: null });
      });
      const ai = vencido() ? new Map<number, { relevante: boolean; motivo: string | null }>() : await classifyWithAI(paraIA, deadline);
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
    // EFICIENCIA: el pliego (pesado, red al gobierno) se baja SOLO para
    // RELEVANTES abiertas sin precio — que son ~decenas, no miles. Lo no
    // relevante es ruido y no necesita precio. Cierres próximos primero.
    const backfillCols = "id, tipo, raw";
    const runSinPrecio = (useCol: boolean) => {
      let qy = db
        .from("gov_tenders")
        .select(backfillCols)
        .eq("org_id", orgId)
        .eq("relevante", true)
        .is("precio_ref", null)
        .or(`fecha_cierre.is.null,fecha_cierre.gte.${nowIso}`);
      qy = useCol ? qy.eq("precio_checked", false) : qy.is("raw->>_precio_checked", null);
      return qy.order("fecha_cierre", { ascending: true, nullsFirst: false }).limit(400);
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
    // renglón. Presupuesto por corrida + corte por tiempo → nunca timeoutea.
    const PRECIO_BUDGET = 80;
    const intentar = sinPrecio.slice(0, PRECIO_BUDGET);
    let intentados = 0;
    for (let i = 0; i < intentar.length; i += 3) {
      if (vencido()) break; // se acabó el tiempo → el resto va en la próxima corrida
      const lote = intentar.slice(i, i + 3);
      intentados += lote.length;
      await Promise.all(
        lote.map(async (p) => {
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
    pendientesPrecio = Math.max(0, sinPrecio.length - intentados);

    return { ok: true, data: { total: rows.length, nuevos, relevantes, conPrecio, pendientesPrecio, incremental, porTipo, truncados } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Error consultando PanamaCompra" };
  }
}
