import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, ChevronRight, MapPin, Box, Sparkles, Tag } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { CreateClientForm } from "./create-form";
import { CATEGORY_LABEL, imageUrl, type ClientCategory } from "@/lib/maintenance/types";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type ClientRow = {
  id: string;
  name: string;
  category: ClientCategory | null;
  brand_color: string | null;
  logo_path: string | null;
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

export default async function ClientsListPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) redirect("/login");

  let q = supabase
    .from("clients")
    .select("*, locations:client_locations(id)")
    .order("name", { ascending: true });
  if (sp.category) q = q.eq("category", sp.category);
  const { data: clients } = (await q) as { data: ClientRow[] | null };

  const rows = clients ?? [];

  // Counts per category for filter chips
  const { data: catCountsRaw } = (await supabase.from("clients").select("category")) as {
    data: { category: ClientCategory | null }[] | null;
  };
  const categoryCounts = new Map<string, number>();
  for (const r of catCountsRaw ?? []) {
    const k = r.category ?? "_none";
    categoryCounts.set(k, (categoryCounts.get(k) ?? 0) + 1);
  }

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
    <div className="px-4 py-6 md:px-10 md:py-8 max-w-5xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clientes</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Tus clientes con sus sucursales y equipos
          </p>
        </div>
        <Link
          href="/maintenance/clients/new"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          + Nuevo cliente
        </Link>
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

      {/* Category filter chips */}
      {Array.from(categoryCounts.keys()).filter((k) => k !== "_none").length > 0 ? (
        <div className="mt-6 flex flex-wrap items-center gap-1.5">
          <Tag className="size-3.5 text-slate-400" />
          <Link
            href="/maintenance/clients"
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium",
              !sp.category ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200",
            )}
          >
            Todos
            <span className={cn("ml-1 tabular-nums", sp.category ? "text-slate-400" : "text-white/70")}>
              {(catCountsRaw ?? []).length}
            </span>
          </Link>
          {(["restaurante", "hotel", "retail", "oficina", "industrial", "residencial", "salud", "educacion", "otro"] as ClientCategory[])
            .filter((c) => (categoryCounts.get(c) ?? 0) > 0)
            .map((c) => (
              <Link
                key={c}
                href={`/maintenance/clients?category=${c}`}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium",
                  sp.category === c
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200",
                )}
              >
                {CATEGORY_LABEL[c]}
                <span className={cn("ml-1 tabular-nums", sp.category === c ? "text-white/70" : "text-slate-400")}>
                  {categoryCounts.get(c)}
                </span>
              </Link>
            ))}
        </div>
      ) : null}

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
                  {c.logo_path ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imageUrl(c.logo_path)}
                      alt={c.name}
                      className="size-12 shrink-0 rounded-xl object-cover ring-1 ring-slate-200"
                    />
                  ) : (
                    <div
                      className="flex size-12 shrink-0 items-center justify-center rounded-xl text-base font-bold text-white"
                      style={{ backgroundColor: c.brand_color ?? "#0EA5E9" }}
                    >
                      {initials(c.name)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-900">{c.name}</p>
                      {c.category ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                          <Tag className="size-2.5" />
                          {CATEGORY_LABEL[c.category]}
                        </span>
                      ) : null}
                    </div>
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
