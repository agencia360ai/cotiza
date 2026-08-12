import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { QboProjectsBoard } from "./qbo-projects";

export const dynamic = "force-dynamic";
// Las server actions de esta ruta pueden tardar: "Actualizar" recorre QBO
// (customers + P&L por proyecto). Sin esto, Vercel corta en el default.
export const maxDuration = 300;

export default async function ProjectsListPage() {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) redirect("/login");
  const orgId = await getActiveOrgId();
  if (!orgId) redirect("/onboarding");

  return (
    <div className="min-h-full bg-slate-50/70">
      <div className="px-4 py-6 md:px-10 md:py-8 max-w-6xl">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Proyectos</h1>
          <p className="text-sm text-muted-foreground mt-1">Cobro, gasto y margen de cada proyecto, con los números de QuickBooks</p>
        </header>

        <QboProjectsBoard />
      </div>
    </div>
  );
}
