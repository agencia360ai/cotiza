"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, MapPin, Clock, Users, Settings2, Download, AlertTriangle, CheckCircle2, LogIn, LogOut, CircleDashed, ExternalLink, Save,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { pairShifts, sumShiftMs, panamaDayKey, parseLatLng, fmtHora, fmtDuracion, type AttEvent } from "@/lib/whatsapp/attendance-core";
import { saveAttendanceSettings, setLocationGeofence, type AttendanceSettingsInput } from "./actions";

export type AttSettings = {
  wa_phone_number_id: string | null;
  hq_name: string | null;
  hq_lat: number | null;
  hq_lng: number | null;
  hq_radius_m: number;
  workday_start: string;
  late_after_min: number;
  require_geofence: boolean;
};
export type AttTech = { id: string; name: string; phone: string | null; wa_id: string | null; active: boolean };
export type AttLoc = { id: string; name: string; clientName: string; lat: number | null; lng: number | null; radius: number };
export type AttEventRow = {
  id: string;
  technician_id: string;
  direction: "in" | "out";
  occurred_at: string;
  status: string;
  distance_m: number | null;
  matched_location_id: string | null;
  matched_hq: boolean;
  wa_location_name: string | null;
};

const fmtFecha = (iso: string) =>
  new Intl.DateTimeFormat("es-PA", { day: "2-digit", month: "short", timeZone: "America/Panama" }).format(new Date(iso));
const fmtMes = (yyyymm: string) =>
  new Intl.DateTimeFormat("es-PA", { month: "long", year: "numeric", timeZone: "America/Panama" }).format(new Date(yyyymm + "-15T12:00:00Z"));
const panamaMinutes = (iso: string) => {
  const d = new Date(new Date(iso).getTime() - 5 * 3600_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};

const RANGO_LABEL: Record<string, string> = { "30d": "30 días", "3m": "3 meses", "6m": "6 meses", "12m": "12 meses" };

export function AsistenciaScreen({
  settings, techs, locs, events, migracionPendiente, rango, truncado,
}: {
  settings: AttSettings | null;
  techs: AttTech[];
  locs: AttLoc[];
  events: AttEventRow[];
  migracionPendiente: boolean;
  rango: string;
  truncado: boolean;
}) {
  const [tab, setTab] = useState<"hoy" | "historial" | "config">("hoy");
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
    const site = e.matched_hq ? "Sede" : e.matched_location_id ? locName.get(e.matched_location_id) ?? "Sitio" : null;
    return { site, dist: e.distance_m, status: e.status };
  };

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
        {([["hoy", "Hoy", Clock], ["historial", "Historial", Users], ["config", "Configuración", Settings2]] as const).map(([k, label, Icon]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cn("inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 transition-colors", tab === k ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>

      {tab === "hoy" ? (
        <TableroHoy activos={activos} porTech={porTech} hoyKey={hoyKey} filaSitio={filaSitio} lateThreshold={lateThreshold} />
      ) : tab === "historial" ? (
        <Historial activos={activos} porTech={porTech} filaSitio={filaSitio} />
      ) : (
        <Config settings={settings} locs={locs} />
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
function Chip({ tone, children }: { tone: "amber" | "rose" | "slate"; children: React.ReactNode }) {
  const c = tone === "amber" ? "bg-amber-100 text-amber-700" : tone === "rose" ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-500";
  return <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", c)}>{children}</span>;
}

// ── Historial ─────────────────────────────────────────────────────────────────
function Historial({ activos, porTech, filaSitio }: { activos: AttTech[]; porTech: Map<string, AttEvent[]>; filaSitio: FilaSitio }) {
  const [techId, setTechId] = useState(activos[0]?.id ?? "");
  const eventos = porTech.get(techId) ?? [];
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
      <select value={techId} onChange={(e) => setTechId(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
        {activos.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>

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
          const shifts = pairShifts([...evs].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)));
          const total = sumShiftMs(shifts);
          return (
            <div key={dia} className="rounded-xl border border-slate-100 bg-white p-3.5">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-800">{fmtFecha(dia + "T12:00:00Z")}</p>
                <p className="text-xs font-semibold tabular-nums text-slate-500">{total > 0 ? fmtDuracion(total) : "—"}</p>
              </div>
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
            </div>
          );
        })
      )}
    </div>
  );
}

// ── Configuración ─────────────────────────────────────────────────────────────
const inputCls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none";

function Config({ settings, locs }: { settings: AttSettings | null; locs: AttLoc[] }) {
  const router = useRouter();
  const [f, setF] = useState<AttendanceSettingsInput>({
    wa_phone_number_id: settings?.wa_phone_number_id ?? null,
    hq_name: settings?.hq_name ?? null,
    hq_lat: settings?.hq_lat ?? null,
    hq_lng: settings?.hq_lng ?? null,
    hq_radius_m: settings?.hq_radius_m ?? 150,
    workday_start: settings?.workday_start?.slice(0, 5) ?? "08:00",
    late_after_min: settings?.late_after_min ?? 15,
    require_geofence: settings?.require_geofence ?? false,
  });
  const [hqLink, setHqLink] = useState(settings?.hq_lat != null ? `${settings.hq_lat}, ${settings.hq_lng}` : "");
  const [saving, startSave] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function saveConfig() {
    setMsg(null);
    const parsed = hqLink.trim() ? parseLatLng(hqLink) : null;
    startSave(async () => {
      const r = await saveAttendanceSettings({ ...f, hq_lat: parsed?.lat ?? (hqLink.trim() ? f.hq_lat : null), hq_lng: parsed?.lng ?? (hqLink.trim() ? f.hq_lng : null) });
      if ("error" in r) setMsg(r.error);
      else { setMsg("Guardado ✓"); router.refresh(); }
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-slate-800">Conexión y horario</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Phone Number ID de WhatsApp" hint="El ID (no el número) que da Meta al conectar. Resuelve la empresa desde el webhook.">
            <input className={inputCls} value={f.wa_phone_number_id ?? ""} onChange={(e) => setF({ ...f, wa_phone_number_id: e.target.value || null })} placeholder="106540352242922" />
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
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Sede propia (oficina/taller)" hint="Nombre para marcar en la sede, si aplica.">
            <input className={inputCls} value={f.hq_name ?? ""} onChange={(e) => setF({ ...f, hq_name: e.target.value || null })} placeholder="Taller DICEC" />
          </Field>
          <Field label="Ubicación de la sede" hint="Pega el link de Google Maps o 'lat, lng'.">
            <div className="flex items-center gap-2">
              <input className={inputCls} value={hqLink} onChange={(e) => setHqLink(e.target.value)} placeholder="https://maps.google… o 8.98, -79.5" />
              <input type="number" min={20} className={cn(inputCls, "w-24")} value={f.hq_radius_m} onChange={(e) => setF({ ...f, hq_radius_m: Number(e.target.value) })} title="Radio (m)" />
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

      <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <p className="mb-1 text-sm font-semibold text-slate-800">Geocercas de los sitios</p>
        <p className="mb-3 text-xs text-slate-500">Pega el link de Google Maps de cada sitio (o &ldquo;lat, lng&rdquo;) y el radio en metros. Solo los sitios con coordenadas cuentan para el matcheo.</p>
        {locs.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">No hay sitios de cliente cargados.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {locs.map((l) => <GeocercaRow key={l.id} loc={l} />)}
          </ul>
        )}
      </div>
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
    const parsed = link.trim() ? parseLatLng(link) : null;
    if (link.trim() && !parsed) { setErr("No reconocí las coordenadas. Pega un link de Google Maps o 'lat, lng'."); return; }
    startSave(async () => {
      const r = await setLocationGeofence(loc.id, { lat: parsed?.lat ?? null, lng: parsed?.lng ?? null, radius });
      if ("error" in r) setErr(r.error);
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
    const sitio = e.matched_hq ? "Sede" : e.matched_location_id ? locName.get(e.matched_location_id) ?? "" : "";
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
