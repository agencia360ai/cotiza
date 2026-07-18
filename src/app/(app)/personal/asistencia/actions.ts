"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";

type Result = { error: string } | { ok: true };

async function ctx() {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { ok: false as const, error: "Sesión expirada" };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false as const, error: "Sin organización" };
  return { ok: true as const, supabase, orgId };
}

export type AttendanceSettingsInput = {
  wa_phone_number_id: string | null;
  hq_name: string | null;
  hq_lat: number | null;
  hq_lng: number | null;
  hq_radius_m: number;
  workday_start: string; // "HH:MM"
  late_after_min: number;
  require_geofence: boolean;
};

// Config de asistencia por org (1 fila, PK = org_id). Upsert.
export async function saveAttendanceSettings(input: AttendanceSettingsInput): Promise<Result> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const { error } = await c.supabase.from("attendance_settings").upsert(
    {
      org_id: c.orgId,
      wa_phone_number_id: input.wa_phone_number_id?.trim() || null,
      hq_name: input.hq_name?.trim() || null,
      hq_lat: input.hq_lat,
      hq_lng: input.hq_lng,
      hq_radius_m: input.hq_radius_m,
      workday_start: input.workday_start,
      late_after_min: input.late_after_min,
      require_geofence: input.require_geofence,
    },
    { onConflict: "org_id" },
  );
  if (error) return { error: /does not exist|schema cache/i.test(error.message) ? "Falta la migración 0031 — corre el SQL y reintenta." : error.message };
  revalidatePath("/personal/asistencia");
  return { ok: true };
}

// Geocerca de un sitio de cliente (lat/lng/radio). La RLS de client_locations
// (join a clients) ya limita a sitios de la org.
export async function setLocationGeofence(
  locationId: string,
  input: { lat: number | null; lng: number | null; radius: number },
): Promise<Result> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const { error } = await c.supabase
    .from("client_locations")
    .update({ lat: input.lat, lng: input.lng, geofence_radius_m: input.radius })
    .eq("id", locationId);
  if (error) return { error: /does not exist|schema cache/i.test(error.message) ? "Falta la migración 0031 — corre el SQL y reintenta." : error.message };
  revalidatePath("/personal/asistencia");
  return { ok: true };
}
