import "server-only";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export const ACTIVE_ORG_COOKIE = "cotiza_active_org";

export type OrgMembership = { org_id: string; role: string };

/**
 * Returns all org_ids the current user belongs to (along with role).
 * Empty array if not logged in.
 */
export async function listMemberships(): Promise<OrgMembership[]> {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return [];
  const { data } = (await supabase
    .from("org_members")
    .select("org_id, role")
    .eq("user_id", u.user.id)) as { data: OrgMembership[] | null };
  return data ?? [];
}

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
export async function getActiveOrgContext(): Promise<{
  user: { id: string; email: string | null };
  orgId: string;
  role: string;
} | null> {
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
  };
}
