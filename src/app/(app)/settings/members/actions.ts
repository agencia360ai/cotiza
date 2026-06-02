"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveOrgContext } from "@/lib/org-context";

type Result = { error: string } | { ok: true };
type Role = "owner" | "admin" | "engineer" | "viewer";

type OrgCtx = NonNullable<Awaited<ReturnType<typeof getActiveOrgContext>>>;
type RequireAdmin = { kind: "err"; error: string } | { kind: "ok"; ctx: OrgCtx };

async function requireAdmin(): Promise<RequireAdmin> {
  const ctx = await getActiveOrgContext();
  if (!ctx) return { kind: "err", error: "Sin sesión" };
  if (ctx.role !== "owner" && ctx.role !== "admin") {
    return { kind: "err", error: "Solo owner/admin pueden gestionar miembros" };
  }
  return { kind: "ok", ctx };
}

export async function inviteMember(input: {
  email: string;
  password: string;
  role: Role;
}): Promise<Result> {
  const auth = await requireAdmin();
  if (auth.kind === "err") return { error: auth.error };
  const ctx = auth.ctx;

  const email = input.email.trim().toLowerCase();
  if (!email.includes("@")) return { error: "Email inválido" };
  if (input.password.length < 8) return { error: "Password mínimo 8 caracteres" };

  const admin = createAdminClient();
  const supabase = await createClient();

  // 1) ¿El usuario ya existe en auth?
  type ListUsersData = { users: { id: string; email?: string | null }[] };
  type AdminAuth = {
    admin: {
      listUsers: (p: { perPage?: number; page?: number }) => Promise<{
        data: ListUsersData | null;
        error: { message: string } | null;
      }>;
      createUser: (p: { email: string; password: string; email_confirm: boolean }) => Promise<{
        data: { user: { id: string } | null } | null;
        error: { message: string } | null;
      }>;
      deleteUser: (id: string) => Promise<{ error: { message: string } | null }>;
    };
  };
  const adminAuth = (admin.auth as unknown) as AdminAuth;

  let userId: string | null = null;
  let page = 1;
  while (true) {
    const { data, error } = await adminAuth.admin.listUsers({ perPage: 1000, page });
    if (error) return { error: error.message };
    const found = data?.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (found) {
      userId = found.id;
      break;
    }
    if (!data || data.users.length < 1000) break;
    page += 1;
  }

  // 2) Crearlo si no existía
  if (!userId) {
    const { data, error } = await adminAuth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
    });
    if (error || !data?.user) return { error: error?.message ?? "No se pudo crear el usuario" };
    userId = data.user.id;
  } else {
    // Existía — actualizar password para el contexto actual
    // (Si el usuario ya tenía cuenta en otra org y le estamos dando una nueva password,
    // sobreescribimos. Ajustable en el futuro.)
    type UpdateUser = (id: string, p: { password: string }) => Promise<{ error: { message: string } | null }>;
    const updateUser = (adminAuth.admin as unknown as { updateUserById: UpdateUser }).updateUserById;
    if (updateUser) await updateUser(userId, { password: input.password });
  }

  void supabase;
  // 3) ¿Ya es miembro de esta org?
  const { data: existing } = await membersTable()
    .select("id")
    .eq("org_id", ctx.orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing?.id) {
    return { error: "Ese usuario ya es miembro de la organización" };
  }

  // 4) Crear membership con admin client (bypass RLS)
  const { error: memErr } = await (admin.from("org_members") as unknown as {
    insert: (row: { org_id: string; user_id: string; role: Role }) => Promise<{ error: { message: string } | null }>;
  }).insert({ org_id: ctx.orgId, user_id: userId, role: input.role });
  if (memErr) return { error: memErr.message };

  revalidatePath("/settings/members");
  return { ok: true };
}

// Typed wrappers around the admin client for org_members CRUD.
type OrgMembersRow = { id: string; org_id: string; user_id: string; role: Role; created_at: string };
function membersTable() {
  const admin = createAdminClient();
  // The supabase-js client has no generated types here; cast to a minimal shape.
  return admin.from("org_members") as unknown as {
    select: (cols: string, opts?: { count?: "exact"; head?: boolean }) => {
      eq: (c: string, v: string) => {
        eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: Partial<OrgMembersRow> | null }> };
        maybeSingle: () => Promise<{ data: Partial<OrgMembersRow> | null }>;
        single: () => Promise<{ data: Partial<OrgMembersRow> | null }>;
        // for count head queries
        then?: never;
      };
    };
    update: (patch: Partial<OrgMembersRow>) => {
      eq: (c: string, v: string) => {
        eq: (c: string, v: string) => Promise<{ error: { message: string } | null }>;
      };
    };
    delete: () => {
      eq: (c: string, v: string) => {
        eq: (c: string, v: string) => Promise<{ error: { message: string } | null }>;
      };
    };
  };
}

export async function changeMemberRole(memberId: string, role: Role): Promise<Result> {
  const auth = await requireAdmin();
  if (auth.kind === "err") return { error: auth.error };
  const ctx = auth.ctx;

  const { error } = await membersTable().update({ role }).eq("id", memberId).eq("org_id", ctx.orgId);
  if (error) return { error: error.message };

  revalidatePath("/settings/members");
  return { ok: true };
}

export async function removeMember(memberId: string): Promise<Result> {
  const auth = await requireAdmin();
  if (auth.kind === "err") return { error: auth.error };
  const ctx = auth.ctx;

  const { data: member } = await membersTable()
    .select("user_id, role")
    .eq("id", memberId)
    .eq("org_id", ctx.orgId)
    .maybeSingle();

  if (!member || !member.role) return { error: "Miembro no encontrado" };

  if (member.role === "owner") {
    const admin = createAdminClient();
    const { count: ownerCount } = (await admin
      .from("org_members")
      .select("*", { count: "exact", head: true })
      .eq("org_id", ctx.orgId)
      .eq("role", "owner")) as unknown as { count: number | null };
    if ((ownerCount ?? 0) <= 1) {
      return { error: "No podés quitar al último owner de la organización" };
    }
  }

  const { error } = await membersTable().delete().eq("id", memberId).eq("org_id", ctx.orgId);
  if (error) return { error: error.message };

  revalidatePath("/settings/members");
  return { ok: true };
}
