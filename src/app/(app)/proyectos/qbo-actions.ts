"use server";

import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { hasQboConfig } from "@/lib/quickbooks/mcp";
import { fetchQboProjectsList, fetchProjectFinancials, marginOf, type QboProject, type ProjectBizStatus } from "@/lib/quickbooks/projects";

export type QboProjectsResult =
  | { ok: true; projects: QboProject[]; financialsOk: boolean; year: number; syncedAt: number | null }
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
async function loadFromDb(supabase: DB, orgId: string, year: number): Promise<QboProjectsResult> {
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
  };
  const run = (cols: string) =>
    supabase.from("qbo_project_state").select(cols).eq("org_id", orgId).eq("year", year);
  let res = (await run("qb_job_id, name, full_name, rubro, year, client_name, closed, income, cost, synced_at, progress, status")) as {
    data: Row[] | null;
    error: ({ message: string; code?: string }) | null;
  };
  if (isMissingColumn(res.error)) {
    // migración 0016 pendiente: sin columna status
    res = (await run("qb_job_id, name, full_name, rubro, year, client_name, closed, income, cost, synced_at, progress")) as {
      data: Row[] | null;
      error: ({ message: string; code?: string }) | null;
    };
  }
  if (isMissingColumn(res.error)) {
    // migración 0012 pendiente: sin columna progress
    res = (await run("qb_job_id, name, full_name, rubro, year, client_name, closed, income, cost, synced_at")) as {
      data: Row[] | null;
      error: ({ message: string; code?: string }) | null;
    };
  }
  // Un error real (RLS/conexión) NO se traga como "no hay proyectos".
  if (res.error) return { ok: false, error: res.error.message };
  const rows = res.data ?? [];
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
      };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  // "Hay números" = algún income/cost guardado (no el margen: marginOf da null
  // con income 0, y un año legítimamente en cero mostraba el banner de error).
  const financialsOk = projects.some((p) => p.income !== null || p.cost !== null);
  return { ok: true, projects, financialsOk, year, syncedAt };
}

// ── "Actualizar": pull de QBO (lista + P&L de los abiertos) + persistir. ──────
async function refresh(supabase: DB, orgId: string, year: number): Promise<QboProjectsResult> {
  const list = await fetchQboProjectsList({ year });

  // Estado guardado (cerrado + status + avance manual + financials previos).
  // PAGINADO: PostgREST corta en 1000 filas — pasado ese punto, cerrados fuera
  // de la ventana se tratarían como abiertos y sus números congelados se
  // pisarían con data fresca de QBO.
  type StRow = { qb_job_id: string; closed: boolean; income: number | null; cost: number | null; progress?: number | null; status?: string | null };
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
  let st = await readState("qb_job_id, closed, income, cost, progress, status");
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
    }
  }

  // Financials SOLO de los abiertos.
  let financialsOk = false;
  try {
    const { fin, errored } = await fetchProjectFinancials(
      list.filter((p) => !p.closed).map((p) => ({ id: p.id, parentId: p.parentId, siblings: p.siblings })),
    );
    if (fin.size > 0) {
      financialsOk = true;
      for (const p of list) {
        if (p.closed) continue; // cerrados: números congelados, no se tocan
        const f = fin.get(p.id);
        if (f) {
          p.income = f.income;
          p.cost = f.cost;
          p.margin = marginOf(f.income, f.cost);
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
  if (rows.length) {
    const { error: upErr } = await supabase.from("qbo_project_state").upsert(rows, { onConflict: "org_id,qb_job_id" });
    if (upErr) return { ok: false, error: upErr.message };

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

  return { ok: true, projects: list.sort((a, b) => a.fullName.localeCompare(b.fullName)), financialsOk, year, syncedAt: Date.now() };
}

export async function getQboProjects(opts?: { force?: boolean }): Promise<QboProjectsResult> {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { ok: false, error: "Sesión expirada" };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false, error: "Sin organización" };
  // Año en hora de PANAMÁ: con getFullYear() en UTC, el 31/dic a las 7pm el
  // board ya saltaba al año siguiente (vacío).
  const year = Number(new Date().toLocaleDateString("en-CA", { timeZone: "America/Panama" }).slice(0, 4));

  if (!opts?.force) return loadFromDb(supabase, orgId, year); // abrir la página = base, sin QBO

  if (!hasQboConfig()) return { ok: false, error: "QBO_MCP_URL no está configurada (seteala en Vercel)." };
  const inf = inflight.get(orgId);
  if (inf) return inf;
  const p: Promise<QboProjectsResult> = (async () => {
    try {
      return await refresh(supabase, orgId, year);
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
