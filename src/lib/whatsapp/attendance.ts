import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendText, sendButtons } from "./client";
import {
  parseWebhook,
  decideDirection,
  matchGeofence,
  determineStatus,
  buildConfirmation,
  fmtHora,
  type IncomingMessage,
  type GeoSite,
} from "./attendance-core";

// Orquestación del webhook de asistencia: identifica org + técnico, decide
// entrada/salida, matchea geocerca y registra el evento. Escribe con service
// role (el webhook no tiene sesión). NUNCA lanza hacia afuera — cada mensaje se
// procesa aislado; los errores van a los logs.

// El admin client viene tipado con schema `never` (bypassa RLS); igual que el
// cron de gov-tenders, se usa con tipo laxo y los reads se castean a mano.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;
const DEBOUNCE_MS = 5 * 60_000;

type Settings = {
  org_id: string;
  require_geofence: boolean;
};
type Tech = { id: string; name: string };
type EventoHoy = { direction: "in" | "out"; occurred_at: string };

// 00:00 America/Panama (UTC-5, sin DST) en UTC = ese día a las 05:00 UTC.
function panamaDayStart(now: Date): Date {
  const shifted = new Date(now.getTime() - 5 * 3600_000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), 5, 0, 0));
}

async function resolverOrg(admin: Admin, phoneNumberId: string): Promise<Settings | null> {
  const { data } = (await admin
    .from("attendance_settings")
    .select("org_id, require_geofence")
    .eq("wa_phone_number_id", phoneNumberId)
    .maybeSingle()) as { data: Settings | null };
  return data;
}

async function resolverTecnico(admin: Admin, orgId: string, waId: string): Promise<Tech | null> {
  const { data } = (await admin
    .from("technicians")
    .select("id, name")
    .eq("org_id", orgId)
    .eq("wa_id", waId)
    .eq("active", true)
    .maybeSingle()) as { data: Tech | null };
  return data;
}

async function eventosDeHoy(admin: Admin, orgId: string, techId: string, now: Date): Promise<EventoHoy[]> {
  const { data } = (await admin
    .from("attendance_events")
    .select("direction, occurred_at")
    .eq("org_id", orgId)
    .eq("technician_id", techId)
    .gte("occurred_at", panamaDayStart(now).toISOString())
    .order("occurred_at", { ascending: true })) as { data: EventoHoy[] | null };
  return data ?? [];
}

// Sitios candidatos para la geocerca: los sitios propios (incluida la sede, que
// ahora es un sitio más) + los del cliente asignados al técnico + todos los de
// la org (fallback).
async function reunirSitios(admin: Admin, s: Settings, techId: string): Promise<GeoSite[]> {
  const sites: GeoSite[] = [];

  // Sitios de asistencia propios (CRUD del manager, no atados a cliente).
  const { data: propios } = (await admin
    .from("attendance_sites")
    .select("name, lat, lng, geofence_radius_m")
    .eq("org_id", s.org_id)
    .not("lat", "is", null)
    .not("lng", "is", null)) as {
    data: { name: string; lat: number; lng: number; geofence_radius_m: number }[] | null;
  };
  for (const a of propios ?? []) {
    sites.push({ locationId: null, name: a.name, lat: a.lat, lng: a.lng, radiusM: a.geofence_radius_m ?? 150, isHq: false, assigned: true });
  }

  const { data: clients } = (await admin.from("clients").select("id").eq("org_id", s.org_id)) as {
    data: { id: string }[] | null;
  };
  const clientIds = (clients ?? []).map((c) => c.id);
  if (clientIds.length > 0) {
    const { data: locs } = (await admin
      .from("client_locations")
      .select("id, name, lat, lng, geofence_radius_m, client_id")
      .in("client_id", clientIds)
      .not("lat", "is", null)
      .not("lng", "is", null)) as {
      data: { id: string; name: string | null; lat: number; lng: number; geofence_radius_m: number; client_id: string }[] | null;
    };
    const { data: asg } = (await admin
      .from("technician_assignments")
      .select("client_id, location_id")
      .eq("technician_id", techId)) as { data: { client_id: string; location_id: string | null }[] | null };
    const asignaciones = asg ?? [];
    for (const l of locs ?? []) {
      const assigned = asignaciones.some((a) => a.location_id === l.id || (a.location_id === null && a.client_id === l.client_id));
      sites.push({ locationId: l.id, name: l.name ?? "Sitio", lat: l.lat, lng: l.lng, radiusM: l.geofence_radius_m ?? 150, isHq: false, assigned });
    }
  }
  return sites;
}

async function marcar(admin: Admin, s: Settings, tech: Tech, msg: IncomingMessage): Promise<void> {
  const loc = msg.location!;
  const now = new Date();

  // Dedup: reintento de Meta con el mismo wamid → no re-registrar ni re-confirmar.
  const { data: existente } = (await admin
    .from("attendance_events")
    .select("id")
    .eq("wa_message_id", msg.id)
    .maybeSingle()) as { data: { id: string } | null };
  if (existente) return;

  const hoy = await eventosDeHoy(admin, s.org_id, tech.id, now);

  // Debounce: dos ubicaciones en <5 min = la misma marca (reintento del empleado).
  const ultima = hoy[hoy.length - 1];
  if (ultima && now.getTime() - new Date(ultima.occurred_at).getTime() < DEBOUNCE_MS) {
    await sendText(msg.from, `Ya registré tu ${ultima.direction === "in" ? "entrada" : "salida"} de las ${fmtHora(new Date(ultima.occurred_at))}.`);
    return;
  }

  const direction = decideDirection(hoy);
  const sites = await reunirSitios(admin, s, tech.id);
  const match = matchGeofence({ lat: loc.latitude, lng: loc.longitude }, sites);
  const hasPinName = !!(loc.name || loc.address);
  const skewMin = msg.timestampSec ? Math.abs(now.getTime() - msg.timestampSec * 1000) / 60000 : null;
  const status = determineStatus({ match, hasPinName, waSkewMinutes: skewMin });

  // Con require_geofence: no registrar fuera de sitio, avisar.
  if (s.require_geofence && status === "fuera_de_sitio") {
    await sendText(
      msg.from,
      `⛔ No registré la marca: estás a ${match.distanceM} m de ${match.site?.name ?? "el sitio"}. Acércate al sitio y reintenta.`,
    );
    return;
  }

  const row: Record<string, unknown> = {
    org_id: s.org_id,
    technician_id: tech.id,
    direction,
    occurred_at: now.toISOString(),
    wa_timestamp: msg.timestampSec ? new Date(msg.timestampSec * 1000).toISOString() : null,
    lat: loc.latitude,
    lng: loc.longitude,
    wa_location_name: loc.name ?? null,
    wa_location_address: loc.address ?? null,
    matched_location_id: match.site?.locationId ?? null,
    matched_hq: match.site?.isHq ?? false,
    matched_name: match.site?.name ?? null,
    distance_m: match.distanceM,
    status,
    source: "whatsapp",
    wa_message_id: msg.id,
    raw: msg as unknown,
  };
  let { error } = await admin.from("attendance_events").insert(row);
  if (error && (error as { code?: string }).code === "42703") {
    // migración 0032 (matched_name) pendiente: registrar sin esa columna.
    delete row.matched_name;
    ({ error } = await admin.from("attendance_events").insert(row));
  }
  if (error) {
    // 23505 = carrera con el reintento de Meta (unique wamid) → ya quedó registrado.
    if ((error as { code?: string }).code === "23505") return;
    throw new Error(error.message);
  }

  // Turno al marcar salida: desde la última entrada abierta de hoy.
  let shiftMs: number | null = null;
  if (direction === "out" && ultima?.direction === "in") shiftMs = now.getTime() - new Date(ultima.occurred_at).getTime();

  const body = buildConfirmation({ direction, when: now, siteName: match.site?.name ?? null, distanceM: match.distanceM, status, shiftMs });
  await sendButtons(msg.from, body, [{ id: "corregir", title: "Corregir" }]);
}

async function corregir(admin: Admin, s: Settings, tech: Tech, to: string): Promise<void> {
  const now = new Date();
  const { data: ult } = (await admin
    .from("attendance_events")
    .select("id, direction, occurred_at")
    .eq("org_id", s.org_id)
    .eq("technician_id", tech.id)
    .gte("occurred_at", panamaDayStart(now).toISOString())
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle()) as { data: { id: string; direction: "in" | "out"; occurred_at: string } | null };
  if (!ult) {
    await sendText(to, "No hay una marca de hoy para corregir.");
    return;
  }
  const nueva = ult.direction === "in" ? "out" : "in";
  await admin.from("attendance_events").update({ direction: nueva, status: "corregido", note: "corregido por el empleado" }).eq("id", ult.id);
  await sendText(to, `✏️ Corregido: tu marca de las ${fmtHora(new Date(ult.occurred_at))} ahora es *${nueva === "in" ? "Entrada" : "Salida"}*.`);
}

async function ayuda(admin: Admin, s: Settings, tech: Tech, to: string): Promise<void> {
  const hoy = await eventosDeHoy(admin, s.org_id, tech.id, new Date());
  const ultima = hoy[hoy.length - 1];
  let estado: string;
  if (ultima?.direction === "in") {
    estado = `Tienes tu *entrada* abierta desde las ${fmtHora(new Date(ultima.occurred_at))}. Cuando te vayas, manda tu ubicación para marcar la *salida*.`;
  } else if (hoy.length > 0) {
    estado = "Hoy: " + hoy.map((e) => `${e.direction === "in" ? "entrada" : "salida"} ${fmtHora(new Date(e.occurred_at))}`).join(", ") + ".";
  } else {
    estado = "Hoy no has marcado todavía. Manda tu ubicación al llegar. 📍";
  }
  await sendText(
    to,
    `Hola ${tech.name.split(" ")[0]} 👋 Soy el asistente de asistencia de DICEC.\n\n` +
      `Para marcar, toca 📎 → *Ubicación* → *Enviar tu ubicación actual* (no la de 'tiempo real'): al *llegar* y al *irte*.\n\n` +
      estado,
  );
}

async function handle(admin: Admin, msg: IncomingMessage, phoneNumberId: string): Promise<void> {
  const s = await resolverOrg(admin, phoneNumberId);
  if (!s) {
    console.warn(`[asistencia] phone_number_id sin org: ${phoneNumberId}`);
    return;
  }
  const tech = await resolverTecnico(admin, s.org_id, msg.from);
  if (!tech) {
    await sendText(msg.from, "Este número no está registrado en DICEC. Habla con tu supervisor.");
    return;
  }
  if (msg.type === "location" && msg.location) {
    await marcar(admin, s, tech, msg);
  } else if (msg.type === "interactive" && msg.buttonReplyId === "corregir") {
    await corregir(admin, s, tech, msg.from);
  } else {
    await ayuda(admin, s, tech, msg.from);
  }
}

// Punto de entrada del route handler. Procesa todos los mensajes del payload;
// un fallo en uno no tumba a los demás.
export async function processAttendanceWebhook(body: unknown): Promise<void> {
  const parsed = parseWebhook(body);
  if (!parsed.phoneNumberId || parsed.messages.length === 0) return;
  const admin = createAdminClient() as unknown as Admin;
  for (const msg of parsed.messages) {
    try {
      await handle(admin, msg, parsed.phoneNumberId);
    } catch (e) {
      console.error(`[asistencia] error procesando ${msg.id}:`, e instanceof Error ? e.message : e);
    }
  }
}
