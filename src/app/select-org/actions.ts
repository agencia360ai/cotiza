"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACTIVE_ORG_COOKIE, listMemberships } from "@/lib/org-context";

export async function setActiveOrg(orgId: string): Promise<{ error: string } | void> {
  const memberships = await listMemberships();
  if (!memberships.some((m) => m.org_id === orgId)) {
    return { error: "No sos miembro de esa organización" };
  }
  const store = await cookies();
  store.set(ACTIVE_ORG_COOKIE, orgId, {
    path: "/",
    httpOnly: false,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/maintenance");
}
