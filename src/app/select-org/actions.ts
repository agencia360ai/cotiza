"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
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
  redirect("/inicio");
}

export async function createOrg(input: {
  name: string;
  focus: "maintenance" | "projects" | "mixed";
}): Promise<{ error: string } | void> {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { error: "Sesión expirada" };
  const name = input.name.trim();
  if (!name) return { error: "Falta el nombre" };

  const slug = `${name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").slice(0, 30)}-${randomBytes(3).toString("hex")}`;

  const { data: org, error } = (await supabase
    .from("organizations")
    .insert({ name, slug, focus: input.focus, created_by: u.user.id })
    .select("id")
    .single()) as { data: { id: string } | null; error: { message: string } | null };
  if (error || !org) return { error: error?.message ?? "No se pudo crear" };

  await supabase.from("org_members").insert({ org_id: org.id, user_id: u.user.id, role: "owner" });

  const store = await cookies();
  store.set(ACTIVE_ORG_COOKIE, org.id, {
    path: "/",
    httpOnly: false,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/inicio");
}
