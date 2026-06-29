"use server";

import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { hasQboConfig } from "@/lib/quickbooks/mcp";
import { fetchQboProjects, type QboProject } from "@/lib/quickbooks/projects";

export type QboProjectsResult =
  | { ok: true; projects: QboProject[]; financialsOk: boolean; year: number; cachedAt: number }
  | { ok: false; error: string };

// Cache + dedupe server-side: refrescar la página NO vuelve a pegarle a QBO.
// Solo el botón "Actualizar" (force) re-consulta. Evita saturar el VM.
const TTL = 15 * 60 * 1000; // 15 min
const cache = new Map<string, { at: number; result: QboProjectsResult }>();
const inflight = new Map<string, Promise<QboProjectsResult>>();

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
    if (inf) return inf; // ya hay una consulta en curso: reusala (dedupe)
  }

  const year = new Date().getFullYear();
  const p: Promise<QboProjectsResult> = (async () => {
    try {
      const { projects, financialsOk } = await fetchQboProjects({ year });
      const result: QboProjectsResult = { ok: true, projects, financialsOk, year, cachedAt: Date.now() };
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
