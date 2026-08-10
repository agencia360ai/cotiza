"use server";

import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { hasQboConfig } from "@/lib/quickbooks/mcp";
import {
  fetchQboProjectsList,
  fetchProjectFinancials,
  diagnosticarPnl,
  marginOf,
  type QboProject,
  type ProjectBizStatus,
  type PnlDiagnostico,
} from "@/lib/quickbooks/projects";
import { ventanaDeMeses, type MonthPnl } from "@/lib/quickbooks/parse";

export type QboProjectsResult =
  | {
      ok: true;
      projects: QboProject[];
      financialsOk: boolean;
      year: number;
      syncedAt: number | null;
      // Desde cuándo hay desglose mensual real. Antes de esa fecha el board
      // solo puede prorratear, y lo dice en vez de fingir precisión.
      mesesDesde: string | null;
    }
  | { ok: false; error: string };

type DB = Awaited<ReturnType<typeof createClient>>;

// Distingue "la columna todavía no existe" (migración pendiente → fallback OK)
// de un error real (RLS, conexión), que NO se debe tragar.
function isMissingColumn(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42703") return true;
  // Mismo patrón que pipeline/gov-actions: PostgREST reporta una columna nueva
  // como "could not find … in the schema cache" hasta recargar el schema.
  return /does not exist|could not find|schema cache/i.test(error.message ?? "");
}

// Dedupe de "Actualizar" concurrentes (un solo pull a QBO a la vez por org).
const inflight = new Map<string, Promise<QboProjectsResult>>();

// ── Abrir la página: leer SOLO de la base. Cero llamadas a QBO. ───────────────
// allYears=true (el board con filtro de fechas): trae TODOS los años — un
// contrato jun-2025→jun-2026 debe aparecer al filtrar 2026 aunque su fila viva
// en year=2025. Paginado (PostgREST corta en 1000).
async function loadFromDb(supabase: DB, orgId: string, year: number, allYears = false): Promise<QboProjectsResult> {
  type Row = {
    qb_job_id: string;
    name: string | null;
    full_name: string | null;
    rubro: string | null;
    year: number | null;
    client_name: string | null;
    closed: boolean;
    income: number | null;
    cost: number | null;
    synced_at: string | null;
    progress?: number | null;
    status?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    contract_total?: number | null;
    quote_number?: string | null;
    qbo_created_at?: string | null;
    first_txn_date?: string | null;
    last_txn_date?: string | null;
  };
  type Res = { data: Row[] | null; error: ({ message: string; code?: string }) | null };
  const run = async (cols: string): Promise<Res> => {
    const all: Row[] = [];
    for (let from = 0; from < 30_000; from += 1000) {
      let q = supabase.from("qbo_project_state").select(cols).eq("org_id", orgId);
      if (!allYears) q = q.eq("year", year);
      const r = (await q.order("qb_job_id").range(from, from + 999)) as unknown as Res;
      if (r.error) return r;
      all.push(...(r.data ?? []));
      if ((r.data?.length ?? 0) < 1000) break;
    }
    return { data: all, error: null };
  };
  const BASE_COLS = "qb_job_id, name, full_name, rubro, year, client_name, closed, income, cost, synced_at";
  const COLS_0037 = `${BASE_COLS}, progress, status, start_date, end_date, contract_total, quote_number`;
  let res = await run(`${COLS_0037}, qbo_created_at, first_txn_date, last_txn_date`);
  if (isMissingColumn(res.error)) res = await run(COLS_0037); // 0045 pendiente
  if (isMissingColumn(res.error)) res = await run(`${BASE_COLS}, progress, status, start_date, end_date, contract_total`); // 0037 pendiente
  if (isMissingColumn(res.error)) res = await run(`${BASE_COLS}, progress, status, start_date, end_date`); // 0023 pendiente
  if (isMissingColumn(res.error)) res = await run(`${BASE_COLS}, progress, status`); // 0022 pendiente
  if (isMissingColumn(res.error)) res = await run(`${BASE_COLS}, progress`); // 0016 pendiente
  if (isMissingColumn(res.error)) res = await run(BASE_COLS); // 0012 pendiente
  // Un error real (RLS/conexión) NO se traga como "no hay proyectos".
  if (res.error) return { ok: false, error: res.error.message };
  const rows = res.data ?? [];
  const { porProyecto: mesesPorProyecto, desde: mesesDesde } = await loadMeses(supabase, orgId);
  let syncedAt: number | null = null;
  const projects: QboProject[] = rows
    .map((r) => {
      const income = r.income === null ? null : Number(r.income);
      const cost = r.cost === null ? null : Number(r.cost);
      if (r.synced_at) syncedAt = Math.max(syncedAt ?? 0, new Date(r.synced_at).getTime());
      return {
        id: r.qb_job_id,
        name: r.name ?? r.qb_job_id,
        fullName: r.full_name ?? r.name ?? r.qb_job_id,
        parentId: null, // no se persiste; solo se usa durante el refresh desde QBO
        siblings: 1, // ídem: solo relevante durante el refresh
        rubro: r.rubro,
        year: r.year,
        clientName: r.client_name ?? "",
        income,
        cost,
        margin: marginOf(income, cost),
        closed: r.closed,
        // status derivado si la migración 0016 aún no corrió.
        status: (r.status ?? (r.closed ? "cerrado" : "activo")) as ProjectBizStatus,
        progress: r.progress ?? null,
        startDate: r.start_date ?? null,
        endDate: r.end_date ?? null,
        contractTotal: r.contract_total === null || r.contract_total === undefined ? null : Number(r.contract_total),
        quoteNumber: r.quote_number ?? null,
        qboCreatedAt: r.qbo_created_at ?? null,
        firstTxnDate: r.first_txn_date ?? null,
        lastTxnDate: r.last_txn_date ?? null,
        meses: mesesPorProyecto.get(r.qb_job_id) ?? [],
      };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  // "Hay números" = algún income/cost guardado (no el margen: marginOf da null
  // con income 0, y un año legítimamente en cero mostraba el banner de error).
  const financialsOk = projects.some((p) => p.income !== null || p.cost !== null);
  return { ok: true, projects, financialsOk, year, syncedAt, mesesDesde };
}

// Movimiento mensual de TODOS los proyectos de la org (0045). Vive en su propia
// tabla porque son ~24 filas por proyecto; se lee entero y se indexa en memoria.
// Si la migración no corrió todavía, devuelve vacío y el board prorratea como antes.
async function loadMeses(
  supabase: DB,
  orgId: string,
): Promise<{ porProyecto: Map<string, MonthPnl[]>; desde: string | null }> {
  const porProyecto = new Map<string, MonthPnl[]>();
  let desde: string | null = null;
  type MRow = { qb_job_id: string; month: string; income: number | string; cost: number | string };
  for (let from = 0; from < 200_000; from += 1000) {
    const r = (await supabase
      .from("qbo_project_month")
      .select("qb_job_id, month, income, cost")
      .eq("org_id", orgId)
      .order("qb_job_id")
      .order("month")
      .range(from, from + 999)) as unknown as { data: MRow[] | null; error: { message: string; code?: string } | null };
    if (r.error) return { porProyecto: new Map(), desde: null }; // tabla ausente o RLS: se prorratea
    for (const m of r.data ?? []) {
      const mes = { month: String(m.month).slice(0, 10), income: Number(m.income), cost: Number(m.cost) };
      const l = porProyecto.get(m.qb_job_id);
      if (l) l.push(mes);
      else porProyecto.set(m.qb_job_id, [mes]);
      if (!desde || mes.month < desde) desde = mes.month;
    }
    if ((r.data?.length ?? 0) < 1000) break;
  }
  return { porProyecto, desde };
}

// ── "Actualizar": pull de QBO (lista + P&L de los abiertos) + persistir. ──────
async function refresh(supabase: DB, orgId: string, year: number): Promise<QboProjectsResult> {
  const list = await fetchQboProjectsList({ year });

  // Estado guardado (cerrado + status + avance manual + financials previos).
  // PAGINADO: PostgREST corta en 1000 filas — pasado ese punto, cerrados fuera
  // de la ventana se tratarían como abiertos y sus números congelados se
  // pisarían con data fresca de QBO.
  type StRow = {
    qb_job_id: string;
    closed: boolean;
    income: number | null;
    cost: number | null;
    progress?: number | null;
    status?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    contract_total?: number | null;
    quote_number?: string | null;
    first_txn_date?: string | null;
    last_txn_date?: string | null;
  };
  type StRes = { data: StRow[] | null; error: ({ message: string; code?: string }) | null };
  const readState = async (cols: string): Promise<StRes> => {
    const all: StRow[] = [];
    for (let from = 0; from < 30_000; from += 1000) {
      const r = (await supabase
        .from("qbo_project_state")
        .select(cols)
        .eq("org_id", orgId)
        .order("qb_job_id")
        .range(from, from + 999)) as unknown as StRes;
      if (r.error) return r;
      all.push(...(r.data ?? []));
      if ((r.data?.length ?? 0) < 1000) break;
    }
    return { data: all, error: null };
  };
  const ST_0037 = "qb_job_id, closed, income, cost, progress, status, start_date, end_date, contract_total, quote_number";
  let st = await readState(`${ST_0037}, first_txn_date, last_txn_date`);
  if (isMissingColumn(st.error)) st = await readState(ST_0037); // 0045 pendiente
  if (isMissingColumn(st.error)) st = await readState("qb_job_id, closed, income, cost, progress, status, start_date, end_date, contract_total");
  if (isMissingColumn(st.error)) st = await readState("qb_job_id, closed, income, cost, progress, status");
  if (isMissingColumn(st.error)) st = await readState("qb_job_id, closed, income, cost, progress");
  if (isMissingColumn(st.error)) st = await readState("qb_job_id, closed, income, cost");
  // Si el estado no se pudo leer por un error real, abortar antes de pisar los
  // números congelados de los cerrados con data fresca de QBO.
  if (st.error) return { ok: false, error: st.error.message };
  const state = new Map((st.data ?? []).map((r) => [r.qb_job_id, r]));
  for (const p of list) {
    const s = state.get(p.id);
    if (s) {
      p.closed = s.closed;
      p.status = (s.status ?? (s.closed ? "cerrado" : "activo")) as ProjectBizStatus;
      p.progress = s.progress ?? null;
      p.income = s.income === null ? null : Number(s.income);
      p.cost = s.cost === null ? null : Number(s.cost);
      p.margin = marginOf(p.income, p.cost);
      p.quoteNumber = s.quote_number ?? null; // el cruce vive solo en la base
      p.startDate = s.start_date ?? null;
      p.endDate = s.end_date ?? null;
      p.contractTotal = s.contract_total === null || s.contract_total === undefined ? null : Number(s.contract_total);
      // Ventana de actividad conocida. Los cerrados no vuelven a consultarse a
      // QBO, así que para ellos ESTE es el único valor que van a tener.
      p.firstTxnDate = s.first_txn_date ?? null;
      p.lastTxnDate = s.last_txn_date ?? null;
    }
  }

  // Financials SOLO de los abiertos.
  let financialsOk = false;
  let mesesDesde: string | null = null;
  try {
    const { fin, errored, desde } = await fetchProjectFinancials(
      list.filter((p) => !p.closed).map((p) => ({ id: p.id, parentId: p.parentId, siblings: p.siblings })),
    );
    if (fin.size > 0) {
      financialsOk = true;
      mesesDesde = desde;
      for (const p of list) {
        if (p.closed) continue; // cerrados: números congelados, no se tocan
        const f = fin.get(p.id);
        if (f) {
          p.income = f.income;
          p.cost = f.cost;
          p.margin = marginOf(f.income, f.cost);
          p.meses = f.meses;
          // Ventana real de actividad. Solo se pisa si QBO reportó movimiento:
          // un proyecto recién abierto conserva lo que ya se sabía de él.
          const v = ventanaDeMeses(f.meses);
          if (v) {
            p.firstTxnDate = v.first;
            p.lastTxnDate = v.last;
          }
        } else if (errored.has(p.id)) {
          // Fallo TRANSITORIO (red/gateway para este proyecto): conservar los
          // números previos que ya vienen del state merge — nullearlos por un
          // hipo destruía el último valor bueno hasta el próximo refresh.
        } else {
          // Abierto pero no se pudo aislar su P&L (el gateway devolvió un rollup
          // del padre/empresa que descartamos) → sin datos, en vez de conservar
          // un valor viejo contaminado.
          p.income = null;
          p.cost = null;
          p.margin = null;
        }
      }
    }
  } catch {
    /* sin financials: la lista igual se guarda */
  }

  // Persistir TODO (lista + financials). `closed` no va en el payload → se
  // preserva en updates y arranca en false para los nuevos.
  const nowIso = new Date().toISOString();
  const rows = list.map((p) => ({
    org_id: orgId,
    qb_job_id: p.id,
    name: p.name,
    full_name: p.fullName,
    rubro: p.rubro,
    year: p.year,
    client_name: p.clientName,
    income: p.income,
    cost: p.cost,
    synced_at: nowIso,
  }));
  const fechas = list.map((p, i) => ({ ...rows[i], qbo_created_at: p.qboCreatedAt, first_txn_date: p.firstTxnDate, last_txn_date: p.lastTxnDate }));
  if (rows.length) {
    // Con las fechas de 0045 si la migración corrió; sin ellas si no (el resto
    // de la sincronización no se pierde por una columna que todavía no existe).
    let { error: upErr } = await supabase.from("qbo_project_state").upsert(fechas, { onConflict: "org_id,qb_job_id" });
    if (isMissingColumn(upErr)) {
      ({ error: upErr } = await supabase.from("qbo_project_state").upsert(rows, { onConflict: "org_id,qb_job_id" }));
    }
    if (upErr) return { ok: false, error: upErr.message };
    await guardarMeses(supabase, orgId, list, nowIso);

    // Reconciliar: borrar filas del año que ya NO vinieron de QBO (proyecto
    // borrado/renombrado) para que no queden huérfanas inflando conteos.
    // Solo si el pull trajo lista (guarda contra un fetch vacío por error) y
    // NUNCA borra filas con trabajo manual (avance, status ≠ activo, o cerrado)
    // para que un hipo del listado de QBO no borre el avance del equipo.
    const ids = rows.map((r) => r.qb_job_id);
    const runReconcile = (withStatus: boolean) => {
      let q = supabase
        .from("qbo_project_state")
        .delete()
        .eq("org_id", orgId)
        .eq("year", year)
        .is("progress", null)
        .eq("closed", false)
        .not("qb_job_id", "in", `(${ids.map((i) => `"${i}"`).join(",")})`);
      if (withStatus) q = q.eq("status", "activo");
      return q;
    };
    const { error: recErr } = await runReconcile(true);
    // Pre-0016 (sin columna status) el filtro daba 400 y la reconciliación se
    // saltaba en silencio → reintentar sin status (los demás guards protegen).
    if (isMissingColumn(recErr)) await runReconcile(false);
  }

  return {
    ok: true,
    projects: list.sort((a, b) => a.fullName.localeCompare(b.fullName)),
    financialsOk,
    year,
    syncedAt: Date.now(),
    mesesDesde,
  };
}

// Guarda el desglose mensual de los proyectos que lo trajeron. Best-effort: si
// la tabla 0045 no existe todavía, el resto de la sincronización ya se guardó.
//
// Los meses SIN movimiento se borran en vez de guardarse en cero — así una
// factura anulada o movida de mes desaparece del board en lugar de quedar
// pegada como un mes fantasma del refresh anterior.
async function guardarMeses(supabase: DB, orgId: string, list: QboProject[], nowIso: string): Promise<void> {
  const conMeses = list.filter((p) => p.meses.length > 0);
  if (conMeses.length === 0) return;
  const filas = conMeses.flatMap((p) =>
    p.meses
      .filter((m) => m.income !== 0 || m.cost !== 0)
      .map((m) => ({ org_id: orgId, qb_job_id: p.id, month: m.month, income: m.income, cost: m.cost, synced_at: nowIso })),
  );
  const ids = conMeses.map((p) => p.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabase
      .from("qbo_project_month")
      .delete()
      .eq("org_id", orgId)
      .in("qb_job_id", ids.slice(i, i + 200));
    if (error) return; // tabla ausente: el board prorratea como antes
  }
  for (let i = 0; i < filas.length; i += 1000) {
    const { error } = await supabase
      .from("qbo_project_month")
      .upsert(filas.slice(i, i + 1000), { onConflict: "org_id,qb_job_id,month" });
    if (error) return;
  }
}

export async function getQboProjects(opts?: { force?: boolean; allYears?: boolean }): Promise<QboProjectsResult> {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { ok: false, error: "Sesión expirada" };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false, error: "Sin organización" };
  // Año en hora de PANAMÁ: con getFullYear() en UTC, el 31/dic a las 7pm el
  // board ya saltaba al año siguiente (vacío).
  const year = Number(new Date().toLocaleDateString("en-CA", { timeZone: "America/Panama" }).slice(0, 4));

  if (!opts?.force) return loadFromDb(supabase, orgId, year, opts?.allYears); // abrir la página = base, sin QBO

  if (!hasQboConfig()) return { ok: false, error: "QBO_MCP_URL no está configurada (seteala en Vercel)." };
  const inf = inflight.get(orgId);
  if (inf) return inf;
  const p: Promise<QboProjectsResult> = (async () => {
    try {
      const r = await refresh(supabase, orgId, year);
      // El refresh trae el año actual de QBO; con allYears el board también
      // muestra contratos arrastrados de años previos → releer TODO de la base
      // (ya actualizada) para no perderlos tras "Actualizar".
      if (r.ok && opts?.allYears) return loadFromDb(supabase, orgId, year, true);
      return r;
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Error trayendo proyectos de QBO" };
    } finally {
      inflight.delete(orgId);
    }
  })();
  inflight.set(orgId, p);
  return p;
}

// Cambiar el status de negocio. 'cerrado' congela los números (no se re-consulta
// a QBO); 'activo'/'por_cobrar' siguen refrescando. `closed` se mantiene en sync.
export async function setProjectStatus(
  qbJobId: string,
  status: ProjectBizStatus,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { ok: false, error: "Sesión expirada" };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false, error: "Sin organización" };
  const closed = status === "cerrado";
  let { error } = await supabase
    .from("qbo_project_state")
    .upsert({ org_id: orgId, qb_job_id: qbJobId, status, closed }, { onConflict: "org_id,qb_job_id" });
  // Fallback si la migración 0016 (status) aún no corrió: al menos preservar closed.
  if (isMissingColumn(error)) {
    ({ error } = await supabase
      .from("qbo_project_state")
      .upsert({ org_id: orgId, qb_job_id: qbJobId, closed }, { onConflict: "org_id,qb_job_id" }));
    if (error) return { ok: false, error: error.message };
    return { ok: false, error: "Falta la migración 0016 (status) — corre el SQL para guardar el estado completo." };
  }
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Avance manual (0-100). Lo pone el equipo; no viene de QBO.
export async function setProjectProgress(qbJobId: string, progress: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { ok: false, error: "Sesión expirada" };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false, error: "Sin organización" };
  const p = Math.max(0, Math.min(100, Math.round(progress)));
  const { error } = (await supabase
    .from("qbo_project_state")
    .upsert({ org_id: orgId, qb_job_id: qbJobId, progress: p }, { onConflict: "org_id,qb_job_id" })) as {
    error: { message: string; code?: string } | null;
  };
  // Distinguir migración pendiente de un error real (antes TODO fallo decía
  // "falta la migración 0012" aunque fuera RLS o red).
  if (isMissingColumn(error)) return { ok: false, error: "Falta la migración 0012 (progress) — corre el SQL y reintenta" };
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Fechas del contrato + monto total (para el prorrateo multi-año). Manuales o
// sembradas al enviar la cotización a QBO; no vienen de QuickBooks.
export async function setProjectDates(
  qbJobId: string,
  input: { startDate: string | null; endDate: string | null; contractTotal: number | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { ok: false, error: "Sesión expirada" };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false, error: "Sin organización" };
  if (input.startDate && input.endDate && input.endDate < input.startDate) {
    return { ok: false, error: "La fecha de fin no puede ser antes del inicio." };
  }
  const total =
    input.contractTotal === null || !Number.isFinite(input.contractTotal)
      ? null
      : Math.round(Math.max(0, input.contractTotal) * 100) / 100;
  const { error } = (await supabase
    .from("qbo_project_state")
    .upsert(
      { org_id: orgId, qb_job_id: qbJobId, start_date: input.startDate, end_date: input.endDate, contract_total: total },
      { onConflict: "org_id,qb_job_id" },
    )) as { error: { message: string; code?: string } | null };
  if (isMissingColumn(error)) return { ok: false, error: "Faltan las migraciones 0022/0023 — corre el SQL y reintenta" };
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ── ¿Por qué este proyecto no trae números? ──────────────────────────────────
// Corre las mismas llamadas que el refresh para UN proyecto y devuelve lo que
// contestó QBO en cada paso. Sin esto, "sin datos de QBO" puede venir de cuatro
// causas distintas que desde afuera se ven igual.
export async function diagnosticarProyecto(
  qbJobId: string,
  cerrado: boolean,
): Promise<{ ok: true; data: PnlDiagnostico } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { ok: false, error: "Sesión expirada" };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false, error: "Sin organización" };
  if (!hasQboConfig()) return { ok: false, error: "QBO_MCP_URL no está configurada" };
  try {
    const r = await diagnosticarPnl(qbJobId, cerrado);
    if ("error" in r) return { ok: false, error: r.error };
    return { ok: true, data: r };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo diagnosticar" };
  }
}

// Número de cotización que originó el proyecto. Se llena solo al enviar desde
// Cotizaciones; editable a mano para lo creado directo en QBO. Vacío = borrar.
export async function setProjectQuoteNo(
  qbJobId: string,
  numero: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { ok: false, error: "Sesión expirada" };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false, error: "Sin organización" };
  const v = numero?.trim() ? numero.trim().toUpperCase() : null;
  const { error } = (await supabase
    .from("qbo_project_state")
    .upsert({ org_id: orgId, qb_job_id: qbJobId, quote_number: v }, { onConflict: "org_id,qb_job_id" })) as {
    error: { message: string; code?: string } | null;
  };
  if (isMissingColumn(error)) return { ok: false, error: "Falta la migración 0037 — corre el SQL en Supabase y reintenta." };
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
