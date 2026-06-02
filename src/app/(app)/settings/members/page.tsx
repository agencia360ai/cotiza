import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, ShieldCheck, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase/admin";
import { getActiveOrgContext } from "@/lib/org-context";
import { MembersTable } from "./members-table";
import { InviteMemberForm } from "./invite-form";

export const dynamic = "force-dynamic";

type MemberRow = { id: string; user_id: string; role: string; created_at: string };

export default async function MembersPage() {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) redirect("/login");
  const ctx = await getActiveOrgContext();
  if (!ctx) redirect("/onboarding");

  const canManage = ctx.role === "owner" || ctx.role === "admin";

  if (!hasAdminCredentials()) {
    return <ServiceRoleMissing />;
  }

  const admin = createAdminClient();
  const { data: members } = (await admin
    .from("org_members")
    .select("id, user_id, role, created_at")
    .eq("org_id", ctx.orgId)
    .order("created_at", { ascending: true })) as { data: MemberRow[] | null };

  // Resolver emails desde auth.users via admin
  type AdminAuth = {
    admin: {
      getUserById: (id: string) => Promise<{
        data: { user: { id: string; email: string | null; last_sign_in_at: string | null } | null } | null;
        error: { message: string } | null;
      }>;
    };
  };
  const adminAuth = (admin.auth as unknown) as AdminAuth;
  const enriched = await Promise.all(
    (members ?? []).map(async (m) => {
      const { data } = await adminAuth.admin.getUserById(m.user_id);
      return {
        ...m,
        email: data?.user?.email ?? "—",
        last_sign_in_at: data?.user?.last_sign_in_at ?? null,
        is_self: m.user_id === u.user!.id,
      };
    }),
  );

  return (
    <div className="px-4 py-6 md:px-10 md:py-8 max-w-4xl">
      <Link
        href="/settings"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="size-4" />
        Volver a configuración
      </Link>

      <header className="mb-6 flex items-start gap-3">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white">
          <Users className="size-6" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Miembros del equipo</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Personas con acceso a esta organización. Cada miembro entra con su email y password.
          </p>
        </div>
      </header>

      {!canManage ? (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Tu rol no permite gestionar miembros. Solo lectura.
        </div>
      ) : (
        <InviteMemberForm />
      )}

      <section className="mt-8">
        <header className="mb-3 flex items-center gap-2">
          <ShieldCheck className="size-4 text-slate-700" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700">
            Miembros activos ({enriched.length})
          </h2>
        </header>
        <MembersTable members={enriched} canManage={canManage} />
      </section>
    </div>
  );
}

function ServiceRoleMissing() {
  return (
    <div className="px-4 py-6 md:px-10 md:py-8 max-w-3xl">
      <Link
        href="/settings"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="size-4" />
        Volver a configuración
      </Link>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <AlertTriangle className="size-5" />
          </div>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-amber-900">Falta configurar SUPABASE_SERVICE_ROLE_KEY</h1>
            <p className="mt-1 text-sm text-amber-800">
              Para crear miembros del equipo necesitamos la <strong>service role key</strong> de
              Supabase (server-only, bypasea RLS). Sin esta key no se pueden listar ni crear cuentas.
            </p>
            <div className="mt-4 rounded-xl border border-amber-300 bg-white p-4 text-sm text-slate-800">
              <p className="font-semibold">Cómo agregarla:</p>
              <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm">
                <li>
                  Andá a{" "}
                  <a
                    href="https://supabase.com/dashboard/project/hliyxksrgqgfatorgbne/settings/api"
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-blue-600 hover:underline"
                  >
                    Supabase Dashboard → Settings → API
                  </a>
                </li>
                <li>
                  Copiá la key marcada como <strong>service_role</strong> (la roja, no la anon)
                </li>
                <li>
                  Andá a{" "}
                  <a
                    href="https://vercel.com/agencia360s-projects/cotiza/settings/environment-variables"
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-blue-600 hover:underline"
                  >
                    Vercel → Settings → Environment Variables
                  </a>
                </li>
                <li>
                  Add new → name: <code className="rounded bg-slate-100 px-1 font-mono text-xs">SUPABASE_SERVICE_ROLE_KEY</code> ·
                  value: la key copiada · marcala para Production, Preview y Development → Save
                </li>
                <li>
                  Volvé a esta página después del redeploy (~1 min)
                </li>
              </ol>
            </div>
            <p className="mt-3 text-xs text-amber-700">
              Si querés, podés usar el flujo de signup normal en /login (cualquiera con email/password
              puede crear su cuenta), pero esta página de gestión necesita la service role.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
