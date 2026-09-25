import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { normalizarSecciones, type Seccion } from "@/lib/secciones";

export const ACTIVE_ORG_COOKIE = "cotiza_active_org";

/** secciones: null = ve todas (ver src/lib/secciones.ts). */
export type OrgMembership = { org_id: string; role: string; secciones: Seccion[] | null };

type FilaMembresia = { org_id: string; role: string; secciones?: unknown };

/**
 * Returns all org_ids the current user belongs to (along with role).
 * Empty array if not logged in.
 *
 * cache(): el layout, el guardia de la sección y la página la piden en el mismo
 * request — con una consulta alcanza.
 */
export const listMemberships = cache(async (): Promise<OrgMembership[]> => {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return [];
  const userId = u.user.id;
  const leer = (cols: string) =>
    supabase.from("org_members").select(cols).eq("user_id", userId) as unknown as Promise<{
      data: FilaMembresia[] | null;
      error: { message?: string } | null;
    }>;
  let res = await leer("org_id, role, secciones");
  // Sin la 0050 la columna no existe y PostgREST rechaza la consulta entera:
  // sin este reintento, todos quedarían "sin organización" hasta correrla.
  if (res.error && /secciones/.test(res.error.message ?? "")) res = await leer("org_id, role");
  return (res.data ?? []).map((m) => ({
    org_id: m.org_id,
    role: m.role,
    secciones: normalizarSecciones(m.secciones),
  }));
});

/**
 * Returns the currently active org_id for the user:
 * - First, read the cookie. If valid (user is a member of that org), use it.
 * - Otherwise, fall back to the first membership and update the cookie.
 * Returns null if the user has no memberships.
 */
export async function getActiveOrgId(): Promise<string | null> {
  const memberships = await listMemberships();
  if (memberships.length === 0) return null;

  const store = await cookies();
  const cookieOrgId = store.get(ACTIVE_ORG_COOKIE)?.value;
  if (cookieOrgId && memberships.some((m) => m.org_id === cookieOrgId)) {
    return cookieOrgId;
  }
  // Fallback to first membership; we don't try to set the cookie here since
  // this function may be called from a Server Component where cookies are
  // read-only. The /select-org and /login flows set it explicitly.
  return memberships[0].org_id;
}

/**
 * Returns the active org_id + role for the user, plus the authenticated user.
 * Throws (via redirect intended) the caller should handle null user.
 */
export const getActiveOrgContext = cache(async (): Promise<{
  user: { id: string; email: string | null };
  orgId: string;
  role: string;
  secciones: Seccion[] | null;
} | null> => {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return null;

  const memberships = await listMemberships();
  if (memberships.length === 0) return null;

  const store = await cookies();
  const cookieOrgId = store.get(ACTIVE_ORG_COOKIE)?.value;
  const active = memberships.find((m) => m.org_id === cookieOrgId) ?? memberships[0];

  return {
    user: { id: u.user.id, email: u.user.email ?? null },
    orgId: active.org_id,
    role: active.role,
    secciones: active.secciones,
  };
});
