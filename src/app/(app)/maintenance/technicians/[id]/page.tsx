import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { EditPersonalForm } from "./edit-form";

export const dynamic = "force-dynamic";

type TechRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  active: boolean;
  access_token: string;
  org_id: string;
};

type ClientWithLocations = {
  id: string;
  name: string;
  client_locations: { id: string; name: string }[];
};

type AssignmentRow = { client_id: string; location_id: string | null };

export default async function EditPersonalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) redirect("/login");

  const { data: tech } = (await supabase
    .from("technicians")
    .select("id, name, phone, email, active, access_token, org_id")
    .eq("id", id)
    .maybeSingle()) as { data: TechRow | null };

  if (!tech) notFound();

  const [{ data: clients }, { data: assignments }] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, client_locations(id, name)")
      .order("name") as unknown as Promise<{ data: ClientWithLocations[] | null }>,
    supabase
      .from("technician_assignments")
      .select("client_id, location_id")
      .eq("technician_id", id) as unknown as Promise<{ data: AssignmentRow[] | null }>,
  ]);

  return (
    <div className="px-4 py-6 md:px-10 md:py-8 max-w-3xl">
      <Link
        href="/maintenance/technicians"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="size-4" />
        Volver a personal
      </Link>

      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Editar personal</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Datos de contacto y permisos por cliente o sucursal
        </p>
      </header>

      <EditPersonalForm
        person={{
          id: tech.id,
          name: tech.name,
          phone: tech.phone,
          email: tech.email,
          active: tech.active,
          access_token: tech.access_token,
        }}
        clients={clients ?? []}
        initialAssignments={assignments ?? []}
      />
    </div>
  );
}
