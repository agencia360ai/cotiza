import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { NewReportWizard } from "./wizard";

export const dynamic = "force-dynamic";

type ClientWithLocations = {
  id: string;
  name: string;
  brand_color: string | null;
  locations: { id: string; name: string }[];
};

type Tech = { id: string; name: string };

export default async function NewReportPage() {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) redirect("/login");

  const { data: clients } = (await supabase
    .from("clients")
    .select("id, name, brand_color, locations:client_locations(id, name)")
    .order("name", { ascending: true })) as { data: ClientWithLocations[] | null };

  const { data: technicians } = (await supabase
    .from("technicians")
    .select("id, name")
    .eq("active", true)
    .order("name", { ascending: true })) as { data: Tech[] | null };

  return (
    <div className="px-4 py-6 md:px-10 md:py-8 max-w-3xl">
      <Link
        href="/maintenance/reports"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="size-4" />
        Volver a reportes
      </Link>

      <header className="mb-6 flex items-start gap-3">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white">
          <Plus className="size-6" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Nuevo reporte</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Creá un reporte manualmente — después editás todos sus campos e items
          </p>
        </div>
      </header>

      <NewReportWizard clients={clients ?? []} technicians={technicians ?? []} />
    </div>
  );
}
