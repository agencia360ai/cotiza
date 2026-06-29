"use server";

import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { hasQboConfig } from "@/lib/quickbooks/mcp";
import { fetchQboProjectsList, fetchProjectFinancials, marginOf, type QboProject } from "@/lib/quickbooks/projects";

export type QboProjectsResult =
  | { ok: true; projects: QboProject[]; financialsOk: boolean; year: number; syncedAt: number | null }
  | { ok: false; error: string };

type DB = Awaited<ReturnType<typeof createClient>>;

// Dedupe de "Actualizar" concurrentes (un solo pull a QBO a la vez por org).
const inflight = new Map<string, Promise<QboProjectsResult>>();

// ── Abrir la página: leer SOLO de la base. Cero llamadas a QBO. ───────────────
async function loadFromDb(supabase: DB, orgId: string, year: number): Promise<QboProjectsResult> {
  const { data } = (await supabase
    .from("qbo_project_state")
    .select("qb_job_id, name, full_name, rubro, year, client_name, closed, income, cost, synced_at")
    .eq("org_id", orgId)
    .eq("year", year)) as {
    data:
      | {
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
        }[]
      | null;
  };
  const rows = data ?? [];
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
        rubro: r.rubro,
        year: r.year,
        clientName: r.client_name ?? "",
        income,
        cost,
        margin: marginOf(income, cost),
        closed: r.closed,
      };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  return { ok: true, projects, financialsOk: projects.some((p) => p.margin !== null), year, syncedAt };
}

// ── "Actualizar": pull de QBO (lista + P&L de los abiertos) + persistir. ──────
async function refresh(supabase: DB, orgId: string, year: number): Promise<QboProjectsResult> {
  const list = await fetchQboProjectsList({ year });

  // Estado guardado (cerrado + financials previos).
  const { data: stRows } = (await supabase
    .from("qbo_project_state")
    .select("qb_job_id, closed, income, cost")
    .eq("org_id", orgId)) as { data: { qb_job_id: string; closed: boolean; income: number | null; cost: number | null }[] | null };
  const state = new Map((stRows ?? []).map((r) => [r.qb_job_id, r]));
  for (const p of list) {
    const s = state.get(p.id);
    if (s) {
      p.closed = s.closed;
      p.income = s.income === null ? null : Number(s.income);
      p.cost = s.cost === null ? null : Number(s.cost);
      p.margin = marginOf(p.income, p.cost);
    }
  }

  // Financials SOLO de los abiertos.
  let financialsOk = false;
  try {
    const fin = await fetchProjectFinancials(list.filter((p) => !p.closed).map((p) => p.id));
    if (fin.size > 0) {
      financialsOk = true;
      for (const p of list) {
        const f = fin.get(p.id);
        if (f) {
          p.income = f.income;
          p.cost = f.cost;
          p.margin = marginOf(f.income, f.cost);
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
  if (rows.length) await supabase.from("qbo_project_state").upsert(rows, { onConflict: "org_id,qb_job_id" });

  return { ok: true, projects: list.sort((a, b) => a.fullName.localeCompare(b.fullName)), financialsOk, year, syncedAt: Date.now() };
}

export async function getQboProjects(opts?: { force?: boolean }): Promise<QboProjectsResult> {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { ok: false, error: "Sesión expirada" };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false, error: "Sin organización" };
  const year = new Date().getFullYear();

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

// Marcar un proyecto cerrado/abierto. Cerrado = no se re-consulta a QBO.
export async function setProjectClosed(qbJobId: string, closed: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { ok: false, error: "Sesión expirada" };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false, error: "Sin organización" };
  const { error } = await supabase
    .from("qbo_project_state")
    .upsert({ org_id: orgId, qb_job_id: qbJobId, closed }, { onConflict: "org_id,qb_job_id" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
