import Link from "next/link";
import { redirect } from "next/navigation";
import { Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
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
  const orgId = await getActiveOrgId();
  if (!orgId) redirect("/onboarding");

  const { data } = (await supabase
    .from("technicians")
    .select("*")
    .eq("org_id", orgId)
    .order("active", { ascending: false })
    .order("created_at", { ascending: false })) as { data: TechRow[] | null };

  const techs = data ?? [];

  return (
    <div className="min-h-full bg-canvas">
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-canvas/90 px-4 py-4 backdrop-blur md:px-8">
        <div className="min-w-0">
          <h1 className="text-[21px] font-bold tracking-[-0.03em] text-slate-900">Personal</h1>
          <p className="text-xs text-slate-500">Cada miembro tiene un link único para entrar a su portal</p>
        </div>
        <Link
          href="/personal/asistencia"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Clock className="size-4 text-slate-700" /> Asistencia
        </Link>
      </header>

      <div className="max-w-[1400px] px-4 py-6 md:px-8">

      <NewTechnicianForm />

      <div className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-700">
          Equipo ({techs.length})
        </h2>
        {techs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
            Sin personal cargado. Agrega el primero arriba.
          </p>
        ) : (
          <TechniciansList technicians={techs} />
        )}
      </div>
      </div>
    </div>
  );
}
