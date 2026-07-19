"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, MapPin, Clock, Users, Settings2, Download, AlertTriangle, LogIn, LogOut, CircleDashed, ExternalLink, Save, Plus, Trash2, Pencil, ShieldCheck, ScrollText, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { pairShifts, sumShiftMs, panamaDayKey, parseLatLng, fmtHora, fmtDuracion, type AttEvent } from "@/lib/whatsapp/attendance-core";
import {
  saveAttendanceSettings, setLocationGeofence, resolveMapsLink,
  createAttendanceSite, updateAttendanceSite, deleteAttendanceSite,
  savePowerUsers, updateAttendanceEvent, deleteAttendanceEvent, createManualAttendanceEvent,
  type AttendanceSettingsInput,
} from "./actions";

export type AttSettings = {
  wa_phone_number_id: string | null;
  workday_start: string;
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
const fmtFechaHora = (iso: string) =>
  new Intl.DateTimeFormat("es-PA", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Panama" }).format(new Date(iso));
const fmtMes = (yyyymm: string) =>
  new Intl.DateTimeFormat("es-PA", { month: "long", year: "numeric", timeZone: "America/Panama" }).format(new Date(yyyymm + "-15T12:00:00Z"));
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

const RANGO_LABEL: Record<string, string> = { "30d": "30 días", "3m": "3 meses", "6m": "6 meses", "12m": "12 meses" };

export function AsistenciaScreen({
  settings, techs, locs, sites, events, audit, isPowerUser, powerEmails, migracionPendiente, rango, truncado,
}: {
  settings: AttSettings | null;
  techs: AttTech[];
  locs: AttLoc[];
  sites: AttSite[];
  events: AttEventRow[];
  audit: AttAudit[];
  isPowerUser: boolean;
  powerEmails: string[];
  migracionPendiente: boolean;
  rango: string;
  truncado: boolean;
}) {
  const [tab, setTab] = useState<"hoy" | "historial" | "config" | "auditoria">("hoy");
  const activos = techs.filter((t) => t.active);
  const nombre = useMemo(() => new Map(techs.map((t) => [t.id, t.name])), [techs]);
  const locName = useMemo(() => new Map(locs.map((l) => [l.id, l.name])), [locs]);
  const sinWa = activos.filter((t) => !t.wa_id);

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
  const hoyKey = panamaDayKey(new Date().toISOString());

  const filaSitio = (evId: string | undefined) => {
    if (!evId) return null;
    const e = eventoById.get(evId);
    if (!e) return null;
    const site = e.matched_name ?? (e.matched_hq ? "Sede" : e.matched_location_id ? locName.get(e.matched_location_id) ?? "Sitio" : null);
    return { site, dist: e.distance_m, status: e.status };
  };

  const tabs: [string, string, React.ComponentType<{ className?: string }>][] = [
    ["hoy", "Hoy", Clock],
    ["historial", "Historial", Users],
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
          onClick={() => exportCsv(events, nombre, locName, rango)}
          disabled={events.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          title={`Descargar CSV de los últimos ${RANGO_LABEL[rango]}`}
        >
          <Download className="size-4" /> Exportar {RANGO_LABEL[rango]}
        </button>
      </header>

      {/* Período de historial y exportación (el tablero Hoy no cambia). */}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="font-semibold uppercase tracking-wider">Período</span>
        <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5">
          {Object.keys(RANGO_LABEL).map((k) => (
            <Link
              key={k}
              href={`/personal/asistencia?rango=${k}`}
              scroll={false}
              className={cn("rounded-md px-2.5 py-1 font-semibold transition-colors", rango === k ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}
            >
              {RANGO_LABEL[k]}
            </Link>
          ))}
        </div>
        <span className="text-slate-400">· historial y exportación</span>
        {truncado ? <span className="text-amber-600">· mostrando el máximo (50.000 marcas); acota el período para verlo completo</span> : null}
      </div>

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
        {tabs.map(([k, label, Icon]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k as typeof tab)}
            className={cn("inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 transition-colors", tab === k ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>

      {tab === "hoy" ? (
        <TableroHoy activos={activos} porTech={porTech} hoyKey={hoyKey} filaSitio={filaSitio} lateThreshold={lateThreshold} />
      ) : tab === "historial" ? (
        <Historial activos={activos} porTech={porTech} filaSitio={filaSitio} isPowerUser={isPowerUser} />
      ) : tab === "config" ? (
        <Config settings={settings} locs={locs} sites={sites} isPowerUser={isPowerUser} powerEmails={powerEmails} />
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

// ── Tablero HOY ───────────────────────────────────────────────────────────────
type FilaSitio = (evId: string | undefined) => { site: string | null; dist: number | null; status: string } | null;

function TableroHoy({
  activos, porTech, hoyKey, filaSitio, lateThreshold,
}: {
  activos: AttTech[];
  porTech: Map<string, AttEvent[]>;
  hoyKey: string;
  filaSitio: FilaSitio;
  lateThreshold: number;
}) {
  const filas = activos.map((t) => {
    const hoy = (porTech.get(t.id) ?? []).filter((e) => panamaDayKey(e.occurred_at) === hoyKey);
    const shifts = pairShifts(hoy);
    const primeraIn = hoy.find((e) => e.direction === "in");
    const ultimaOut = [...hoy].reverse().find((e) => e.direction === "out");
    const abierto = shifts.find((s) => s.in && !s.out);
    let ms = sumShiftMs(shifts);
    if (abierto?.in) ms += Date.now() - +new Date(abierto.in.occurred_at);
    const estado = hoy.length === 0 ? "sin" : abierto ? "adentro" : "salio";
    const tarde = primeraIn ? panamaMinutes(primeraIn.occurred_at) > lateThreshold : false;
    const alertas = new Set(hoy.map((e) => e.status).filter((s): s is string => !!s && s !== "ok" && s !== "corregido"));
    return { t, estado, primeraIn, ultimaOut, ms, tarde, alertas, tieneMarca: hoy.length > 0 };
  });
  // Anomalías / adentro primero.
  filas.sort((a, b) => rank(a) - rank(b) || a.t.name.localeCompare(b.t.name));

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
              <th className="px-3 py-2.5 font-semibold">Técnico</th>
              <th className="px-3 py-2.5 font-semibold">Estado</th>
              <th className="px-3 py-2.5 font-semibold">Entrada</th>
              <th className="px-3 py-2.5 font-semibold">Salida</th>
              <th className="px-3 py-2.5 font-semibold">Horas</th>
              <th className="px-3 py-2.5 font-semibold">Alertas</th>
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-sm text-slate-400">Sin técnicos activos.</td></tr>
            ) : (
              filas.map(({ t, estado, primeraIn, ultimaOut, ms, tarde, alertas, tieneMarca }) => {
                const inSitio = filaSitio(primeraIn?.id);
                const outSitio = filaSitio(ultimaOut?.id);
                return (
                  <tr key={t.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-3 py-2.5 font-medium text-slate-900">{t.name}</td>
                    <td className="px-3 py-2.5"><EstadoChip estado={estado} /></td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">
                      {primeraIn ? (
                        <div>
                          <span className={cn("tabular-nums", tarde && "font-semibold text-amber-700")}>{fmtHora(new Date(primeraIn.occurred_at))}</span>
                          {inSitio?.site ? <span className="block text-[11px] text-slate-400">{inSitio.site}{inSitio.dist != null ? ` · ${inSitio.dist} m` : ""}</span> : null}
                        </div>
                      ) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">
                      {ultimaOut ? (
                        <div>
                          <span className="tabular-nums">{fmtHora(new Date(ultimaOut.occurred_at))}</span>
                          {outSitio?.site ? <span className="block text-[11px] text-slate-400">{outSitio.site}{outSitio.dist != null ? ` · ${outSitio.dist} m` : ""}</span> : null}
                        </div>
                      ) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-slate-700">{tieneMarca && ms > 0 ? fmtDuracion(ms) : "—"}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {tarde ? <Chip tone="amber">tardanza</Chip> : null}
                        {[...alertas].map((a) => <Chip key={a} tone={a === "fuera_de_sitio" ? "amber" : "rose"}>{ALERTA_LABEL[a] ?? a}</Chip>)}
                        {estado === "adentro" ? <Chip tone="slate">sin salida</Chip> : null}
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

const ALERTA_LABEL: Record<string, string> = {
  fuera_de_sitio: "fuera de sitio", sin_sitio: "sin sitio", pin_sospechoso: "pin sospechoso", hora_dudosa: "hora dudosa",
};
function rank(f: { estado: string; tarde: boolean; alertas: Set<string> }): number {
  if (f.alertas.size > 0 || f.tarde) return 0;
  if (f.estado === "adentro") return 1;
  if (f.estado === "salio") return 2;
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

// ── Historial ─────────────────────────────────────────────────────────────────
function Historial({ activos, porTech, filaSitio, isPowerUser }: { activos: AttTech[]; porTech: Map<string, AttEvent[]>; filaSitio: FilaSitio; isPowerUser: boolean }) {
  const router = useRouter();
  const [techId, setTechId] = useState(activos[0]?.id ?? "");
  const [modoEdicion, setModoEdicion] = useState(false);
  const eventos = porTech.get(techId) ?? [];
  const refrescar = () => router.refresh();

  // Agrupar por día Panamá (desc).
  const dias = useMemo(() => {
    const m = new Map<string, AttEvent[]>();
    for (const e of eventos) {
      const k = panamaDayKey(e.occurred_at);
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [eventos]);

  // Resumen por mes (días trabajados + horas): para ver 12 meses de un vistazo.
  const meses = useMemo(() => {
    const m = new Map<string, { horasMs: number; dias: number }>();
    for (const [dia, evs] of dias) {
      const ms = sumShiftMs(pairShifts([...evs].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))));
      const cur = m.get(dia.slice(0, 7)) ?? { horasMs: 0, dias: 0 };
      cur.horasMs += ms;
      cur.dias += 1; // día con al menos una marca
      m.set(dia.slice(0, 7), cur);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [dias]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <select value={techId} onChange={(e) => setTechId(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
          {activos.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
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

      {modoEdicion && techId ? <AgregarMarca techId={techId} onDone={refrescar} /> : null}

      {meses.length > 1 ? (
        <div className="overflow-hidden rounded-xl border border-slate-100 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-400">
                <th className="px-3 py-2 font-semibold">Mes</th>
                <th className="px-3 py-2 text-right font-semibold">Días marcados</th>
                <th className="px-3 py-2 text-right font-semibold">Horas</th>
              </tr>
            </thead>
            <tbody>
              {meses.map(([mes, r]) => (
                <tr key={mes} className="border-b border-slate-50 last:border-0">
                  <td className="px-3 py-2 capitalize text-slate-700">{fmtMes(mes)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{r.dias}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-700">{r.horasMs > 0 ? fmtDuracion(r.horasMs) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {dias.length > 0 ? <p className="px-1 pt-1 text-xs font-semibold uppercase tracking-wider text-slate-400">Detalle por día</p> : null}
      {dias.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">Sin marcas en este período.</p>
      ) : (
        dias.map(([dia, evs]) => {
          const ordenados = [...evs].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
          const shifts = pairShifts(ordenados);
          const total = sumShiftMs(shifts);
          return (
            <div key={dia} className="rounded-xl border border-slate-100 bg-white p-3.5">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-800">{fmtFecha(dia + "T12:00:00Z")}</p>
                <p className="text-xs font-semibold tabular-nums text-slate-500">{total > 0 ? fmtDuracion(total) : "—"}</p>
              </div>
              {modoEdicion ? (
                <div className="space-y-1.5">
                  {ordenados.map((ev) => <MarcaRow key={ev.id} ev={ev} onDone={refrescar} />)}
                </div>
              ) : (
                <div className="space-y-1">
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
              )}
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
function AgregarMarca({ techId, onDone }: { techId: string; onDone: () => void }) {
  const [dir, setDir] = useState<"in" | "out">("in");
  const [when, setWhen] = useState(isoToPanamaLocal(new Date().toISOString()));
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

function Config({ settings, locs, sites, isPowerUser, powerEmails }: { settings: AttSettings | null; locs: AttLoc[]; sites: AttSite[]; isPowerUser: boolean; powerEmails: string[] }) {
  const router = useRouter();
  const [f, setF] = useState<AttendanceSettingsInput>({
    wa_phone_number_id: settings?.wa_phone_number_id ?? null,
    workday_start: settings?.workday_start?.slice(0, 5) ?? "08:00",
    late_after_min: settings?.late_after_min ?? 15,
    require_geofence: settings?.require_geofence ?? false,
  });
  const [editingPhone, setEditingPhone] = useState(!settings?.wa_phone_number_id);
  const [saving, startSave] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

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
          <Field label="Hora de entrada esperada" hint="Para el chip de tardanza.">
            <div className="flex items-center gap-2">
              <input type="time" className={inputCls} value={f.workday_start} onChange={(e) => setF({ ...f, workday_start: e.target.value })} />
              <span className="whitespace-nowrap text-xs text-slate-500">+ tolerancia</span>
              <input type="number" min={0} className={cn(inputCls, "w-20")} value={f.late_after_min} onChange={(e) => setF({ ...f, late_after_min: Number(e.target.value) })} />
              <span className="text-xs text-slate-500">min</span>
            </div>
          </Field>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={f.require_geofence} onChange={(e) => setF({ ...f, require_geofence: e.target.checked })} className="size-4 rounded border-slate-300" />
          Exigir geocerca (no registrar marcas fuera del sitio, solo avisar al empleado)
        </label>
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
      <p className="mb-3 text-xs text-slate-500">Estos correos pueden editar, borrar y agregar marcas a mano desde el Historial. Todo cambio queda en Auditoría.</p>
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

// ── Export CSV (cliente) ──────────────────────────────────────────────────────
function exportCsv(events: AttEventRow[], nombre: Map<string, string>, locName: Map<string, string>, rango: string) {
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
  a.download = `asistencia-${rango}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
