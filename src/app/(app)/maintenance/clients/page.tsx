import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, ChevronRight, MapPin, Box, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { CreateClientForm } from "./create-form";

export const dynamic = "force-dynamic";

type ClientRow = {
  id: string;
  name: string;
  brand_color: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  created_at: string;
  locations: { id: string }[];
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default async function ClientsListPage() {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) redirect("/login");

  const { data: clients } = (await supabase
    .from("clients")
    .select("*, locations:client_locations(id)")
    .order("name", { ascending: true })) as { data: ClientRow[] | null };

  const rows = clients ?? [];

  // Get equipment counts in a separate query
  const equipmentCounts = new Map<string, number>();
  if (rows.length > 0) {
    const { data: eqAll } = await supabase
      .from("client_equipment")
      .select("location_id, client_locations!inner(client_id)");
    type EqRow = { location_id: string; client_locations: { client_id: string } | { client_id: string }[] };
    for (const row of (eqAll ?? []) as EqRow[]) {
      const loc = Array.isArray(row.client_locations) ? row.client_locations[0] : row.client_locations;
      if (!loc) continue;
      equipmentCounts.set(loc.client_id, (equipmentCounts.get(loc.client_id) ?? 0) + 1);
    }
  }

  return (
    <div className="px-10 py-8 max-w-5xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Clientes</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Tus clientes con sus sucursales y equipos
        </p>
      </header>

      <Link
        href="/maintenance/clients/import"
        className="group mb-3 flex items-center gap-3 rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-50 to-blue-50 p-5 transition-all hover:-translate-y-0.5 hover:shadow-md"
      >
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-blue-600 text-white">
          <Sparkles className="size-5" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-slate-900">Crear cliente con IA</p>
          <p className="text-xs text-slate-600">
            Pegá una descripción o subí un PDF — la IA arma el cliente con sus sucursales,
            equipos y mantenimientos
          </p>
        </div>
        <ChevronRight className="size-5 text-violet-600 transition-transform group-hover:translate-x-1" />
      </Link>

      <CreateClientForm />

      <div className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-700">
          Cartera ({rows.length})
        </h2>
        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
            Sin clientes aún. Creá el primero arriba.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/maintenance/clients/${c.id}`}
                  className="group flex items-center gap-4 rounded-xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-sm"
                >
                  <div
                    className="flex size-12 shrink-0 items-center justify-center rounded-xl text-base font-bold text-white"
                    style={{ backgroundColor: c.brand_color ?? "#0EA5E9" }}
                  >
                    {initials(c.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900">{c.name}</p>
                    <div className="mt-0.5 flex items-center gap-3 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3" />
                        {c.locations.length} sucursal{c.locations.length === 1 ? "" : "es"}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Box className="size-3" />
                        {equipmentCounts.get(c.id) ?? 0} equipo{(equipmentCounts.get(c.id) ?? 0) === 1 ? "" : "s"}
                      </span>
                      {c.contact_email ? <span>{c.contact_email}</span> : null}
                    </div>
                  </div>
                  <ChevronRight className="size-5 text-slate-300 transition-transform group-hover:translate-x-1" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <span hidden>
        <Building2 />
      </span>
    </div>
  );
}
