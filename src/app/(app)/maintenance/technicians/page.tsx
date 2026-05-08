import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TechniciansList, NewTechnicianForm } from "./client-ui";

export const dynamic = "force-dynamic";

type TechRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  active: boolean;
  access_token: string;
  last_used_at: string | null;
  created_at: string;
};

export default async function TechniciansPage() {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) redirect("/login");

  const { data } = (await supabase
    .from("technicians")
    .select("*")
    .order("active", { ascending: false })
    .order("created_at", { ascending: false })) as { data: TechRow[] | null };

  const techs = data ?? [];

  return (
    <div className="px-4 py-6 md:px-10 md:py-8 max-w-5xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Personal</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Cada miembro tiene un link único persistente para acceder a su portal
        </p>
      </header>

      <NewTechnicianForm />

      <div className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-700">
          Equipo ({techs.length})
        </h2>
        {techs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
            Sin personal cargado. Agregá el primero arriba.
          </p>
        ) : (
          <TechniciansList technicians={techs} />
        )}
      </div>
    </div>
  );
}
