import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgContext } from "@/lib/org-context";
import { computePeriod, type PeriodId } from "@/lib/whatsapp/attendance-core";
import { AsistenciaScreen, type AttSettings, type AttTech, type AttLoc, type AttSite, type AttEventRow, type AttAudit, type AttDia } from "./screen";

export const dynamic = "force-dynamic";

function missing(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "42703") return true;
  return /does not exist|schema cache|could not find/i.test(error.message ?? "");
}

const PERIODOS: PeriodId[] = ["hoy", "ayer", "semana", "semana_pasada", "7d", "30d", "custom"];

export default async function AsistenciaPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; desde?: string; hasta?: string }>;
}) {
  const sp = await searchParams;

  const supabase = await createClient();
  const auth = await getActiveOrgContext();
  if (!auth) redirect("/login");
  const orgId = auth.orgId;

  // Settings (1 fila por org). select('*') tolera columnas de migraciones aún no
  // corridas (power_user_emails 0033, workday_days/end 0034).
  const { data: raw } = (await supabase.from("attendance_settings").select("*").eq("org_id", orgId).maybeSingle()) as {
    data: Record<string, unknown> | null;
  };
  const workdayDays = (raw?.workday_days as number[] | null) ?? [1, 2, 3, 4, 5];
  const settingsData: AttSettings | null = raw
    ? {
        wa_phone_number_id: (raw.wa_phone_number_id as string | null) ?? null,
        workday_start: (raw.workday_start as string | null) ?? "08:00",
        workday_end: (raw.workday_end as string | null) ?? "17:00",
        workday_days: workdayDays,
        late_after_min: (raw.late_after_min as number | null) ?? 15,
        require_geofence: (raw.require_geofence as boolean | null) ?? false,
      }
    : null;

  // Power users: quién puede editar marcas. Sin lista → cae en owner/admin.
  const email = (auth.user.email ?? "").toLowerCase();
  const powerEmails = ((raw?.power_user_emails as string[] | null) ?? []).map((e) => e.toLowerCase());
  const rosterWaIds = (raw?.roster_wa_ids as string[] | null) ?? [];
  const isPowerUser = powerEmails.length > 0 ? powerEmails.includes(email) : auth.role === "owner" || auth.role === "admin";

  // Período elegido → rango de fechas.
  const period: PeriodId = PERIODOS.includes(sp.period as PeriodId) ? (sp.period as PeriodId) : "semana";
  const range = computePeriod(period, new Date(), { workdays: workdayDays, from: sp.desde, to: sp.hasta });

  // Técnicos (con wa_id; fallback si la columna no existe).
  let techs: AttTech[] = [];
  {
    const full = (await supabase
      .from("technicians")
      .select("id, name, phone, wa_id, active, in_attendance")
      .eq("org_id", orgId)
      .order("active", { ascending: false })
      .order("name")) as { data: AttTech[] | null; error: { message?: string; code?: string } | null };
    // 0042 pendiente: sin la columna, todos llevan planilla (el default).
    if (missing(full.error)) {
      const sin42 = (await supabase
        .from("technicians")
        .select("id, name, phone, wa_id, active")
        .eq("org_id", orgId)
        .order("name")) as { data: AttTech[] | null; error: { message?: string; code?: string } | null };
      if (!missing(sin42.error)) {
        techs = sin42.data ?? [];
        full.error = null;
        full.data = techs;
      }
    }
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

  // Eventos del rango elegido. matched_name es 0032: si aún no existe, se
  // reintenta sin esa columna.
  const COLS_FULL = "id, technician_id, direction, occurred_at, status, distance_m, matched_location_id, matched_hq, matched_name, wa_location_name";
  const COLS_BASE = "id, technician_id, direction, occurred_at, status, distance_m, matched_location_id, matched_hq, wa_location_name";
  let events: AttEventRow[] = [];
  let truncado = false;
  {
    const LIMITE = 50000;
    const q = (cols: string) =>
      supabase
        .from("attendance_events")
        .select(cols)
        .eq("org_id", orgId)
        .gte("occurred_at", range.desdeIso)
        .lt("occurred_at", range.hastaIso)
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

  // Auditoría (solo power users; tabla 0033, degrada si aún no existe).
  let audit: AttAudit[] = [];
  if (isPowerUser) {
    const res = (await supabase
      .from("attendance_audit")
      .select("id, event_id, technician_id, actor_email, action, changes, created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(200)) as { data: AttAudit[] | null; error: { message?: string; code?: string } | null };
    if (!missing(res.error)) audit = res.data ?? [];
  }

  // Planilla del día (0039). Solo hay fila cuando hay algo que decir: una falta,
  // un proyecto, o una marca traída del mensaje de WhatsApp. Sin fila = presente.
  // Planilla de TODO el rango: el cuadro es personal × días.
  let planilla: AttDia[] = [];
  {
    const res = (await supabase
      .from("attendance_day")
      .select("technician_id, day, present, project_no, site_label, source, note")
      .eq("org_id", orgId)
      .gte("day", range.desdeKey)
      .lte("day", range.hastaKey)) as { data: AttDia[] | null; error: { message?: string; code?: string } | null };
    if (!missing(res.error)) planilla = res.data ?? [];
  }

  return (
    <AsistenciaScreen
      planilla={planilla}
      settings={settingsData}
      techs={techs}
      locs={locs}
      sites={sites}
      events={events}
      audit={audit}
      isPowerUser={isPowerUser}
      powerEmails={powerEmails}
      rosterWaIds={rosterWaIds}
      migracionPendiente={migracionPendiente}
      period={period}
      desdeKey={range.desdeKey}
      hastaKey={range.hastaKey}
      singleDay={range.singleDay}
      truncado={truncado}
    />
  );
}
