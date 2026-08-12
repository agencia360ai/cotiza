import "server-only";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase/admin";

// Lista de miembros de la organización, con su email resuelto.
//
// El email vive en auth.users, no en cotiza.org_members, así que hace falta el
// cliente admin (service role). Esto estaba escrito a mano dentro de la página
// de Miembros; se sacó acá porque el selector de encargado de Leads necesita
// exactamente lo mismo y duplicarlo se desincroniza.

export type OrgMember = {
  id: string;
  user_id: string;
  email: string;
  display_name: string | null;
  role: string;
  created_at: string;
  wa_phone: string | null;
  last_sign_in_at: string | null;
};

/** Cómo se llama este miembro en pantalla: su nombre, o el email sin el dominio. */
export function nombreDeMiembro(m: { display_name?: string | null; email?: string | null }): string {
  const n = m.display_name?.trim();
  if (n) return n;
  const email = m.email?.trim() ?? "";
  return email.split("@")[0] || "—";
}

type AdminAuth = {
  admin: {
    getUserById: (id: string) => Promise<{
      data: { user: { id: string; email: string | null; last_sign_in_at: string | null } | null } | null;
      error: { message: string } | null;
    }>;
  };
};

/**
 * Miembros de la org, en orden de antigüedad. Devuelve [] si falta la service
 * role key — el llamador decide si eso es un error o solo un selector vacío.
 */
export async function listOrgMembers(orgId: string): Promise<OrgMember[]> {
  if (!hasAdminCredentials()) return [];
  const admin = createAdminClient();

  type Row = { id: string; user_id: string; role: string; created_at: string; wa_phone?: string | null; display_name?: string | null };
  const traer = (cols: string) =>
    admin.from("org_members").select(cols).eq("org_id", orgId).order("created_at", { ascending: true }) as unknown as Promise<{
      data: Row[] | null;
      error: { message?: string } | null;
    }>;
  // Escalera por migración pendiente: sin 0046 no hay display_name, sin 0044 no
  // hay wa_phone. La lista igual sale — solo pierde esa columna.
  let res = await traer("id, user_id, role, created_at, wa_phone, display_name");
  if (res.error && /display_name/.test(res.error.message ?? "")) res = await traer("id, user_id, role, created_at, wa_phone");
  if (res.error && /wa_phone/.test(res.error.message ?? "")) res = await traer("id, user_id, role, created_at");
  if (res.error) return [];

  const adminAuth = admin.auth as unknown as AdminAuth;
  return Promise.all(
    (res.data ?? []).map(async (m) => {
      const { data } = await adminAuth.admin.getUserById(m.user_id);
      return {
        id: m.id,
        user_id: m.user_id,
        role: m.role,
        created_at: m.created_at,
        wa_phone: m.wa_phone ?? null,
        display_name: m.display_name ?? null,
        email: data?.user?.email ?? "—",
        last_sign_in_at: data?.user?.last_sign_in_at ?? null,
      };
    }),
  );
}
