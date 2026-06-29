"use server";

import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { hasQboConfig } from "@/lib/quickbooks/mcp";
import { fetchQboProjectsList, fetchProjectFinancials, marginOf, type QboProject } from "@/lib/quickbooks/projects";

export type QboProjectsResult =
  | { ok: true; projects: QboProject[]; financialsOk: boolean; year: number; cachedAt: number }
  | { ok: false; error: string };

type DB = Awaited<ReturnType<typeof createClient>>;

// Cache + dedupe por org (TTL 15 min): refrescar la página NO re-consulta QBO.
const TTL = 15 * 60 * 1000;
const cache = new Map<string, { at: number; result: QboProjectsResult }>();
const inflight = new Map<string, Promise<QboProjectsResult>>();

type StateRow = { closed: boolean; income: number | null; cost: number | null };

async function loadState(supabase: DB, orgId: string): Promise<Map<string, StateRow>> {
  const out = new Map<string, StateRow>();
  const { data } = (await supabase
    .from("qbo_project_state")
    .select("qb_job_id, closed, income, cost")
    .eq("org_id", orgId)) as { data: { qb_job_id: string; closed: boolean; income: number | null; cost: number | null }[] | null };
  for (const r of data ?? [])
    out.set(r.qb_job_id, { closed: r.closed, income: r.income === null ? null : Number(r.income), cost: r.cost === null ? null : Number(r.cost) });
  return out;
}

async function build(supabase: DB, orgId: string, year: number): Promise<QboProjectsResult> {
  const projects = await fetchQboProjectsList({ year });
  const state = await loadState(supabase, orgId).catch(() => new Map<string, StateRow>());

  // Sembrar cerrado + financials cacheados de la BD.
  for (const p of projects) {
    const s = state.get(p.id);
    if (s) {
      p.closed = s.closed;
      p.income = s.income;
      p.cost = s.cost;
      p.margin = marginOf(s.income, s.cost);
    }
  }

  // Financials SOLO de los abiertos (los cerrados ya tienen lo guardado).
  const openIds = projects.filter((p) => !p.closed).map((p) => p.id);
  let financialsOk = false;
  try {
    const fin = await fetchProjectFinancials(openIds);
    if (fin.size > 0) {
      financialsOk = true;
      const rows: Record<string, unknown>[] = [];
      for (const p of projects) {
        const f = fin.get(p.id);
        if (f) {
          p.income = f.income;
          p.cost = f.cost;
          p.margin = marginOf(f.income, f.cost);
          rows.push({ org_id: orgId, qb_job_id: p.id, income: f.income, cost: f.cost, synced_at: new Date().toISOString() });
        }
      }
      if (rows.length) await supabase.from("qbo_project_state").upsert(rows, { onConflict: "org_id,qb_job_id" });
    }
  } catch {
    /* sin financials: la lista igual se muestra */
  }

  return { ok: true, projects, financialsOk, year, cachedAt: Date.now() };
}

export async function getQboProjects(opts?: { force?: boolean }): Promise<QboProjectsResult> {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { ok: false, error: "Sesión expirada" };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false, error: "Sin organización" };
  if (!hasQboConfig()) return { ok: false, error: "QBO_MCP_URL no está configurada (seteala en Vercel)." };

  if (!opts?.force) {
    const c = cache.get(orgId);
    if (c && Date.now() - c.at < TTL) return c.result;
    const inf = inflight.get(orgId);
    if (inf) return inf;
  }

  const year = new Date().getFullYear();
  const p: Promise<QboProjectsResult> = (async () => {
    try {
      const result = await build(supabase, orgId, year);
      cache.set(orgId, { at: Date.now(), result });
      return result;
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
  cache.delete(orgId); // el próximo load refleja el cambio (y consulta menos)
  return { ok: true };
}
