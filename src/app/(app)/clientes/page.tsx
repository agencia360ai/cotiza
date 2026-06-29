import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, Sparkles, Wand2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { CreateClientForm } from "./create-form";
import { QuickbooksSync } from "./qbo-sync";
import { ClientsBoard, type ClientCard, type ClientRel } from "./clients-board";
import type { ClientCategory } from "@/lib/maintenance/types";

export const dynamic = "force-dynamic";

type Agg = {
  quotes: number;
  enviadas: number;
  enJuego: number;
  proyectos: number;
  proyectosActivos: number;
  mantenimientos: number;
  sucursales: number;
  equipos: number;
  rubros: Set<string>;
  lastActivity: string | null;
};

function emptyAgg(): Agg {
  return {
    quotes: 0,
    enviadas: 0,
    enJuego: 0,
    proyectos: 0,
    proyectosActivos: 0,
    mantenimientos: 0,
    sucursales: 0,
    equipos: 0,
    rubros: new Set(),
    lastActivity: null,
  };
}

export default async function ClientsListPage() {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) redirect("/login");
  const orgId = await getActiveOrgId();
  if (!orgId) redirect("/onboarding");

  const { data: clientsRaw } = (await supabase
    .from("clients")
    .select("id, name, category, brand_color, logo_path")
    .eq("org_id", orgId)) as {
    data: { id: string; name: string; category: ClientCategory | null; brand_color: string | null; logo_path: string | null }[] | null;
  };
  const clients = clientsRaw ?? [];
  const ids = clients.map((c) => c.id);
  const safeIds = ids.length ? ids : ["00000000-0000-0000-0000-000000000000"];

  const [quotesR, tendersR, projectsR, locsR, schedR, eqR] = await Promise.all([
    supabase.from("sales_quotes").select("client_id, status, amount_usd, rubro, sent_date").eq("org_id", orgId).not("client_id", "is", null),
    supabase.from("tenders").select("client_id, rubro").eq("org_id", orgId).not("client_id", "is", null),
    supabase.from("client_projects").select("client_id, status").eq("org_id", orgId),
    supabase.from("client_locations").select("id, client_id").in("client_id", safeIds),
    supabase.from("maintenance_schedules").select("client_id").eq("active", true).in("client_id", safeIds),
    supabase
      .from("client_equipment")
      .select("location_id, client_locations!inner(client_id, client:clients!inner(org_id))")
      .eq("client_locations.client.org_id", orgId),
  ]);

  const agg = new Map<string, Agg>();
  const get = (id: string | null) => {
    if (!id) return null;
    let a = agg.get(id);
    if (!a) agg.set(id, (a = emptyAgg()));
    return a;
  };

  for (const r of (quotesR.data ?? []) as { client_id: string | null; status: string; amount_usd: number | null; rubro: string | null; sent_date: string | null }[]) {
    const a = get(r.client_id);
    if (!a) continue;
    a.quotes += 1;
    if (r.rubro) a.rubros.add(r.rubro);
    if (r.status === "enviada") {
      a.enviadas += 1;
      a.enJuego += Number(r.amount_usd) || 0;
    }
    if (r.sent_date && (!a.lastActivity || r.sent_date > a.lastActivity)) a.lastActivity = r.sent_date;
  }
  for (const r of (tendersR.data ?? []) as { client_id: string | null; rubro: string | null }[]) {
    const a = get(r.client_id);
    if (a && r.rubro) a.rubros.add(r.rubro);
  }
  for (const r of (projectsR.data ?? []) as { client_id: string | null; status: string | null }[]) {
    const a = get(r.client_id);
    if (!a) continue;
    a.proyectos += 1;
    if (r.status !== "completado" && r.status !== "cancelado") a.proyectosActivos += 1;
  }
  for (const r of (locsR.data ?? []) as { client_id: string }[]) {
    const a = get(r.client_id);
    if (a) a.sucursales += 1;
  }
  for (const r of (schedR.data ?? []) as { client_id: string | null }[]) {
    const a = get(r.client_id);
    if (a) a.mantenimientos += 1;
  }
  for (const row of (eqR.data ?? []) as { client_locations: { client_id: string } | { client_id: string }[] }[]) {
    const loc = Array.isArray(row.client_locations) ? row.client_locations[0] : row.client_locations;
    const a = get(loc?.client_id ?? null);
    if (a) a.equipos += 1;
  }

  const cutoff = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);

  const cards: ClientCard[] = clients.map((c) => {
    const a = agg.get(c.id) ?? emptyAgg();
    const rels: ClientRel[] = [];
    if (a.rubros.has("DC")) rels.push("contratos");
    if (a.rubros.has("DM") || a.mantenimientos > 0) rels.push("mantenimiento");
    if (a.rubros.has("DS")) rels.push("servicio");
    if (a.rubros.has("DV")) rels.push("ventas");
    const activo =
      a.enJuego > 0 || a.proyectosActivos > 0 || a.mantenimientos > 0 || (a.lastActivity !== null && a.lastActivity >= cutoff);
    return {
      id: c.id,
      name: c.name,
      category: c.category,
      brand_color: c.brand_color,
      logo_path: c.logo_path,
      quotes: a.quotes,
      enviadas: a.enviadas,
      enJuego: a.enJuego,
      proyectos: a.proyectos,
      proyectosActivos: a.proyectosActivos,
      mantenimientos: a.mantenimientos,
      sucursales: a.sucursales,
      equipos: a.equipos,
      rels,
      lastActivity: a.lastActivity,
      activo,
    };
  });

  return (
    <div className="px-4 py-6 md:px-10 md:py-8 max-w-5xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clientes</h1>
          <p className="text-sm text-muted-foreground mt-1">{cards.length} clientes · ordenados por actividad</p>
        </div>
        <Link
          href="/clientes/new"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          + Nuevo cliente
        </Link>
      </header>

      <QuickbooksSync />

      <Link
        href="/clientes/standardize"
        className="group mb-3 flex items-center gap-3 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-5 transition-all hover:-translate-y-0.5 hover:shadow-md"
      >
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-white">
          <Wand2 className="size-5" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-slate-900">Estandarizar nombres (IA)</p>
          <p className="text-xs text-slate-600">
            Agrupá los nombres sueltos de las cotizaciones en clientes reales y linkealos automáticamente
          </p>
        </div>
        <ChevronRight className="size-5 text-amber-600 transition-transform group-hover:translate-x-1" />
      </Link>

      <Link
        href="/clientes/import"
        className="group mb-3 flex items-center gap-3 rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-50 to-blue-50 p-5 transition-all hover:-translate-y-0.5 hover:shadow-md"
      >
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-blue-600 text-white">
          <Sparkles className="size-5" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-slate-900">Crear cliente con IA</p>
          <p className="text-xs text-slate-600">
            Pegá una descripción o subí un PDF — la IA arma el cliente con sus sucursales, equipos y mantenimientos
          </p>
        </div>
        <ChevronRight className="size-5 text-violet-600 transition-transform group-hover:translate-x-1" />
      </Link>

      <CreateClientForm />

      {cards.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          Sin clientes aún. Creá el primero arriba o estandarizá desde las cotizaciones.
        </p>
      ) : (
        <ClientsBoard clients={cards} />
      )}
    </div>
  );
}
