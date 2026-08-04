"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, MapPin, Settings2, Download, AlertTriangle, LogIn, LogOut, CircleDashed, ExternalLink, Save, Plus, Trash2, Pencil, ShieldCheck, ScrollText, X, ChevronDown, ChevronRight, ClipboardCheck, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { pairShifts, sumShiftMs, panamaDayKey, parseLatLng, fmtHora, fmtDuracion, type AttEvent, type PeriodId } from "@/lib/whatsapp/attendance-core";
import {
  saveAttendanceSettings, setLocationGeofence, resolveMapsLink,
  createAttendanceSite, updateAttendanceSite, deleteAttendanceSite,
  savePowerUsers, updateAttendanceEvent, deleteAttendanceEvent, createManualAttendanceEvent, setPlanillaDia, saveRosterWaIds,
  type AttendanceSettingsInput,
} from "./actions";

export type AttSettings = {
  wa_phone_number_id: string | null;
  workday_start: string;
  workday_end: string;
  workday_days: number[];
  late_after_min: number;
  require_geofence: boolean;
};
export type AttTech = { id: string; name: string; phone: string | null; wa_id: string | null; active: boolean };
export type AttLoc = { id: string; name: string; clientName: string; lat: number | null; lng: number | null; radius: number };
export type AttSite = { id: string; name: string; lat: number | null; lng: number | null; radius: number };
export type AttEventRow = {
  id: string;
  technician_id: string;
  direction: "in" | "out";
  occurred_at: string;
  status: string;
  distance_m: number | null;
  matched_location_id: string | null;
  matched_hq: boolean;
  matched_name?: string | null;
  wa_location_name: string | null;
};
// Planilla del día (0039). Sin fila para una persona = presente, sin proyecto.
export type AttDia = {
  technician_id: string;
  day: string; // YYYY-MM-DD
  present: boolean;
  project_no: string | null;
  site_label: string | null;
  source: "manual" | "whatsapp";
  note: string | null;
};

export type AttAudit = {
  id: string;
  event_id: string | null;
  technician_id: string | null;
  actor_email: string | null;
  action: "create" | "update" | "delete";
  changes: Record<string, unknown>;
  created_at: string;
};

const fmtFecha = (iso: string) =>
  new Intl.DateTimeFormat("es-PA", { day: "2-digit", month: "short", timeZone: "America/Panama" }).format(new Date(iso));
const fmtFechaLarga = (dayKey: string) =>
  new Intl.DateTimeFormat("es-PA", { weekday: "long", day: "2-digit", month: "long", timeZone: "America/Panama" }).format(new Date(dayKey + "T12:00:00Z"));
const fmtFechaHora = (iso: string) =>
  new Intl.DateTimeFormat("es-PA", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Panama" }).format(new Date(iso));
const panamaMinutes = (iso: string) => {
  const d = new Date(new Date(iso).getTime() - 5 * 3600_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};

// <input datetime-local> ⇄ instante UTC, interpretando el valor como hora Panamá (UTC-5).
function isoToPanamaLocal(iso: string): string {
  return new Date(new Date(iso).getTime() - 5 * 3600_000).toISOString().slice(0, 16);
}
function panamaLocalToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local + ":00-05:00");
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Resuelve coordenadas de un texto: primero local (parseLatLng), y si falla —el
// caso de los links cortos maps.app.goo.gl— lo resuelve el servidor siguiendo el
// redirect. Devuelve las coords o un mensaje de error.
async function resolveCoords(link: string): Promise<{ lat: number; lng: number } | { error: string }> {
  const local = parseLatLng(link);
  if (local) return local;
  return resolveMapsLink(link);
}

function periodLabel(period: PeriodId, desdeKey: string, hastaKey: string, singleDay: boolean): string {
  if (period === "hoy") return "Hoy";
  if (period === "ayer") return `Ayer · ${fmtFecha(desdeKey + "T12:00:00Z")}`;
  if (period === "semana") return `Esta semana · ${fmtFecha(desdeKey + "T12:00:00Z")} – ${fmtFecha(hastaKey + "T12:00:00Z")}`;
  if (period === "semana_pasada") return `Semana pasada · ${fmtFecha(desdeKey + "T12:00:00Z")} – ${fmtFecha(hastaKey + "T12:00:00Z")}`;
  if (period === "7d") return "Últimos 7 días";
  if (period === "30d") return "Últimos 30 días";
  return singleDay ? fmtFecha(desdeKey + "T12:00:00Z") : `${fmtFecha(desdeKey + "T12:00:00Z")} – ${fmtFecha(hastaKey + "T12:00:00Z")}`;
}

const DIAS_SEMANA: [number, string][] = [[1, "Lun"], [2, "Mar"], [3, "Mié"], [4, "Jue"], [5, "Vie"], [6, "Sáb"], [0, "Dom"]];

export function AsistenciaScreen({
  settings, techs, locs, sites, events, audit, isPowerUser, powerEmails, migracionPendiente, period, desdeKey, hastaKey, singleDay, truncado,
  planilla, rosterWaIds,
}: {
  planilla: AttDia[];
  rosterWaIds: string[];
  settings: AttSettings | null;
  techs: AttTech[];
  locs: AttLoc[];
  sites: AttSite[];
  events: AttEventRow[];
  audit: AttAudit[];
  isPowerUser: boolean;
  powerEmails: string[];
  migracionPendiente: boolean;
  period: PeriodId;
  desdeKey: string;
  hastaKey: string;
  singleDay: boolean;
  truncado: boolean;
}) {
  const [tab, setTab] = useState<"tablero" | "planilla" | "config" | "auditoria">("planilla");
  const activos = techs.filter((t) => t.active);
  const nombre = useMemo(() => new Map(techs.map((t) => [t.id, t.name])), [techs]);
  const locName = useMemo(() => new Map(locs.map((l) => [l.id, l.name])), [locs]);
  const sinWa = activos.filter((t) => !t.wa_id);
  const label = periodLabel(period, desdeKey, hastaKey, singleDay);

  const lateThreshold = (settings?.late_after_min ?? 15) + hhmmToMin(settings?.workday_start ?? "08:00");

  // Eventos por técnico (cronológicos ya vienen asc).
  const porTech = useMemo(() => {
    const m = new Map<string, AttEvent[]>();
    for (const e of events) {
      const arr = m.get(e.technician_id) ?? [];
      arr.push({ id: e.id, direction: e.direction, occurred_at: e.occurred_at, status: e.status });
      m.set(e.technician_id, arr);
    }
    return m;
  }, [events]);
  const eventoById = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);

  const filaSitio = (evId: string | undefined) => {
    if (!evId) return null;
    const e = eventoById.get(evId);
    if (!e) return null;
    const site = e.matched_name ?? (e.matched_hq ? "Sede" : e.matched_location_id ? locName.get(e.matched_location_id) ?? "Sitio" : null);
    return { site, dist: e.distance_m, status: e.status };
  };

  const tabs: [string, string, React.ComponentType<{ className?: string }>][] = [
    ["planilla", "Asistencia", ClipboardCheck],
    ["config", "Configuración", Settings2],
  ];
  if (isPowerUser) tabs.push(["auditoria", "Auditoría", ScrollText]);

  return (
    <div className="px-4 py-6 md:px-10 md:py-8 max-w-5xl">
      <div className="mb-1 flex items-center gap-2 text-xs text-slate-400">
        <Link href="/personal" className="inline-flex items-center gap-1 hover:text-slate-600">
          <ArrowLeft className="size-3.5" /> Personal
        </Link>
      </div>
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Asistencia</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Marcaje por WhatsApp: el empleado envía su ubicación al llegar y al irse.
          </p>
        </div>
        <button
          type="button"
          onClick={() => exportCsv(events, nombre, locName, period)}
          disabled={events.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          title="Descarga la vista actual en CSV"
        >
          <Download className="size-4" /> Exportar
        </button>
      </header>

      {/* Período: manda sobre el tablero y sobre lo que exportas. */}
      {tab === "planilla" || tab === "tablero" ? <PeriodControl period={period} desdeKey={desdeKey} hastaKey={hastaKey} truncado={truncado} /> : null}

      {migracionPendiente ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Falta correr la <b>migración 0031</b> en Supabase para activar la asistencia. El tablero se llena cuando la corras y llegue el primer marcaje.
        </div>
      ) : null}

      {sinWa.length > 0 ? (
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          {sinWa.length === 1 ? "1 técnico activo sin número de WhatsApp válido" : `${sinWa.length} técnicos activos sin número de WhatsApp válido`}: {sinWa.map((t) => t.name).join(", ")}.{" "}
          <Link href="/personal" className="font-semibold text-blue-600 hover:underline">Agrega su teléfono en Personal</Link> para que puedan marcar.
        </div>
      ) : null}

      <div className="mb-4 inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white p-1 text-sm font-semibold shadow-sm">
        {tabs.map(([k, lbl, Icon]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k as typeof tab)}
            className={cn("inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 transition-colors", tab === k ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}
          >
            <Icon className="size-4" /> {lbl}
          </button>
        ))}
      </div>

      {tab === "tablero" ? (
        <div className="mb-3">
          <button
            type="button"
            onClick={() => setTab("planilla")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            <ArrowLeft className="size-3.5" /> Volver a la asistencia
          </button>
        </div>
      ) : null}
      {tab === "tablero" ? (
        <Tablero activos={activos} porTech={porTech} period={period} desdeKey={desdeKey} hastaKey={hastaKey} singleDay={singleDay} filaSitio={filaSitio} lateThreshold={lateThreshold} isPowerUser={isPowerUser} label={label} />
      ) : tab === "planilla" ? (
        <PlanillaTab techs={activos} planilla={planilla} desdeKey={desdeKey} hastaKey={hastaKey} workdays={settings?.workday_days ?? [1, 2, 3, 4, 5, 6]} events={events} singleDay={singleDay} onVerMarcas={() => setTab("tablero")} />
      ) : tab === "config" ? (
        <Config settings={settings} locs={locs} sites={sites} isPowerUser={isPowerUser} powerEmails={powerEmails} rosterWaIds={rosterWaIds} />
      ) : (
        <Auditoria audit={audit} nombre={nombre} />
      )}
    </div>
  );
}

function hhmmToMin(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

// ── Control de período ────────────────────────────────────────────────────────
function PeriodControl({ period, desdeKey, hastaKey, truncado }: { period: PeriodId; desdeKey: string; hastaKey: string; truncado: boolean }) {
  const router = useRouter();
  const [d, setD] = useState(desdeKey);
  const [h, setH] = useState(hastaKey);
  const opciones: [PeriodId, string][] = [
    ["hoy", "Hoy"],
    ["ayer", "Ayer"],
    ["semana", "Esta semana"],
    ["semana_pasada", "Semana pasada"],
    ["30d", "Últimos 30 días"],
    ["custom", "Personalizado"],
  ];
  const ir = (p: PeriodId) => {
    if (p === "custom") router.push(`/personal/asistencia?period=custom&desde=${d}&hasta=${h}`);
    else router.push(`/personal/asistencia?period=${p}`);
  };

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="font-semibold uppercase tracking-wider">Período</span>
        <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5">
          {opciones.map(([id, lbl]) => (
            <button
              key={id}
              type="button"
              onClick={() => ir(id)}
              className={cn("rounded-md px-2.5 py-1 font-semibold transition-colors", period === id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}
            >
              {lbl}
            </button>
          ))}
        </div>
        {truncado ? <span className="text-amber-600">· mostrando el máximo (50.000 marcas); acota el rango</span> : null}
      </div>
      {period === "custom" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span>Desde</span>
          <input type="date" value={d} max={h} onChange={(e) => setD(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1" />
          <span>hasta</span>
          <input type="date" value={h} min={d} onChange={(e) => setH(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1" />
          <button type="button" onClick={() => router.push(`/personal/asistencia?period=custom&desde=${d}&hasta=${h}`)} className="rounded-lg bg-slate-900 px-3 py-1 font-semibold text-white hover:bg-slate-800">
            Aplicar
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ── Tablero (dispatch: día vivo / día pasado / rango) ─────────────────────────
type FilaSitio = (evId: string | undefined) => { site: string | null; dist: number | null; status: string } | null;

type ResumenDia = ReturnType<typeof resumenDia>;
function resumenDia(dia: AttEvent[], live: boolean, lateThreshold: number) {
  const shifts = pairShifts(dia);
  const primeraIn = dia.find((e) => e.direction === "in");
  const ultimaOut = [...dia].reverse().find((e) => e.direction === "out");
  const abierto = shifts.find((s) => s.in && !s.out);
  let ms = sumShiftMs(shifts);
  if (live && abierto?.in) ms += Date.now() - +new Date(abierto.in.occurred_at);
  const estado = dia.length === 0 ? "sin" : abierto ? "adentro" : "salio";
  const tarde = primeraIn ? panamaMinutes(primeraIn.occurred_at) > lateThreshold : false;
  const alertas = new Set(dia.map((e) => e.status).filter((s): s is string => !!s && s !== "ok" && s !== "corregido"));
  return { shifts, primeraIn, ultimaOut, ms, estado, tarde, alertas, tieneMarca: dia.length > 0 };
}

function Tablero({
  activos, porTech, period, desdeKey, hastaKey, singleDay, filaSitio, lateThreshold, isPowerUser, label,
}: {
  activos: AttTech[];
  porTech: Map<string, AttEvent[]>;
  period: PeriodId;
  desdeKey: string;
  hastaKey: string;
  singleDay: boolean;
  filaSitio: FilaSitio;
  lateThreshold: number;
  isPowerUser: boolean;
  label: string;
}) {
  const [modoEdicion, setModoEdicion] = useState(false);
  const live = period === "hoy";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold capitalize text-slate-700">{singleDay && period === "custom" ? fmtFechaLarga(desdeKey) : label}</p>
        {isPowerUser ? (
          <button
            type="button"
            onClick={() => setModoEdicion((v) => !v)}
            className={cn("inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors", modoEdicion ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50")}
          >
            <Pencil className="size-4" /> {modoEdicion ? "Listo" : "Editar marcas"}
          </button>
        ) : null}
      </div>

      {modoEdicion ? (
        <TableroEdicion activos={activos} porTech={porTech} desdeKey={desdeKey} hastaKey={hastaKey} />
      ) : singleDay ? (
        <TableroDia activos={activos} porTech={porTech} dayKey={desdeKey} live={live} filaSitio={filaSitio} lateThreshold={lateThreshold} />
      ) : (
        <TableroRango activos={activos} porTech={porTech} filaSitio={filaSitio} lateThreshold={lateThreshold} />
      )}
    </div>
  );
}

// ── Tablero de UN día (vivo si es hoy) ────────────────────────────────────────
function TableroDia({ activos, porTech, dayKey, live, filaSitio, lateThreshold }: { activos: AttTech[]; porTech: Map<string, AttEvent[]>; dayKey: string; live: boolean; filaSitio: FilaSitio; lateThreshold: number }) {
  const filas = activos.map((t) => {
    const dia = (porTech.get(t.id) ?? []).filter((e) => panamaDayKey(e.occurred_at) === dayKey);
    return { t, r: resumenDia(dia, live, lateThreshold) };
  });
  filas.sort((a, b) => rank(a.r) - rank(b.r) || a.t.name.localeCompare(b.t.name));

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
              <th className="px-3 py-2.5 font-semibold">Técnico</th>
              {live ? <th className="px-3 py-2.5 font-semibold">Estado</th> : null}
              <th className="px-3 py-2.5 font-semibold">Entrada</th>
              <th className="px-3 py-2.5 font-semibold">Salida</th>
              <th className="px-3 py-2.5 font-semibold">Horas</th>
              <th className="px-3 py-2.5 font-semibold">Alertas</th>
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 ? (
              <tr><td colSpan={live ? 6 : 5} className="px-3 py-10 text-center text-sm text-slate-400">Sin técnicos activos.</td></tr>
            ) : (
              filas.map(({ t, r }) => {
                const inSitio = filaSitio(r.primeraIn?.id);
                const outSitio = filaSitio(r.ultimaOut?.id);
                return (
                  <tr key={t.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-3 py-2.5 font-medium text-slate-900">{t.name}</td>
                    {live ? <td className="px-3 py-2.5"><EstadoChip estado={r.estado} /></td> : null}
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">
                      {r.primeraIn ? (
                        <div>
                          <span className={cn("tabular-nums", r.tarde && "font-semibold text-amber-700")}>{fmtHora(new Date(r.primeraIn.occurred_at))}</span>
                          {inSitio?.site ? <span className="block text-[11px] text-slate-400">{inSitio.site}{inSitio.dist != null ? ` · ${inSitio.dist} m` : ""}</span> : null}
                        </div>
                      ) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">
                      {r.ultimaOut ? (
                        <div>
                          <span className="tabular-nums">{fmtHora(new Date(r.ultimaOut.occurred_at))}</span>
                          {outSitio?.site ? <span className="block text-[11px] text-slate-400">{outSitio.site}{outSitio.dist != null ? ` · ${outSitio.dist} m` : ""}</span> : null}
                        </div>
                      ) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-slate-700">{r.tieneMarca && r.ms > 0 ? fmtDuracion(r.ms) : "—"}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {r.tarde ? <Chip tone="amber">tardanza</Chip> : null}
                        {[...r.alertas].map((a) => <Chip key={a} tone={a === "fuera_de_sitio" ? "amber" : "rose"}>{ALERTA_LABEL[a] ?? a}</Chip>)}
                        {r.estado === "adentro" ? <Chip tone={live ? "slate" : "amber"}>sin salida</Chip> : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Tablero de un RANGO (resumen por técnico + detalle por día) ───────────────
function TableroRango({ activos, porTech, filaSitio, lateThreshold }: { activos: AttTech[]; porTech: Map<string, AttEvent[]>; filaSitio: FilaSitio; lateThreshold: number }) {
  const [abierto, setAbierto] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setAbierto((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const filas = activos.map((t) => {
    const evs = porTech.get(t.id) ?? [];
    const porDia = new Map<string, AttEvent[]>();
    for (const e of evs) porDia.set(panamaDayKey(e.occurred_at), [...(porDia.get(panamaDayKey(e.occurred_at)) ?? []), e]);
    let horasMs = 0;
    let tardanzas = 0;
    let alertas = 0;
    for (const [, dia] of porDia) {
      const r = resumenDia([...dia].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)), false, lateThreshold);
      horasMs += r.ms;
      if (r.tarde) tardanzas++;
      alertas += r.alertas.size + (r.estado === "adentro" ? 1 : 0);
    }
    const dias = [...porDia.entries()].sort((a, b) => b[0].localeCompare(a[0]));
    return { t, diasMarcados: porDia.size, horasMs, tardanzas, alertas, dias };
  });

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
              <th className="px-3 py-2.5 font-semibold">Técnico</th>
              <th className="px-3 py-2.5 text-right font-semibold">Días</th>
              <th className="px-3 py-2.5 text-right font-semibold">Horas</th>
              <th className="px-3 py-2.5 text-right font-semibold">Tardanzas</th>
              <th className="px-3 py-2.5 text-right font-semibold">Alertas</th>
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-10 text-center text-sm text-slate-400">Sin técnicos activos.</td></tr>
            ) : (
              filas.map(({ t, diasMarcados, horasMs, tardanzas, alertas, dias }) => {
                const open = abierto.has(t.id);
                return (
                  <Fragment key={t.id}>
                    <tr className={cn("border-b border-slate-50 last:border-0", diasMarcados > 0 && "cursor-pointer hover:bg-slate-50")} onClick={() => diasMarcados > 0 && toggle(t.id)}>
                      <td className="px-3 py-2.5 font-medium text-slate-900">
                        <span className="inline-flex items-center gap-1.5">
                          {diasMarcados > 0 ? (open ? <ChevronDown className="size-3.5 text-slate-400" /> : <ChevronRight className="size-3.5 text-slate-400" />) : <span className="inline-block size-3.5" />}
                          {t.name}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{diasMarcados || "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-700">{horasMs > 0 ? fmtDuracion(horasMs) : "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{tardanzas || "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{alertas > 0 ? <span className="font-semibold text-rose-600">{alertas}</span> : "—"}</td>
                    </tr>
                    {open ? (
                      <tr className="bg-slate-50/50">
                        <td colSpan={5} className="px-3 py-2">
                          <div className="space-y-1.5">
                            {dias.map(([dia, evs]) => <DetalleDia key={dia} dayKey={dia} evs={evs} filaSitio={filaSitio} />)}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Detalle de un día (lectura): turnos in→out.
function DetalleDia({ dayKey, evs, filaSitio }: { dayKey: string; evs: AttEvent[]; filaSitio: FilaSitio }) {
  const shifts = pairShifts([...evs].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)));
  const total = sumShiftMs(shifts);
  return (
    <div className="rounded-lg border border-slate-100 bg-white p-2.5">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-700">{fmtFecha(dayKey + "T12:00:00Z")}</p>
        <p className="text-[11px] font-semibold tabular-nums text-slate-500">{total > 0 ? fmtDuracion(total) : "—"}</p>
      </div>
      <div className="space-y-0.5">
        {shifts.map((s, i) => {
          const inS = filaSitio(s.in?.id);
          return (
            <div key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-600">
              <span className="inline-flex items-center gap-1"><LogIn className="size-3 text-emerald-600" />{s.in ? fmtHora(new Date(s.in.occurred_at)) : "—"}</span>
              <span className="text-slate-300">→</span>
              <span className="inline-flex items-center gap-1"><LogOut className="size-3 text-slate-500" />{s.out ? fmtHora(new Date(s.out.occurred_at)) : <span className="text-amber-600">sin salida</span>}</span>
              {s.ms != null ? <span className="tabular-nums text-slate-400">({fmtDuracion(s.ms)})</span> : null}
              {inS?.site ? <span className="text-slate-400">· {inS.site}{inS.dist != null ? ` (${inS.dist} m)` : ""}</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Edición de marcas (power users) ───────────────────────────────────────────
function TableroEdicion({ activos, porTech, desdeKey, hastaKey }: { activos: AttTech[]; porTech: Map<string, AttEvent[]>; desdeKey: string; hastaKey: string }) {
  const router = useRouter();
  const [techId, setTechId] = useState(activos[0]?.id ?? "");
  const refrescar = () => router.refresh();
  const evs = porTech.get(techId) ?? [];
  const dias = useMemo(() => {
    const m = new Map<string, AttEvent[]>();
    for (const e of evs) m.set(panamaDayKey(e.occurred_at), [...(m.get(panamaDayKey(e.occurred_at)) ?? []), e]);
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [evs]);
  const defaultDay = hastaKey >= desdeKey ? hastaKey : desdeKey;

  return (
    <div className="space-y-3">
      <select value={techId} onChange={(e) => setTechId(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
        {activos.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>

      {techId ? <AgregarMarca techId={techId} defaultLocal={`${defaultDay}T08:00`} onDone={refrescar} /> : null}

      {dias.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">Sin marcas en este período para {activos.find((t) => t.id === techId)?.name ?? "el técnico"}.</p>
      ) : (
        dias.map(([dia, evsDia]) => {
          const ordenados = [...evsDia].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
          return (
            <div key={dia} className="rounded-xl border border-slate-100 bg-white p-3.5">
              <p className="mb-2 text-sm font-semibold text-slate-800">{fmtFecha(dia + "T12:00:00Z")}</p>
              <div className="space-y-1.5">
                {ordenados.map((ev) => <MarcaRow key={ev.id} ev={ev} onDone={refrescar} />)}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// Fila editable de una marca (power users): cambiar tipo/hora o eliminar.
function MarcaRow({ ev, onDone }: { ev: AttEvent; onDone: () => void }) {
  const [editing, setEditing] = useState(false);
  const [dir, setDir] = useState<"in" | "out">(ev.direction);
  const [when, setWhen] = useState(isoToPanamaLocal(ev.occurred_at));
  const [busy, startBusy] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function guardar() {
    setErr(null);
    const iso = panamaLocalToIso(when);
    if (!iso) { setErr("Fecha y hora inválidas."); return; }
    startBusy(async () => {
      const r = await updateAttendanceEvent(ev.id, { direction: dir, occurred_at: iso });
      if ("error" in r) setErr(r.error);
      else { setEditing(false); onDone(); }
    });
  }
  function borrar() {
    if (!confirm("¿Eliminar esta marca?")) return;
    setErr(null);
    startBusy(async () => {
      const r = await deleteAttendanceEvent(ev.id);
      if ("error" in r) setErr(r.error);
      else onDone();
    });
  }

  if (editing) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2 text-xs">
        <select value={dir} onChange={(e) => setDir(e.target.value as "in" | "out")} className="rounded border border-slate-200 bg-white px-2 py-1">
          <option value="in">Entrada</option>
          <option value="out">Salida</option>
        </select>
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="rounded border border-slate-200 bg-white px-2 py-1" />
        <button type="button" onClick={guardar} disabled={busy} className="rounded bg-slate-900 px-2.5 py-1 font-semibold text-white disabled:opacity-50">{busy ? "…" : "Guardar"}</button>
        <button type="button" onClick={() => { setEditing(false); setErr(null); }} className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100">Cancelar</button>
        {err ? <span className="text-red-600">{err}</span> : null}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold", ev.direction === "in" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600")}>
        {ev.direction === "in" ? <LogIn className="size-3" /> : <LogOut className="size-3" />}
        {ev.direction === "in" ? "Entrada" : "Salida"}
      </span>
      <span className="tabular-nums text-slate-700">{fmtHora(new Date(ev.occurred_at))}</span>
      {ev.status && ev.status !== "ok" ? <span className="text-[10px] text-slate-400">{ALERTA_LABEL[ev.status] ?? ev.status}</span> : null}
      <button type="button" onClick={() => setEditing(true)} className="ml-auto inline-flex items-center rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Editar"><Pencil className="size-3.5" /></button>
      <button type="button" onClick={borrar} disabled={busy} className="inline-flex items-center rounded p-1 text-red-400 hover:bg-red-50 hover:text-red-600" title="Eliminar"><Trash2 className="size-3.5" /></button>
      {err ? <span className="text-red-600">{err}</span> : null}
    </div>
  );
}

// Agregar una marca a mano (power users) para el técnico seleccionado.
function AgregarMarca({ techId, defaultLocal, onDone }: { techId: string; defaultLocal?: string; onDone: () => void }) {
  const [dir, setDir] = useState<"in" | "out">("in");
  const [when, setWhen] = useState(defaultLocal ?? isoToPanamaLocal(new Date().toISOString()));
  const [busy, startBusy] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function agregar() {
    setErr(null);
    const iso = panamaLocalToIso(when);
    if (!iso) { setErr("Fecha y hora inválidas."); return; }
    startBusy(async () => {
      const r = await createManualAttendanceEvent({ technician_id: techId, direction: dir, occurred_at: iso });
      if ("error" in r) setErr(r.error);
      else onDone();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-2.5 text-xs">
      <span className="font-semibold text-slate-500">Agregar marca a mano:</span>
      <select value={dir} onChange={(e) => setDir(e.target.value as "in" | "out")} className="rounded border border-slate-200 bg-white px-2 py-1">
        <option value="in">Entrada</option>
        <option value="out">Salida</option>
      </select>
      <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="rounded border border-slate-200 bg-white px-2 py-1" />
      <button type="button" onClick={agregar} disabled={busy} className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
        <Plus className="size-3.5" /> {busy ? "…" : "Agregar"}
      </button>
      {err ? <span className="text-red-600">{err}</span> : null}
    </div>
  );
}

const ALERTA_LABEL: Record<string, string> = {
  fuera_de_sitio: "fuera de sitio", sin_sitio: "sin sitio", pin_sospechoso: "pin sospechoso", hora_dudosa: "hora dudosa",
};
function rank(r: ResumenDia): number {
  if (r.alertas.size > 0 || r.tarde) return 0;
  if (r.estado === "adentro") return 1;
  if (r.estado === "salio") return 2;
  return 3; // sin marca
}

function EstadoChip({ estado }: { estado: string }) {
  if (estado === "adentro") return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700"><LogIn className="size-3" /> Adentro</span>;
  if (estado === "salio") return <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600"><LogOut className="size-3" /> Salió</span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-400"><CircleDashed className="size-3" /> Sin marcar</span>;
}
function Chip({ tone, children }: { tone: "amber" | "rose" | "slate" | "emerald"; children: React.ReactNode }) {
  const c = tone === "amber" ? "bg-amber-100 text-amber-700" : tone === "rose" ? "bg-rose-100 text-rose-700" : tone === "emerald" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500";
  return <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", c)}>{children}</span>;
}

// ── Auditoría ─────────────────────────────────────────────────────────────────
function Auditoria({ audit, nombre }: { audit: AttAudit[]; nombre: Map<string, string> }) {
  if (audit.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-100 bg-white p-8 text-center text-sm text-slate-400 shadow-sm">
        Aún no hay cambios manuales registrados. Cada edición, alta o borrado de una marca queda aquí: quién, qué y cuándo.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">Cambios manuales a marcas</div>
      <ul className="divide-y divide-slate-50">
        {audit.map((a) => {
          const d = describeAudit(a);
          return (
            <li key={a.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3 text-sm">
              <div className="min-w-[120px] text-xs text-slate-400">{fmtFechaHora(a.created_at)}</div>
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={d.tono}>{d.verbo}</Chip>
                  <span className="font-medium text-slate-800">{a.technician_id ? nombre.get(a.technician_id) ?? "Técnico" : "Técnico"}</span>
                  <span className="text-xs text-slate-400">por {a.actor_email ?? "—"}</span>
                </div>
                <div className="mt-0.5 space-y-0.5 text-xs text-slate-500">
                  {d.lineas.map((l, i) => <div key={i}>{l}</div>)}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function describeAudit(a: AttAudit): { verbo: string; tono: "emerald" | "amber" | "rose"; lineas: string[] } {
  const ch = (a.changes ?? {}) as Record<string, unknown>;
  const dir = (d: unknown) => (d === "in" ? "Entrada" : d === "out" ? "Salida" : String(d ?? "—"));
  const when = (v: unknown) => (typeof v === "string" ? fmtFechaHora(v) : "—");
  const pair = (k: string) => ch[k] as { from?: unknown; to?: unknown } | undefined;
  if (a.action === "create") {
    return { verbo: "Creó marca", tono: "emerald", lineas: [`${dir(ch.direction)} · ${when(ch.occurred_at)}`] };
  }
  if (a.action === "delete") {
    return { verbo: "Eliminó marca", tono: "rose", lineas: [`${dir(ch.direction)} · ${when(ch.occurred_at)}`] };
  }
  const lineas: string[] = [];
  const d = pair("direction");
  if (d) lineas.push(`Tipo: ${dir(d.from)} → ${dir(d.to)}`);
  const o = pair("occurred_at");
  if (o) lineas.push(`Hora: ${when(o.from)} → ${when(o.to)}`);
  const n = pair("note");
  if (n) lineas.push(`Nota: “${String(n.from ?? "")}” → “${String(n.to ?? "")}”`);
  return { verbo: "Editó marca", tono: "amber", lineas: lineas.length ? lineas : ["(sin cambios)"] };
}

// ── Configuración ─────────────────────────────────────────────────────────────
const inputCls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none";

function Config({ settings, locs, sites, isPowerUser, powerEmails, rosterWaIds }: { settings: AttSettings | null; locs: AttLoc[]; sites: AttSite[]; isPowerUser: boolean; powerEmails: string[]; rosterWaIds: string[] }) {
  const router = useRouter();
  const [f, setF] = useState<AttendanceSettingsInput>({
    wa_phone_number_id: settings?.wa_phone_number_id ?? null,
    workday_start: settings?.workday_start?.slice(0, 5) ?? "08:00",
    workday_end: settings?.workday_end?.slice(0, 5) ?? "17:00",
    workday_days: settings?.workday_days ?? [1, 2, 3, 4, 5],
    late_after_min: settings?.late_after_min ?? 15,
    require_geofence: settings?.require_geofence ?? false,
  });
  const [editingPhone, setEditingPhone] = useState(!settings?.wa_phone_number_id);
  const [saving, startSave] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const toggleDia = (n: number) =>
    setF((prev) => ({ ...prev, workday_days: prev.workday_days.includes(n) ? prev.workday_days.filter((d) => d !== n) : [...prev.workday_days, n].sort() }));

  function saveConfig() {
    setMsg(null);
    startSave(async () => {
      const r = await saveAttendanceSettings(f);
      if ("error" in r) setMsg(r.error);
      else { setMsg("Guardado ✓"); setEditingPhone(false); router.refresh(); }
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-slate-800">Conexión y horario</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Phone Number ID de WhatsApp" hint="El ID (no el número) que da Meta al conectar. Resuelve la empresa desde el webhook.">
            {editingPhone ? (
              <input className={inputCls} value={f.wa_phone_number_id ?? ""} onChange={(e) => setF({ ...f, wa_phone_number_id: e.target.value || null })} placeholder="106540352242922" autoFocus />
            ) : (
              <div className="flex items-center gap-2">
                <span className="flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-700">{f.wa_phone_number_id || "— sin configurar —"}</span>
                <button type="button" onClick={() => setEditingPhone(true)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                  <Pencil className="size-3.5" /> Editar
                </button>
              </div>
            )}
          </Field>
          <Field label="Exigir geocerca" hint="Si se activa, no registra marcas fuera del sitio (solo avisa al empleado).">
            <label className="flex h-[38px] items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={f.require_geofence} onChange={(e) => setF({ ...f, require_geofence: e.target.checked })} className="size-4 rounded border-slate-300" />
              No registrar marcas fuera del sitio
            </label>
          </Field>
        </div>

        <div className="mt-4">
          <span className="mb-1.5 block text-xs font-semibold text-slate-600">Días laborables</span>
          <div className="flex flex-wrap gap-1.5">
            {DIAS_SEMANA.map(([n, lbl]) => {
              const on = f.workday_days.includes(n);
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => toggleDia(n)}
                  className={cn("rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors", on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50")}
                >
                  {lbl}
                </button>
              );
            })}
          </div>
          <span className="mt-1 block text-[11px] text-slate-400">Se usa para calcular &ldquo;ayer / último día laborable&rdquo;.</span>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Hora de entrada" hint="Con la tolerancia marca el chip de tardanza.">
            <div className="flex items-center gap-2">
              <input type="time" className={inputCls} value={f.workday_start} onChange={(e) => setF({ ...f, workday_start: e.target.value })} />
              <span className="whitespace-nowrap text-xs text-slate-500">+ tol.</span>
              <input type="number" min={0} className={cn(inputCls, "w-20")} value={f.late_after_min} onChange={(e) => setF({ ...f, late_after_min: Number(e.target.value) })} />
              <span className="text-xs text-slate-500">min</span>
            </div>
          </Field>
          <Field label="Hora de salida" hint="Jornada esperada (referencia).">
            <input type="time" className={cn(inputCls, "w-40")} value={f.workday_end} onChange={(e) => setF({ ...f, workday_end: e.target.value })} />
          </Field>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button type="button" onClick={saveConfig} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
            <Save className="size-4" /> {saving ? "Guardando…" : "Guardar configuración"}
          </button>
          {msg ? <span className={cn("text-xs", msg.startsWith("Guardado") ? "text-emerald-600" : "text-red-600")}>{msg}</span> : null}
        </div>
      </div>

      <SitiosPropios sites={sites} />

      {locs.length > 0 ? (
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <p className="mb-1 text-sm font-semibold text-slate-800">Sitios de clientes</p>
          <p className="mb-3 text-xs text-slate-500">Geocerca también los sitios de tus clientes (se administran en Clientes). Pega el link de Google Maps o &ldquo;lat, lng&rdquo; y el radio.</p>
          <ul className="divide-y divide-slate-100">
            {locs.map((l) => <GeocercaRow key={l.id} loc={l} />)}
          </ul>
        </div>
      ) : null}

      {isPowerUser ? <PowerUsersCard emails={powerEmails} /> : null}
      {isPowerUser ? <RosterWaCard numeros={rosterWaIds} /> : null}
    </div>
  );
}

// Power users: emails que pueden editar/borrar/crear marcas a mano.
function PowerUsersCard({ emails }: { emails: string[] }) {
  const router = useRouter();
  const [list, setList] = useState<string[]>(emails);
  const [nuevo, setNuevo] = useState("");
  const [busy, startBusy] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function persist(next: string[]) {
    setMsg(null);
    startBusy(async () => {
      const r = await savePowerUsers(next);
      if ("error" in r) setMsg(r.error);
      else { setList(next); setMsg("Guardado ✓"); router.refresh(); }
    });
  }
  function add() {
    const e = nuevo.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { setMsg("Email inválido."); return; }
    if (list.includes(e)) { setNuevo(""); return; }
    persist([...list, e]);
    setNuevo("");
  }

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-800"><ShieldCheck className="size-4 text-slate-500" /> Power users</p>
      <p className="mb-3 text-xs text-slate-500">Estos correos pueden editar, borrar y agregar marcas a mano desde el tablero. Todo cambio queda en Auditoría.</p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className={cn(inputCls, "min-w-[220px] flex-1")}
          value={nuevo}
          onChange={(e) => setNuevo(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="correo@dicecpanama.com"
        />
        <button type="button" onClick={add} disabled={busy} className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
          <Plus className="size-3.5" /> {busy ? "…" : "Agregar"}
        </button>
        {msg ? <span className={cn("text-xs", msg.startsWith("Guardado") ? "text-emerald-600" : "text-red-600")}>{msg}</span> : null}
      </div>
      {list.length === 0 ? (
        <p className="py-2 text-xs text-slate-400">Sin power users configurados — por ahora solo el dueño/admin puede editar marcas.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {list.map((e) => (
            <li key={e} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
              {e}
              <button type="button" onClick={() => persist(list.filter((x) => x !== e))} disabled={busy} className="text-slate-400 hover:text-red-600" title="Quitar"><X className="size-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GeocercaRow({ loc }: { loc: AttLoc }) {
  const router = useRouter();
  const [link, setLink] = useState(loc.lat != null ? `${loc.lat}, ${loc.lng}` : "");
  const [radius, setRadius] = useState(loc.radius);
  const [saving, startSave] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const puesto = loc.lat != null && loc.lng != null;

  function save() {
    setErr(null);
    startSave(async () => {
      let coords: { lat: number; lng: number } | null = null;
      if (link.trim()) {
        const r = await resolveCoords(link);
        if ("error" in r) { setErr(r.error); return; }
        coords = r;
      }
      const res = await setLocationGeofence(loc.id, { lat: coords?.lat ?? null, lng: coords?.lng ?? null, radius });
      if ("error" in res) setErr(res.error);
      else router.refresh();
    });
  }

  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[160px] flex-1">
          <p className="truncate text-sm font-medium text-slate-800">{loc.name}</p>
          <p className="truncate text-[11px] text-slate-400">{loc.clientName}</p>
        </div>
        <input className={cn(inputCls, "min-w-[200px] flex-[2]")} value={link} onChange={(e) => setLink(e.target.value)} placeholder="link de Google Maps o 8.98, -79.5" />
        <input type="number" min={20} className={cn(inputCls, "w-20")} value={radius} onChange={(e) => setRadius(Number(e.target.value))} title="Radio (m)" />
        <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50">
          {saving ? "…" : "Guardar"}
        </button>
        {puesto ? (
          <a href={`https://maps.google.com/?q=${loc.lat},${loc.lng}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline" title="Ver en el mapa">
            <MapPin className="size-3.5" /><ExternalLink className="size-3" />
          </a>
        ) : <span className="inline-flex items-center gap-1 text-[11px] text-slate-400"><AlertTriangle className="size-3" /> sin coords</span>}
      </div>
      {err ? <p className="mt-1 text-[11px] text-red-600">{err}</p> : null}
    </li>
  );
}

// ── Sitios de asistencia propios (agregar / editar / eliminar) ────────────────
function SitiosPropios({ sites }: { sites: AttSite[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [link, setLink] = useState("");
  const [radius, setRadius] = useState(150);
  const [adding, startAdd] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function agregar() {
    setErr(null);
    if (!name.trim()) { setErr("Ponle un nombre al sitio."); return; }
    startAdd(async () => {
      let coords: { lat: number; lng: number } | null = null;
      if (link.trim()) {
        const r = await resolveCoords(link);
        if ("error" in r) { setErr(r.error); return; }
        coords = r;
      }
      const res = await createAttendanceSite({ name: name.trim(), lat: coords?.lat ?? null, lng: coords?.lng ?? null, radius });
      if ("error" in res) setErr(res.error);
      else { setName(""); setLink(""); setRadius(150); router.refresh(); }
    });
  }

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <p className="mb-1 text-sm font-semibold text-slate-800">Sitios de asistencia</p>
      <p className="mb-3 text-xs text-slate-500">Agrega los lugares donde marca el personal (incluida tu sede). Pega el link de Google Maps —también el corto de compartir— o &ldquo;lat, lng&rdquo; y el radio en metros.</p>

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-2.5">
        <input className={cn(inputCls, "min-w-[140px] flex-1")} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre (ej. Hospital Nacional)" />
        <input className={cn(inputCls, "min-w-[200px] flex-[2]")} value={link} onChange={(e) => setLink(e.target.value)} placeholder="link de Google Maps o 8.98, -79.5" />
        <input type="number" min={20} className={cn(inputCls, "w-20")} value={radius} onChange={(e) => setRadius(Number(e.target.value))} title="Radio (m)" />
        <button type="button" onClick={agregar} disabled={adding} className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
          <Plus className="size-3.5" /> {adding ? "…" : "Agregar"}
        </button>
      </div>
      {err ? <p className="mb-2 text-[11px] text-red-600">{err}</p> : null}

      {sites.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">Aún no hay sitios. Agrega el primero arriba.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {sites.map((s) => <SitioPropioRow key={s.id} site={s} />)}
        </ul>
      )}
    </div>
  );
}

function SitioPropioRow({ site }: { site: AttSite }) {
  const router = useRouter();
  const [name, setName] = useState(site.name);
  const [link, setLink] = useState(site.lat != null ? `${site.lat}, ${site.lng}` : "");
  const [radius, setRadius] = useState(site.radius);
  const [busy, startBusy] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const puesto = site.lat != null && site.lng != null;

  function guardar() {
    setErr(null);
    if (!name.trim()) { setErr("El nombre no puede quedar vacío."); return; }
    startBusy(async () => {
      let coords: { lat: number; lng: number } | null = null;
      if (link.trim()) {
        const r = await resolveCoords(link);
        if ("error" in r) { setErr(r.error); return; }
        coords = r;
      }
      const res = await updateAttendanceSite(site.id, { name: name.trim(), lat: coords?.lat ?? null, lng: coords?.lng ?? null, radius });
      if ("error" in res) setErr(res.error);
      else router.refresh();
    });
  }
  function eliminar() {
    if (!confirm(`¿Eliminar el sitio "${site.name}"?`)) return;
    setErr(null);
    startBusy(async () => {
      const r = await deleteAttendanceSite(site.id);
      if ("error" in r) setErr(r.error);
      else router.refresh();
    });
  }

  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <input className={cn(inputCls, "min-w-[140px] flex-1")} value={name} onChange={(e) => setName(e.target.value)} />
        <input className={cn(inputCls, "min-w-[200px] flex-[2]")} value={link} onChange={(e) => setLink(e.target.value)} placeholder="link de Google Maps o 8.98, -79.5" />
        <input type="number" min={20} className={cn(inputCls, "w-20")} value={radius} onChange={(e) => setRadius(Number(e.target.value))} title="Radio (m)" />
        <button type="button" onClick={guardar} disabled={busy} className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50">{busy ? "…" : "Guardar"}</button>
        {puesto ? (
          <a href={`https://maps.google.com/?q=${site.lat},${site.lng}`} target="_blank" rel="noreferrer" className="inline-flex items-center text-xs font-semibold text-blue-600 hover:underline" title="Ver en el mapa"><MapPin className="size-3.5" /></a>
        ) : <span className="inline-flex items-center gap-1 text-[11px] text-slate-400"><AlertTriangle className="size-3" /> sin coords</span>}
        <button type="button" onClick={eliminar} disabled={busy} className="inline-flex items-center rounded-lg px-2 py-2 text-red-500 hover:bg-red-50" title="Eliminar"><Trash2 className="size-3.5" /></button>
      </div>
      {err ? <p className="mt-1 text-[11px] text-red-600">{err}</p> : null}
    </li>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-slate-400">{hint}</span> : null}
    </label>
  );
}

// ── Export CSV (cliente) — exporta la vista/período actual ─────────────────────
function exportCsv(events: AttEventRow[], nombre: Map<string, string>, locName: Map<string, string>, period: string) {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = [["Fecha", "Hora", "Tecnico", "Marca", "Sitio", "Distancia_m", "Estado"].join(",")];
  for (const e of events) {
    const d = new Date(e.occurred_at);
    const fecha = new Intl.DateTimeFormat("es-PA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Panama" }).format(d);
    const sitio = e.matched_name ?? (e.matched_hq ? "Sede" : e.matched_location_id ? locName.get(e.matched_location_id) ?? "" : "");
    rows.push([
      esc(fecha), esc(fmtHora(d)), esc(nombre.get(e.technician_id) ?? ""), e.direction === "in" ? "Entrada" : "Salida",
      esc(sitio), e.distance_m ?? "", esc(e.status),
    ].join(","));
  }
  const blob = new Blob(["﻿" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `asistencia-${period}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Cuadro de asistencia: personal × días ────────────────────────────────────
// Esta es la vista principal. Se llena sola con el mensaje de programación que
// se le reenvía al bot (marca presente + proyecto), y las marcas de ubicación
// por WhatsApp quedan de RESPALDO: si alguien mandó su ubicación ese día, la
// celda lo muestra con un punto, aunque nadie haya tocado nada.
//
// Todos asisten por defecto: solo se guarda fila cuando hay algo que decir.
function PlanillaTab({
  techs,
  planilla,
  desdeKey,
  hastaKey,
  workdays,
  events,
  singleDay,
  onVerMarcas,
}: {
  techs: AttTech[];
  planilla: AttDia[];
  desdeKey: string;
  hastaKey: string;
  workdays: number[];
  events: AttEventRow[];
  singleDay: boolean;
  onVerMarcas: () => void;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<{ techId: string; dia: string; campo: "project_no" | "site_label" } | null>(null);
  const [borrador, setBorrador] = useState("");

  const dias = useMemo(() => diasEntre(desdeKey, hastaKey), [desdeKey, hastaKey]);
  // Lugares distintos de cada día: en la vista de varios días van en el
  // encabezado, no repetidos en cada celda.
  const lugaresPorDia = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of planilla) {
      if (!r.present || !r.site_label) continue;
      const l = m.get(r.day) ?? [];
      if (!l.includes(r.site_label)) l.push(r.site_label);
      m.set(r.day, l);
    }
    return m;
  }, [planilla]);
  const porClave = useMemo(() => new Map(planilla.map((r) => [`${r.technician_id}|${r.day}`, r])), [planilla]);
  // Marcas de ubicación: respaldo. Solo interesa SI hubo marca ese día.
  const conMarca = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) set.add(`${e.technician_id}|${panamaDayKey(e.occurred_at)}`);
    return set;
  }, [events]);

  function guardar(techId: string, dia: string, patch: { present?: boolean; project_no?: string | null; site_label?: string | null }) {
    setError(null);
    startTransition(async () => {
      const r = await setPlanillaDia(techId, dia, patch);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  const { totalPresentes, totalExtra } = useMemo(() => {
    let presentes = 0;
    let extra = 0;
    for (const d of dias) {
      const laboral = workdays.includes(new Date(d + "T12:00:00Z").getUTCDay());
      for (const t of techs) {
        const fila = porClave.get(`${t.id}|${d}`);
        const presente = fila ? fila.present : laboral;
        if (!presente) continue;
        presentes++;
        if (!laboral) extra++;
      }
    }
    return { totalPresentes: presentes, totalExtra: extra };
  }, [dias, techs, porClave, workdays]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Asistencia por día</h2>
          <p className="text-xs text-slate-500">
            Se llena sola con la programación que reenvías al WhatsApp. Todos asisten por defecto — haz clic para marcar una
            falta, o en el proyecto para cambiarlo. {totalPresentes} asistencias en el período
            {totalExtra > 0 ? (
              <>
                , <b className="text-amber-600">{totalExtra} en día no laborable</b> (tiempo extra)
              </>
            ) : null}
            .
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pendiente ? <span className="text-xs text-slate-400">Guardando…</span> : null}
          <button type="button" onClick={onVerMarcas} className="text-xs font-semibold text-slate-400 hover:text-slate-600">
            Ver marcas de ubicación
          </button>
        </div>
      </div>

      {error ? <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}

      <div className="overflow-x-auto">
        <table className="border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white px-2 py-2 text-left text-[11px] uppercase tracking-wider text-slate-500">
                Persona
              </th>
              {dias.map((d) => {
                const dow = new Date(d + "T12:00:00Z").getUTCDay();
                const laboral = workdays.includes(dow);
                return (
                  <th
                    key={d}
                    className={cn(
                      "px-1 py-2 align-top text-center text-[10px] font-semibold",
                      laboral ? "text-slate-500" : "bg-slate-50 text-slate-300",
                    )}
                  >
                    <div>{DOW_CORTO[dow]}</div>
                    <div className="tabular-nums">{d.slice(8)}</div>
                    {!singleDay && lugaresPorDia.get(d)?.length ? (
                      <div className="mt-1 space-y-px font-normal">
                        {lugaresPorDia.get(d)!.map((l) => (
                          <div key={l} className="truncate text-[9px] leading-tight text-slate-400" title={l}>
                            {l}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {techs.map((t) => (
              <tr key={t.id} className="border-t border-slate-50">
                <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-2 py-1.5 text-xs font-medium text-slate-700">
                  {t.name}
                </td>
                {dias.map((d) => {
                  const fila = porClave.get(`${t.id}|${d}`);
                  const dow = new Date(d + "T12:00:00Z").getUTCDay();
                  const laboral = workdays.includes(dow);
                  // Sin fila guardada, el default depende del día: en laborable
                  // se asiste, en fin de semana no.
                  const presente = fila ? fila.present : laboral;
                  const extra = presente && !laboral; // trabajo fuera de jornada
                  const marca = conMarca.has(`${t.id}|${d}`);
                  const enEdicion = editando?.techId === t.id && editando?.dia === d;
                  return (
                    <td key={d} className={cn("w-24 min-w-24 px-1 py-1 text-center align-top", !laboral && "bg-slate-50/60")}>
                      <button
                        type="button"
                        onClick={() => guardar(t.id, d, { present: !presente })}
                        title={`${t.name} · ${d}${extra ? " · TRABAJO EXTRA (día no laborable)" : ""}${fila?.project_no ? ` · ${fila.project_no}` : ""}${marca ? " · marcó ubicación" : ""}`}
                        className={cn(
                          "relative mx-auto flex size-6 items-center justify-center rounded-md ring-1 ring-inset transition-colors",
                          !presente
                            ? "bg-white text-transparent ring-slate-300 hover:bg-slate-50"
                            : extra
                              ? "bg-amber-500 text-white ring-amber-600/30 hover:bg-amber-600"
                              : "bg-emerald-500 text-white ring-emerald-600/20 hover:bg-emerald-600",
                        )}
                      >
                        <Check className="size-3.5" strokeWidth={3} />
                        {marca ? (
                          <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-sky-500 ring-1 ring-white" />
                        ) : null}
                      </button>
                      {presente ? (
                        <div className="mt-0.5 space-y-px">
                          {(singleDay ? (["project_no", "site_label"] as const) : (["project_no"] as const)).map((campo) => {
                            const valor = campo === "project_no" ? fila?.project_no : fila?.site_label;
                            if (enEdicion && editando?.campo === campo) {
                              return (
                                <input
                                  key={campo}
                                  autoFocus
                                  value={borrador}
                                  onChange={(e) => setBorrador(campo === "project_no" ? e.target.value.toUpperCase() : e.target.value)}
                                  onBlur={() => {
                                    const v = borrador.trim();
                                    if (v !== (valor ?? "")) guardar(t.id, d, { [campo]: v || null });
                                    setEditando(null);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") e.currentTarget.blur();
                                    if (e.key === "Escape") setEditando(null);
                                  }}
                                  className="w-full rounded border border-slate-300 px-1 py-0.5 text-[10px] outline-none"
                                />
                              );
                            }
                            return (
                              <button
                                key={campo}
                                type="button"
                                onClick={() => {
                                  setBorrador(valor ?? "");
                                  setEditando({ techId: t.id, dia: d, campo });
                                }}
                                title={valor ?? (campo === "project_no" ? "Asignar proyecto" : "Asignar lugar")}
                                className={cn(
                                  "block w-full truncate text-[9px] leading-tight hover:underline",
                                  campo === "project_no"
                                    ? valor
                                      ? "font-semibold text-slate-700"
                                      : "text-slate-300"
                                    : valor
                                      ? "text-slate-500"
                                      : "text-slate-200",
                                )}
                              >
                                {valor ?? "—"}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] text-slate-400">
        <span className="mr-1 inline-block size-1.5 rounded-full bg-sky-500 align-middle" />
        En cada celda: arriba el <b>proyecto</b>, abajo el <b>lugar</b> — ambos se llenan del mensaje y se editan con un clic.
        Sábados y domingos arrancan <b>sin asistir</b>; si alguien trabajó, márcalo y el check sale{" "}
        <span className="font-semibold text-amber-600">ámbar</span> para contarlo como tiempo extra.
        El punto azul indica que esa persona mandó su ubicación por WhatsApp ese día.
      </p>
    </div>
  );
}

const DOW_CORTO = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

// Días (YYYY-MM-DD) entre dos fechas, inclusive. Tope defensivo: un rango
// enorme no debe pintar cientos de columnas.
function diasEntre(desde: string, hasta: string): string[] {
  const out: string[] = [];
  const d = new Date(desde + "T12:00:00Z");
  const fin = new Date(hasta + "T12:00:00Z");
  while (d <= fin && out.length < 62) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

// Números de WhatsApp que pueden reenviarle al bot la programación del día.
// Va restringido porque ese mensaje marca la asistencia de OTRAS personas.
function RosterWaCard({ numeros }: { numeros: string[] }) {
  const router = useRouter();
  const [txt, setTxt] = useState(numeros.join("\n"));
  const [saving, startSave] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function guardar() {
    setMsg(null);
    startSave(async () => {
      const r = await saveRosterWaIds(txt.split(/[\n,;]+/));
      setMsg("error" in r ? r.error : "Guardado");
      if (!("error" in r)) router.refresh();
    });
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">Quién puede mandar la programación del día</h3>
      <p className="mt-1 text-xs text-slate-500">
        Reenviándole al bot el mensaje de programación, estos números marcan presentes a los mencionados y les asignan su
        proyecto. Un número por línea, con código de país (ej. 50761234567). <b>Si la lista está vacía, nadie puede.</b>
      </p>
      <textarea
        rows={3}
        value={txt}
        onChange={(e) => setTxt(e.target.value)}
        placeholder="50761234567"
        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs outline-none focus:border-slate-900"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={guardar}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          <Save className="size-3.5" /> Guardar
        </button>
        {msg ? <span className="text-xs text-slate-500">{msg}</span> : null}
      </div>
    </div>
  );
}
