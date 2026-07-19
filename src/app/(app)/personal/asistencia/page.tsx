import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { AsistenciaScreen, type AttSettings, type AttTech, type AttLoc, type AttSite, type AttEventRow } from "./screen";

export const dynamic = "force-dynamic";

function missing(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "42703") return true;
  return /does not exist|schema cache|could not find/i.test(error.message ?? "");
}

// Períodos de historial/export (ventanas móviles en días).
const RANGOS: Record<string, number> = { "30d": 30, "3m": 92, "6m": 183, "12m": 366 };

export default async function AsistenciaPage({ searchParams }: { searchParams: Promise<{ rango?: string }> }) {
  const { rango: rangoParam } = await searchParams;
  const rango = rangoParam && RANGOS[rangoParam] ? rangoParam : "30d";
  const dias = RANGOS[rango];

  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) redirect("/login");
  const orgId = await getActiveOrgId();
  if (!orgId) redirect("/onboarding");

  // Settings (1 fila por org; puede no existir todavía).
  const { data: settingsData } = (await supabase
    .from("attendance_settings")
    .select("wa_phone_number_id, hq_name, hq_lat, hq_lng, hq_radius_m, workday_start, late_after_min, require_geofence")
    .eq("org_id", orgId)
    .maybeSingle()) as { data: AttSettings | null };

  // Técnicos (con wa_id; fallback si la columna no existe).
  let techs: AttTech[] = [];
  {
    const full = (await supabase
      .from("technicians")
      .select("id, name, phone, wa_id, active")
      .eq("org_id", orgId)
      .order("active", { ascending: false })
      .order("name")) as { data: AttTech[] | null; error: { message?: string; code?: string } | null };
    if (missing(full.error)) {
      const basic = (await supabase.from("technicians").select("id, name, phone, active").eq("org_id", orgId).order("name")) as {
        data: Omit<AttTech, "wa_id">[] | null;
      };
      techs = (basic.data ?? []).map((t) => ({ ...t, wa_id: null }));
    } else {
      techs = full.data ?? [];
    }
  }

  // Sitios de la org (via clients) con sus coordenadas.
  const { data: clientsData } = (await supabase.from("clients").select("id, name").eq("org_id", orgId)) as {
    data: { id: string; name: string }[] | null;
  };
  const clientName = new Map((clientsData ?? []).map((c) => [c.id, c.name]));
  let locs: AttLoc[] = [];
  let migracionPendiente = false;
  if ((clientsData ?? []).length > 0) {
    const res = (await supabase
      .from("client_locations")
      .select("id, name, client_id, lat, lng, geofence_radius_m")
      .in(
        "client_id",
        (clientsData ?? []).map((c) => c.id),
      )
      .order("name")) as {
      data: { id: string; name: string | null; client_id: string; lat: number | null; lng: number | null; geofence_radius_m: number | null }[] | null;
      error: { message?: string; code?: string } | null;
    };
    if (missing(res.error)) migracionPendiente = true;
    locs = (res.data ?? []).map((l) => ({
      id: l.id,
      name: l.name ?? "Sitio",
      clientName: clientName.get(l.client_id) ?? "",
      lat: l.lat,
      lng: l.lng,
      radius: l.geofence_radius_m ?? 150,
    }));
  }

  // Sitios de asistencia propios (tabla 0032; degrada si aún no existe).
  let sites: AttSite[] = [];
  {
    const res = (await supabase
      .from("attendance_sites")
      .select("id, name, lat, lng, geofence_radius_m")
      .eq("org_id", orgId)
      .order("name")) as {
      data: { id: string; name: string; lat: number | null; lng: number | null; geofence_radius_m: number | null }[] | null;
      error: { message?: string; code?: string } | null;
    };
    if (!missing(res.error)) sites = (res.data ?? []).map((s) => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng, radius: s.geofence_radius_m ?? 150 }));
  }

  // Eventos del período elegido (tablero HOY + historial + export). matched_name
  // es 0032: si aún no existe, se reintenta sin esa columna.
  const COLS_FULL = "id, technician_id, direction, occurred_at, status, distance_m, matched_location_id, matched_hq, matched_name, wa_location_name";
  const COLS_BASE = "id, technician_id, direction, occurred_at, status, distance_m, matched_location_id, matched_hq, wa_location_name";
  let events: AttEventRow[] = [];
  let truncado = false;
  {
    const desde = new Date(Date.now() - dias * 86400_000).toISOString();
    const LIMITE = 50000;
    const q = (cols: string) =>
      supabase
        .from("attendance_events")
        .select(cols)
        .eq("org_id", orgId)
        .gte("occurred_at", desde)
        .order("occurred_at", { ascending: true })
        .limit(LIMITE) as unknown as Promise<{ data: AttEventRow[] | null; error: { message?: string; code?: string } | null }>;
    let res = await q(COLS_FULL);
    if (res.error?.code === "42703") res = await q(COLS_BASE); // 0032 pendiente
    if (missing(res.error)) migracionPendiente = true;
    else {
      events = res.data ?? [];
      truncado = events.length >= LIMITE;
    }
  }

  return (
    <AsistenciaScreen
      settings={settingsData ?? null}
      techs={techs}
      locs={locs}
      sites={sites}
      events={events}
      migracionPendiente={migracionPendiente}
      rango={rango}
      truncado={truncado}
    />
  );
}
