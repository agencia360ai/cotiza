import { redirect } from "next/navigation";
import { Building2, ChevronRight, Box, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { listMemberships } from "@/lib/org-context";
import { imageUrl } from "@/lib/maintenance/types";
import { setActiveOrg } from "./actions";
import { CreateOrgCard } from "./create-org-card";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Administrador",
  engineer: "Ingeniero",
  viewer: "Solo lectura",
};

export default async function SelectOrgPage() {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) redirect("/login");

  const memberships = await listMemberships();
  if (memberships.length === 0) redirect("/onboarding");
  if (memberships.length === 1) {
    // No hay nada que elegir
    redirect("/maintenance");
  }

  const orgIds = memberships.map((m) => m.org_id);
  const { data: orgs } = (await supabase
    .from("organizations")
    .select("id, name, logo_path, slug")
    .in("id", orgIds)) as {
    data: { id: string; name: string; logo_path: string | null; slug: string | null }[] | null;
  };

  // Counts per org
  const clientsByOrg = new Map<string, number>();
  for (const orgId of orgIds) {
    const { count } = await supabase
      .from("clients")
      .select("*", { count: "exact", head: true })
      .eq("org_id", orgId);
    clientsByOrg.set(orgId, count ?? 0);
  }

  const roleByOrg = new Map(memberships.map((m) => [m.org_id, m.role]));

  return (
    <div className="min-h-screen bg-slate-50 px-5 py-10 sm:px-8 sm:py-16">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Cotiza · Reportme.ai</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Elegí la organización
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Tenés acceso a varias organizaciones — seleccioná en cuál querés trabajar
          </p>
        </header>

        <div className="grid gap-3 sm:grid-cols-2">
          {(orgs ?? []).map((org) => {
            const role = roleByOrg.get(org.id) ?? "viewer";
            const clients = clientsByOrg.get(org.id) ?? 0;
            return (
              <form key={org.id} action={async () => { "use server"; await setActiveOrg(org.id); }}>
                <button
                  type="submit"
                  className="group flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 text-left transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
                >
                  {org.logo_path ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imageUrl(org.logo_path)}
                      alt={org.name}
                      className="size-14 shrink-0 rounded-2xl object-cover ring-1 ring-slate-200"
                    />
                  ) : (
                    <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white">
                      <Building2 className="size-6" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-bold text-slate-900">{org.name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{ROLE_LABEL[role] ?? role}</p>
                    <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <Users className="size-3" />
                        {clients} cliente{clients === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="size-5 text-slate-300 transition-transform group-hover:translate-x-1" />
                </button>
              </form>
            );
          })}
        </div>

        <CreateOrgCard />

        <p className="mt-8 text-center text-xs text-slate-400">
          <Box className="mr-1 inline size-3" />
          Vas a ver solo los datos de la organización elegida
        </p>
      </div>
    </div>
  );
}
