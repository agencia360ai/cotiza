"use server";

import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { hasQboConfig } from "@/lib/quickbooks/mcp";
import { fetchQboProjects, type QboProject } from "@/lib/quickbooks/projects";

export type QboProjectsResult =
  | { ok: true; projects: QboProject[]; financialsOk: boolean; year: number }
  | { ok: false; error: string };

export async function getQboProjects(): Promise<QboProjectsResult> {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { ok: false, error: "Sesión expirada" };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false, error: "Sin organización" };
  if (!hasQboConfig()) return { ok: false, error: "QBO_MCP_URL no está configurada (seteala en Vercel)." };
  const year = new Date().getFullYear();
  try {
    const { projects, financialsOk } = await fetchQboProjects({ year });
    return { ok: true, projects, financialsOk, year };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error trayendo proyectos de QBO" };
  }
}
