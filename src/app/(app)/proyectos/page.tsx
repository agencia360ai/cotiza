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
    <div className="min-h-full bg-canvas">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/90 px-4 py-4 backdrop-blur md:px-8">
        <h1 className="text-[21px] font-bold tracking-[-0.03em] text-slate-900">Proyectos</h1>
        <p className="text-xs text-slate-500">Cobro, gasto y margen de cada proyecto, con los números de QuickBooks</p>
      </header>

      {/* Sin tope de ancho, a diferencia del resto: son 11 columnas y cualquier
          cap las corta antes de que la pantalla se acabe. Acá el ancho de más
          se usa en mostrar datos, no en márgenes. */}
      <div className="px-4 py-6 md:px-8">
        <QboProjectsBoard />
      </div>
    </div>
  );
}
