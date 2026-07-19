"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId, getActiveOrgContext } from "@/lib/org-context";
import { parseLatLng } from "@/lib/whatsapp/attendance-core";

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

// ── Resolver link de Google Maps (incluye links cortos maps.app.goo.gl) ───────
// El link corto NO trae coordenadas: es un redirect. Lo seguimos server-side
// hasta la URL larga (que sí trae @lat,lng / !3d!4d) o, si hace falta, leemos el
// HTML. Restringido a hosts de mapas (evita SSRF).
const MAPS_HOSTS = /(?:^|\.)(?:google\.[a-z.]+|goo\.gl|g\.co|maps\.apple\.com|waze\.com)$/i;
const UA = { "user-agent": "Mozilla/5.0 (compatible; CotizaBot/1.0; +https://app.dicecpanama.com)", "accept-language": "es-PA,es;q=0.9" };

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function scanCoords(text: string): { lat: number; lng: number } | null {
  const pats = [
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,
    /\[null,null,(-?\d+\.\d+),(-?\d+\.\d+)\]/,
    /"latitude":\s*(-?\d+\.\d+),\s*"longitude":\s*(-?\d+\.\d+)/,
  ];
  for (const re of pats) {
    const m = text.match(re);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return null;
}

async function followRedirects(url: string): Promise<string> {
  let current = url;
  for (let i = 0; i < 6; i++) {
    let res: Response;
    try {
      res = await fetch(current, { redirect: "manual", headers: UA });
    } catch {
      return current;
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return current;
      const next = new URL(loc, current);
      if (!MAPS_HOSTS.test(next.hostname)) return current; // no seguir fuera de mapas
      current = next.toString();
      const found = parseLatLng(current) ?? parseLatLng(safeDecode(current));
      if (found) return current;
      continue;
    }
    return current;
  }
  return current;
}

export async function resolveMapsLink(url: string): Promise<{ lat: number; lng: number } | { error: string }> {
  const c = await getActiveOrgContext();
  if (!c) return { error: "Sesión expirada" };
  const s = (url || "").trim();
  if (!s) return { error: "Pega un link de Google Maps o 'lat, lng'." };
  const direct = parseLatLng(s);
  if (direct) return direct;
  if (!/^https?:\/\//i.test(s)) return { error: "No reconocí las coordenadas. Pega un link de Google Maps o 'lat, lng'." };
  let host: string;
  try {
    host = new URL(s).hostname;
  } catch {
    return { error: "El link no es válido." };
  }
  if (!MAPS_HOSTS.test(host)) return { error: "Solo puedo abrir links de Google Maps. Pega el link del mapa o 'lat, lng'." };
  try {
    const finalUrl = await followRedirects(s);
    let parsed = parseLatLng(finalUrl) ?? parseLatLng(safeDecode(finalUrl));
    if (!parsed) {
      const res = await fetch(finalUrl, { headers: UA });
      if (res.ok) parsed = scanCoords(await res.text());
    }
    if (parsed) return parsed;
    return { error: "No pude leer las coordenadas de ese link. Abre el pin en Google Maps, mantén presionado y copia el 'lat, lng'." };
  } catch {
    return { error: "No pude abrir el link. Copia las coordenadas manualmente (lat, lng)." };
  }
}

// ── Sitios de asistencia propios (CRUD libre, no atados a cliente) ────────────
const faltaMigracion = (m: string) => /does not exist|schema cache|could not find/i.test(m);

export async function createAttendanceSite(input: { name: string; lat: number | null; lng: number | null; radius: number }): Promise<Result> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  if (!input.name.trim()) return { error: "Ponle un nombre al sitio." };
  const { error } = await c.supabase.from("attendance_sites").insert({
    org_id: c.orgId,
    name: input.name.trim(),
    lat: input.lat,
    lng: input.lng,
    geofence_radius_m: input.radius,
  });
  if (error) return { error: faltaMigracion(error.message) ? "Falta la migración 0032 — corre el SQL y reintenta." : error.message };
  revalidatePath("/personal/asistencia");
  return { ok: true };
}

export async function updateAttendanceSite(
  id: string,
  patch: { name?: string; lat?: number | null; lng?: number | null; radius?: number },
): Promise<Result> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const p: Record<string, unknown> = {};
  if (patch.name !== undefined) p.name = patch.name.trim();
  if (patch.lat !== undefined) p.lat = patch.lat;
  if (patch.lng !== undefined) p.lng = patch.lng;
  if (patch.radius !== undefined) p.geofence_radius_m = patch.radius;
  const { error } = await c.supabase.from("attendance_sites").update(p).eq("id", id).eq("org_id", c.orgId);
  if (error) return { error: error.message };
  revalidatePath("/personal/asistencia");
  return { ok: true };
}

export async function deleteAttendanceSite(id: string): Promise<Result> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const { error } = await c.supabase.from("attendance_sites").delete().eq("id", id).eq("org_id", c.orgId);
  if (error) return { error: error.message };
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

// ── Power users: quién puede editar/borrar/crear marcas a mano ────────────────
type PowerCtx = { ok: true; supabase: Awaited<ReturnType<typeof createClient>>; orgId: string; userId: string; email: string | null } | { ok: false; error: string };

async function powerCtx(): Promise<PowerCtx> {
  const supabase = await createClient();
  const c = await getActiveOrgContext();
  if (!c) return { ok: false, error: "Sesión expirada" };
  const email = (c.user.email ?? "").toLowerCase();
  const res = await supabase.from("attendance_settings").select("power_user_emails").eq("org_id", c.orgId).maybeSingle();
  const list = res.error ? [] : ((res.data as { power_user_emails: string[] | null } | null)?.power_user_emails ?? []).map((e) => e.toLowerCase());
  const isPower = list.length > 0 ? list.includes(email) : c.role === "owner" || c.role === "admin";
  if (!isPower) return { ok: false, error: "No tienes permiso para editar marcas." };
  return { ok: true, supabase, orgId: c.orgId, userId: c.user.id, email: c.user.email ?? null };
}

async function logAudit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  entry: {
    event_id: string | null;
    technician_id: string | null;
    actor_id: string | null;
    actor_email: string | null;
    action: "create" | "update" | "delete";
    changes: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await supabase.from("attendance_audit").insert({ org_id: orgId, ...entry });
  if (error) console.error("[asistencia] no pude registrar auditoría:", error.message);
}

export async function savePowerUsers(emails: string[]): Promise<Result> {
  const c = await powerCtx();
  if (!c.ok) return { error: c.error };
  const clean = Array.from(new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean)));
  const { error } = await c.supabase.from("attendance_settings").upsert({ org_id: c.orgId, power_user_emails: clean }, { onConflict: "org_id" });
  if (error) return { error: faltaMigracion(error.message) ? "Falta la migración 0033 — corre el SQL y reintenta." : error.message };
  revalidatePath("/personal/asistencia");
  return { ok: true };
}

type EventoActual = { id: string; technician_id: string; direction: "in" | "out"; occurred_at: string; status: string; note: string | null };

export async function updateAttendanceEvent(
  id: string,
  patch: { direction?: "in" | "out"; occurred_at?: string; note?: string | null },
): Promise<Result> {
  const c = await powerCtx();
  if (!c.ok) return { error: c.error };
  const { data: before } = (await c.supabase
    .from("attendance_events")
    .select("id, technician_id, direction, occurred_at, status, note")
    .eq("id", id)
    .eq("org_id", c.orgId)
    .maybeSingle()) as { data: EventoActual | null };
  if (!before) return { error: "No encontré la marca." };

  const upd: Record<string, unknown> = {};
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (patch.direction !== undefined && patch.direction !== before.direction) {
    upd.direction = patch.direction;
    changes.direction = { from: before.direction, to: patch.direction };
  }
  if (patch.occurred_at !== undefined && patch.occurred_at !== before.occurred_at) {
    upd.occurred_at = patch.occurred_at;
    changes.occurred_at = { from: before.occurred_at, to: patch.occurred_at };
  }
  if (patch.note !== undefined && (patch.note ?? "") !== (before.note ?? "")) {
    upd.note = patch.note;
    changes.note = { from: before.note, to: patch.note };
  }
  if (Object.keys(changes).length === 0) return { ok: true }; // nada que cambiar
  upd.status = "corregido";

  const { error } = await c.supabase.from("attendance_events").update(upd).eq("id", id).eq("org_id", c.orgId);
  if (error) return { error: error.message };
  await logAudit(c.supabase, c.orgId, {
    event_id: id,
    technician_id: before.technician_id,
    actor_id: c.userId,
    actor_email: c.email,
    action: "update",
    changes,
  });
  revalidatePath("/personal/asistencia");
  return { ok: true };
}

export async function deleteAttendanceEvent(id: string): Promise<Result> {
  const c = await powerCtx();
  if (!c.ok) return { error: c.error };
  const { data: before } = (await c.supabase
    .from("attendance_events")
    .select("id, technician_id, direction, occurred_at, status, note")
    .eq("id", id)
    .eq("org_id", c.orgId)
    .maybeSingle()) as { data: EventoActual | null };
  if (!before) return { error: "No encontré la marca." };
  const { error } = await c.supabase.from("attendance_events").delete().eq("id", id).eq("org_id", c.orgId);
  if (error) return { error: error.message };
  await logAudit(c.supabase, c.orgId, {
    event_id: id,
    technician_id: before.technician_id,
    actor_id: c.userId,
    actor_email: c.email,
    action: "delete",
    changes: { direction: before.direction, occurred_at: before.occurred_at, status: before.status },
  });
  revalidatePath("/personal/asistencia");
  return { ok: true };
}

export async function createManualAttendanceEvent(input: { technician_id: string; direction: "in" | "out"; occurred_at: string }): Promise<Result> {
  const c = await powerCtx();
  if (!c.ok) return { error: c.error };
  if (!input.technician_id) return { error: "Elige un técnico." };
  if (!input.occurred_at) return { error: "Falta la fecha y hora." };
  const { data: inserted, error } = (await c.supabase
    .from("attendance_events")
    .insert({
      org_id: c.orgId,
      technician_id: input.technician_id,
      direction: input.direction,
      occurred_at: input.occurred_at,
      status: "manual",
      source: "manual",
      note: `Agregada a mano por ${c.email ?? "power user"}`,
      raw: { manual: true, by: c.email },
    })
    .select("id")
    .maybeSingle()) as { data: { id: string } | null; error: { message: string } | null };
  if (error) return { error: error.message };
  await logAudit(c.supabase, c.orgId, {
    event_id: inserted?.id ?? null,
    technician_id: input.technician_id,
    actor_id: c.userId,
    actor_email: c.email,
    action: "create",
    changes: { direction: input.direction, occurred_at: input.occurred_at },
  });
  revalidatePath("/personal/asistencia");
  return { ok: true };
}
