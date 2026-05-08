import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Hammer } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { NewProjectForm } from "./new-form";

export const dynamic = "force-dynamic";

type ClientRow = {
  id: string;
  name: string;
  client_locations: { id: string; name: string }[];
};

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; location?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) redirect("/login");

  const { data } = (await supabase
    .from("clients")
    .select("id, name, client_locations(id, name)")
    .order("name")) as { data: ClientRow[] | null };

  return (
    <div className="px-4 py-6 md:px-10 md:py-8 max-w-2xl">
      <Link
        href="/maintenance/projects"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="size-4" />
        Volver a proyectos
      </Link>

      <header className="mb-6 flex items-start gap-3">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white">
          <Hammer className="size-6" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Nuevo proyecto</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cargá los datos básicos. Después agregás los hitos paso a paso, con fotos y videos.
          </p>
        </div>
      </header>

      <NewProjectForm
        clients={data ?? []}
        defaultClientId={sp.client ?? null}
        defaultLocationId={sp.location ?? null}
      />
    </div>
  );
}
