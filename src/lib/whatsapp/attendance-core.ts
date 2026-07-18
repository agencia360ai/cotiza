// Núcleo PURO del pipeline de asistencia por WhatsApp: sin I/O, sin server-only,
// sin Supabase — solo lógica. Así se testea con payloads sintéticos (la salida a
// WhatsApp está bloqueada en dev, igual que PanamaCompra).

export type LatLng = { lat: number; lng: number };

export type GeoSite = {
  locationId: string | null; // null = sede propia (attendance_settings)
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
  isHq: boolean;
  assigned: boolean; // el sitio está asignado a este técnico (technician_assignments)
};

// Distancia Haversine en metros (sin PostGIS; decenas de sitios).
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

export type GeoMatch = {
  site: GeoSite | null;
  distanceM: number | null;
  within: boolean; // dentro del radio del sitio matcheado
  hasSites: boolean; // había al menos un sitio con coordenadas
};

// Matchea el punto contra los sitios. Prioridad: (1) sitio ASIGNADO dentro de su
// radio, más cercano; (2) cualquier sitio dentro de su radio, más cercano;
// (3) el más cercano en general (queda "fuera de sitio"). La sede propia (HQ)
// cuenta como un sitio más.
export function matchGeofence(point: LatLng, sites: GeoSite[]): GeoMatch {
  const conCoords = sites.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
  if (conCoords.length === 0) return { site: null, distanceM: null, within: false, hasSites: false };
  const scored = conCoords
    .map((s) => ({ s, d: haversineMeters(point, s), hit: haversineMeters(point, s) <= s.radiusM }))
    .sort((a, b) => a.d - b.d);
  const asignadoDentro = scored.filter((x) => x.hit && x.s.assigned)[0];
  const cualquieraDentro = scored.filter((x) => x.hit)[0];
  const elegido = asignadoDentro ?? cualquieraDentro ?? scored[0];
  return { site: elegido.s, distanceM: elegido.d, within: elegido.hit, hasSites: true };
}

// Toggle del día: si la ÚLTIMA marca de hoy fue 'in' (turno abierto) → la próxima
// es 'out'; si no (nada hoy, o la última fue 'out') → 'in'.
export function decideDirection(todayEventsChrono: { direction: "in" | "out" }[]): "in" | "out" {
  const last = todayEventsChrono[todayEventsChrono.length - 1];
  return last && last.direction === "in" ? "out" : "in";
}

export type AttendanceStatus = "ok" | "fuera_de_sitio" | "sin_sitio" | "pin_sospechoso" | "hora_dudosa";

// Un solo estado operativo, por prioridad: un PIN buscado (name/address presentes)
// o una hora dudosa (mensaje encolado sin señal) son señales de confianza que
// pesan más que el resultado de la geocerca.
export function determineStatus(input: {
  match: GeoMatch;
  hasPinName: boolean;
  waSkewMinutes: number | null; // |wa_timestamp - now| en minutos
}): AttendanceStatus {
  if (input.hasPinName) return "pin_sospechoso";
  if (input.waSkewMinutes !== null && input.waSkewMinutes > 10) return "hora_dudosa";
  if (!input.match.hasSites) return "sin_sitio";
  if (!input.match.within) return "fuera_de_sitio";
  return "ok";
}

// ── Parseo del webhook de Meta ────────────────────────────────────────────────
export type IncomingMessage = {
  from: string; // wa_id (E.164 sin '+')
  id: string; // wamid...
  type: string; // location | text | interactive | image | ...
  timestampSec: number | null;
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  text?: string;
  buttonReplyId?: string;
};
export type ParsedWebhook = { phoneNumberId: string | null; messages: IncomingMessage[] };

// Extrae phone_number_id + mensajes de la primera entry/change con field=messages.
// Ignora los eventos de "statuses" (entregado/leído).
export function parseWebhook(body: unknown): ParsedWebhook {
  const out: ParsedWebhook = { phoneNumberId: null, messages: [] };
  const b = body as {
    entry?: { changes?: { field?: string; value?: Record<string, unknown> }[] }[];
  } | null;
  for (const entry of b?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const v = change.value as
        | { metadata?: { phone_number_id?: string }; messages?: Record<string, unknown>[] }
        | undefined;
      if (v?.metadata?.phone_number_id) out.phoneNumberId = v.metadata.phone_number_id;
      for (const m of v?.messages ?? []) {
        const msg = m as {
          from?: string;
          id?: string;
          type?: string;
          timestamp?: string;
          location?: { latitude?: number; longitude?: number; name?: string; address?: string };
          text?: { body?: string };
          interactive?: { type?: string; button_reply?: { id?: string } };
        };
        if (!msg.from || !msg.id || !msg.type) continue;
        const im: IncomingMessage = {
          from: msg.from,
          id: msg.id,
          type: msg.type,
          timestampSec: msg.timestamp ? Number(msg.timestamp) : null,
        };
        if (msg.type === "location" && msg.location && msg.location.latitude != null && msg.location.longitude != null) {
          im.location = {
            latitude: Number(msg.location.latitude),
            longitude: Number(msg.location.longitude),
            name: msg.location.name?.trim() || undefined,
            address: msg.location.address?.trim() || undefined,
          };
        }
        if (msg.type === "text") im.text = msg.text?.body?.trim();
        if (msg.type === "interactive" && msg.interactive?.button_reply?.id) im.buttonReplyId = msg.interactive.button_reply.id;
        out.messages.push(im);
      }
    }
  }
  return out;
}

// ── Formato de la confirmación al empleado ────────────────────────────────────
export function fmtHora(d: Date, timeZone = "America/Panama"): string {
  return new Intl.DateTimeFormat("es-PA", { hour: "numeric", minute: "2-digit", hour12: true, timeZone })
    .format(d)
    .replace(/\s*([ap])\.?\s*m\.?/i, (_m, p) => ` ${p.toLowerCase()}.m.`);
}

export function fmtDuracion(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export function buildConfirmation(input: {
  direction: "in" | "out";
  when: Date;
  siteName: string | null;
  distanceM: number | null;
  status: AttendanceStatus;
  shiftMs?: number | null; // duración del turno al marcar salida
}): string {
  const hora = fmtHora(input.when);
  const verbo = input.direction === "in" ? "Entrada" : "Salida";
  const emoji = input.direction === "in" ? "✅" : "🕔";
  if (input.status === "pin_sospechoso") {
    return `⚠️ Registrado, pero enviaste un lugar buscado, no tu ubicación actual. Usa 📎 → Ubicación → *Enviar tu ubicación actual*.`;
  }
  if (input.status === "fuera_de_sitio" && input.siteName) {
    return `⚠️ ${verbo} registrada ${hora} — estás a ${input.distanceM} m de ${input.siteName}. Tu supervisor lo verá marcado.`;
  }
  if (input.status === "sin_sitio") {
    return `${emoji} ${verbo} registrada ${hora}. (Sitio sin coordenadas — avísale a tu supervisor.)`;
  }
  const sitio = input.siteName ? ` — ${input.siteName}${input.distanceM != null ? ` (a ${input.distanceM} m)` : ""}` : "";
  if (input.direction === "out" && input.shiftMs != null) {
    return `${emoji} ${verbo} registrada ${hora}${sitio}. Turno: ${fmtDuracion(input.shiftMs)}`;
  }
  return `${emoji} ${verbo} registrada ${hora}${sitio}`;
}
