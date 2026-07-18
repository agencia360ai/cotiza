import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { AsistenciaScreen, type AttSettings, type AttTech, type AttLoc, type AttEventRow } from "./screen";

export const dynamic = "force-dynamic";

function missing(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "42703") return true;
  return /does not exist|schema cache|could not find/i.test(error.message ?? "");
}

export default async function AsistenciaPage() {
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

  // Eventos de los últimos 21 días (tablero + historial).
  let events: AttEventRow[] = [];
  {
    const desde = new Date(Date.now() - 21 * 86400_000).toISOString();
    const res = (await supabase
      .from("attendance_events")
      .select("id, technician_id, direction, occurred_at, status, distance_m, matched_location_id, matched_hq, wa_location_name")
      .eq("org_id", orgId)
      .gte("occurred_at", desde)
      .order("occurred_at", { ascending: true })
      .limit(3000)) as { data: AttEventRow[] | null; error: { message?: string; code?: string } | null };
    if (missing(res.error)) migracionPendiente = true;
    else events = res.data ?? [];
  }

  return (
    <AsistenciaScreen
      settings={settingsData ?? null}
      techs={techs}
      locs={locs}
      events={events}
      migracionPendiente={migracionPendiente}
    />
  );
}
