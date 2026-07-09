"use client";

import { useEffect, useMemo, useState } from "react";
import {
  RefreshCw,
  Loader2,
  AlertTriangle,
  Building2,
  TrendingUp,
  FileSignature,
  Wrench,
  Hammer,
  Package,
  Briefcase,
  ChevronDown,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { getQboProjects, setProjectStatus, setProjectProgress, type QboProjectsResult } from "./qbo-actions";
import type { QboProject, ProjectBizStatus } from "@/lib/quickbooks/projects";

// Identidad visual por rubro (misma paleta que el donut del Inicio):
// DC índigo · DM sky · DS esmeralda · DV ámbar. Ícono + color, nunca solo color.
type RubroMeta = { label: string; icon: LucideIcon; chip: string; accent: string; ring: string };
const RUBRO_META: Record<string, RubroMeta> = {
  DC: { label: "Contratos", icon: FileSignature, chip: "bg-indigo-50 text-indigo-600", accent: "#6366F1", ring: "ring-indigo-500/40" },
  DM: { label: "Mantenimiento", icon: Wrench, chip: "bg-sky-50 text-sky-600", accent: "#0EA5E9", ring: "ring-sky-500/40" },
  DS: { label: "Servicio", icon: Hammer, chip: "bg-emerald-50 text-emerald-600", accent: "#10B981", ring: "ring-emerald-500/40" },
  DV: { label: "Ventas", icon: Package, chip: "bg-amber-50 text-amber-600", accent: "#F59E0B", ring: "ring-amber-500/40" },
};
const RUBRO_FALLBACK: RubroMeta = { label: "Proyecto", icon: Briefcase, chip: "bg-slate-100 text-slate-500", accent: "#64748B", ring: "ring-slate-400/40" };
const RUBRO_ORDER = ["DC", "DM", "DS", "DV"];

const STATUS_META: Record<ProjectBizStatus, { label: string; dot: string; text: string; bg: string }> = {
  activo: { label: "Activo", dot: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50 ring-emerald-600/20" },
  por_cobrar: { label: "Por cobrar", dot: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50 ring-amber-600/20" },
  cerrado: { label: "Cerrado", dot: "bg-slate-400", text: "text-slate-600", bg: "bg-slate-100 ring-slate-300" },
};
const STATUS_ORDER: ProjectBizStatus[] = ["activo", "por_cobrar", "cerrado"];

function bal(n: number): string {
  return "B/. " + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function balCompact(n: number): string {
  return "B/. " + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
function relTime(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "recién";
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}
function marginTextColor(m: number): string {
  if (m >= 0.4) return "text-emerald-600";
  if (m >= 0.2) return "text-amber-600";
  return "text-rose-600";
}

export function QboProjectsBoard() {
  const [res, setRes] = useState<QboProjectsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<string>("all");
  const [statusOv, setStatusOv] = useState<Map<string, ProjectBizStatus>>(new Map());
  const [progressOv, setProgressOv] = useState<Map<string, number>>(new Map());
  const [rowError, setRowError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  async function load(force = false) {
    setLoading(true);
    setRefreshError(null);
    try {
      const r = await getQboProjects(force ? { force: true } : undefined);
      const teniaData = res?.ok && res.projects.length > 0;
      if (!r.ok && teniaData) {
        setRefreshError(r.error); // conservar el board; solo avisar
        return;
      }
      // Pull "ok" pero VACÍO sobre un board con datos = payload truncado del
      // gateway, no "se borraron los proyectos": conservar y avisar.
      if (r.ok && r.projects.length === 0 && teniaData) {
        setRefreshError("QuickBooks devolvió 0 proyectos — se mantiene lo último sincronizado. Reintenta en un momento.");
        return;
      }
      setRes(r);
      // Solo limpiar los overrides cuando llegó data fresca que ya los trae:
      // limpiarlos tras un fallo revertía visualmente un avance YA guardado.
      setStatusOv(new Map());
      setProgressOv(new Map());
    } catch (e) {
      // La action RECHAZÓ (red caída, función matada): sin esto el spinner
      // quedaba girando para siempre.
      setRefreshError(e instanceof Error ? e.message : "Se cortó la actualización — reintenta");
    } finally {
      setLoading(false);
    }
  }
  const statusOf = (p: QboProject) => statusOv.get(p.id) ?? p.status;
  const progressOf = (p: QboProject) => progressOv.get(p.id) ?? p.progress ?? 0;
  async function changeStatus(p: QboProject, next: ProjectBizStatus) {
    const prev = statusOf(p);
    setStatusOv((m) => new Map(m).set(p.id, next));
    try {
      const r = await setProjectStatus(p.id, next);
      if (!r.ok) {
        // revertir: no mostrar un status que NO se guardó
        setStatusOv((m) => new Map(m).set(p.id, prev));
        setRowError(r.error);
      } else {
        setRowError(null);
      }
    } catch (e) {
      setStatusOv((m) => new Map(m).set(p.id, prev));
      setRowError(e instanceof Error ? e.message : "No se pudo guardar el estado — reintenta");
    }
  }
  async function saveProgress(p: QboProject, v: number) {
    const prev = progressOf(p);
    setProgressOv((m) => new Map(m).set(p.id, v)); // optimista
    try {
      const r = await setProjectProgress(p.id, v);
      if (!r.ok) {
        // revertir para no mostrar un valor que NO se guardó
        setProgressOv((m) => new Map(m).set(p.id, prev));
        setRowError(r.error);
      } else {
        setRowError(null);
      }
    } catch (e) {
      setProgressOv((m) => new Map(m).set(p.id, prev));
      setRowError(e instanceof Error ? e.message : "No se pudo guardar el avance — reintenta");
    }
  }
  useEffect(() => {
    void load(); // lee de la base: abrir la página NO consulta QBO
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const projects = res?.ok ? res.projects : [];

  // Resumen financiero por rubro (para las cards de filtro).
  const porRubro = useMemo(() => {
    const m = new Map<string, { count: number; cobro: number; gasto: number }>();
    for (const key of RUBRO_ORDER) m.set(key, { count: 0, cobro: 0, gasto: 0 });
    for (const p of projects) {
      const key = p.rubro && RUBRO_META[p.rubro] ? p.rubro : "otro";
      const b = m.get(key) ?? { count: 0, cobro: 0, gasto: 0 };
      b.count++;
      b.cobro += p.income ?? 0;
      b.gasto += p.cost ?? 0;
      m.set(key, b);
    }
    return m;
  }, [projects]);

  const shown = useMemo(
    () =>
      (tab === "all" ? projects : projects.filter((p) => p.rubro === tab))
        .slice()
        .sort((a, b) => Number(statusOf(a) === "cerrado") - Number(statusOf(b) === "cerrado")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projects, tab, statusOv],
  );

  // Totales de la vista actual (gasto vs cobro).
  const vista = useMemo(() => {
    let cobro = 0;
    let gasto = 0;
    for (const p of shown) {
      cobro += p.income ?? 0;
      gasto += p.cost ?? 0;
    }
    return { cobro, gasto, margen: cobro > 0 ? (cobro - gasto) / cobro : null };
  }, [shown]);

  const hasProjects = projects.length > 0;

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="size-4 text-emerald-600" />
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Proyectos en QuickBooks {res?.ok ? <span className="text-slate-400">· {res.year}</span> : null}
            </h2>
            {res?.ok && res.syncedAt ? <p className="text-[11px] text-slate-400">Actualizado {relTime(res.syncedAt)}</p> : null}
          </div>
        </div>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          title="Trae los datos de QuickBooks y los guarda. Abrir la página usa lo guardado, no consulta QBO."
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Actualizar
        </button>
      </div>

      {/* Filtros grandes por rubro (con cobro total). */}
      {hasProjects ? (
        <div className="mb-3 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {RUBRO_ORDER.map((key) => {
            const meta = RUBRO_META[key];
            const Icon = meta.icon;
            const b = porRubro.get(key) ?? { count: 0, cobro: 0, gasto: 0 };
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(active ? "all" : key)}
                className={cn(
                  "group rounded-2xl border bg-white p-3.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
                  active ? cn("border-transparent ring-2", meta.ring) : "border-slate-100",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className={cn("flex size-8 items-center justify-center rounded-xl", meta.chip)}>
                    <Icon className="size-4" />
                  </span>
                  <span className="text-lg font-bold tabular-nums text-slate-900">{b.count}</span>
                </div>
                <p className="mt-2 text-sm font-semibold text-slate-800">{meta.label}</p>
                <p className="mt-0.5 text-xs tabular-nums text-slate-500">{b.cobro > 0 ? `${balCompact(b.cobro)} facturado` : "—"}</p>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
        {/* Barra de resumen de la vista: cobro vs gasto vs margen. */}
        {hasProjects ? (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-slate-100 px-4 py-2.5 text-xs">
            <span className="font-semibold text-slate-700">
              {tab === "all" ? "Todos" : RUBRO_META[tab]?.label ?? tab}
              <span className="ml-1 tabular-nums text-slate-400">{shown.length}</span>
            </span>
            {tab !== "all" ? (
              <button type="button" onClick={() => setTab("all")} className="text-slate-400 hover:text-slate-700">
                Ver todos
              </button>
            ) : null}
            <span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="text-slate-500">
                Gasto <span className="font-semibold tabular-nums text-rose-600">{balCompact(vista.gasto)}</span>
              </span>
              <span className="text-slate-500">
                Cobro <span className="font-semibold tabular-nums text-slate-900">{balCompact(vista.cobro)}</span>
              </span>
              {vista.margen !== null ? (
                <span className={cn("font-semibold tabular-nums", marginTextColor(vista.margen))}>{Math.round(vista.margen * 100)}% margen</span>
              ) : null}
            </span>
          </div>
        ) : null}

        {refreshError ? (
          <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 ring-1 ring-inset ring-amber-600/20">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>No se pudo actualizar desde QuickBooks ({refreshError}). Se muestran los últimos datos guardados.</span>
          </div>
        ) : null}
        {rowError ? (
          <p className="mx-4 mt-3 rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-700 ring-1 ring-inset ring-red-600/20">{rowError}</p>
        ) : null}
        {res?.ok && !res.financialsOk && hasProjects ? (
          <p className="mx-4 mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700 ring-1 ring-inset ring-amber-600/20">
            Rentabilidad pendiente — no se pudo leer el reporte de QBO todavía. La lista igual está; afinamos gasto y margen al validar el reporte.
          </p>
        ) : null}

        {loading && !res ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">Trayendo proyectos de QuickBooks…</p>
        ) : res && !res.ok ? (
          <div className="m-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-inset ring-red-600/20">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>{res.error}</span>
          </div>
        ) : !hasProjects ? (
          res?.ok && res.syncedAt === null ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm text-slate-500">Todavía no trajiste los proyectos de QuickBooks.</p>
              <button
                type="button"
                onClick={() => load(true)}
                disabled={loading}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                Traer de QuickBooks
              </button>
            </div>
          ) : (
            <p className="px-4 py-10 text-center text-sm text-slate-500">No hay proyectos {res?.ok ? res.year : ""} en QuickBooks.</p>
          )
        ) : (
          <ul className="divide-y divide-slate-50 px-2 py-2">
            {shown.map((p) => (
              <ProjectRow
                key={p.id}
                p={p}
                status={statusOf(p)}
                progress={progressOf(p)}
                onSaveProgress={(v) => saveProgress(p, v)}
                onChangeStatus={(s) => changeStatus(p, s)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// Barra de rentabilidad: gasto (rosa) vs margen (verde) como % del cobro.
function ProfitBar({ income, cost }: { income: number; cost: number }) {
  // Sin actividad (0/0): barra vacía neutra — una barra verde llena parecía
  // "100% de margen" en un proyecto sin movimientos.
  if (income === 0 && cost === 0) {
    return <div className="h-1.5 rounded-full bg-slate-100" title="Sin movimientos registrados" />;
  }
  const costPct = income > 0 ? Math.min(100, Math.max(0, (cost / income) * 100)) : cost > 0 ? 100 : 0;
  const marginPct = Math.max(0, 100 - costPct);
  return (
    <div className="flex h-1.5 overflow-hidden rounded-full bg-slate-100" title={`Gasto ${bal(cost)} · Cobro ${bal(income)}`}>
      <div className="h-full bg-rose-400" style={{ width: `${costPct}%` }} />
      <div className="h-full bg-emerald-500" style={{ width: `${marginPct}%` }} />
    </div>
  );
}

function StatusPicker({ value, onChange }: { value: ProjectBizStatus; onChange: (s: ProjectBizStatus) => void }) {
  const meta = STATUS_META[value];
  return (
    <div className="relative">
      <span
        className={cn(
          "pointer-events-none absolute inset-0 flex items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold ring-1 ring-inset",
          meta.bg,
          meta.text,
        )}
      >
        <span className={cn("size-2 rounded-full", meta.dot)} />
        {meta.label}
        <ChevronDown className="ml-auto size-3.5 opacity-60" />
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ProjectBizStatus)}
        aria-label="Cambiar status del proyecto"
        className="h-8 w-32 cursor-pointer appearance-none rounded-lg bg-transparent px-2.5 text-xs font-semibold text-transparent focus:outline-none focus:ring-2 focus:ring-slate-900/10"
      >
        {STATUS_ORDER.map((s) => (
          <option key={s} value={s} className="text-slate-900">
            {STATUS_META[s].label}
          </option>
        ))}
      </select>
    </div>
  );
}

// Input de avance: escribís el número (0-100) y se guarda al salir del campo
// o con Enter. Sin slider (arrastrar sin confirmar perdía el valor).
function ProgressInput({ value, onSave, label }: { value: number; onSave: (v: number) => void; label: string }) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  // Sincronizar cuando el valor guardado cambia (tras guardar o Actualizar).
  useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [value, focused]);
  const shown = Math.min(100, Math.max(0, Number(draft) || 0));
  function commit() {
    setFocused(false);
    // Campo vacío o basura ("e", "-") = SIN CAMBIO, no 0: borrar y salir del
    // campo no debe poner en cero un avance guardado.
    const n = draft.trim() === "" ? NaN : Number(draft);
    if (!Number.isFinite(n)) {
      setDraft(String(value));
      return;
    }
    const v = Math.min(100, Math.max(0, Math.round(n)));
    setDraft(String(v));
    if (v !== value) onSave(v);
  }
  return (
    <div>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          max={100}
          value={draft}
          onFocus={() => setFocused(true)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          aria-label={label}
          className="w-12 rounded-md border border-slate-200 px-1.5 py-1 text-right text-sm font-bold tabular-nums text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
        <span className="text-xs font-semibold text-slate-400">%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${shown}%` }} />
      </div>
    </div>
  );
}

function ProjectRow({
  p,
  status,
  progress,
  onSaveProgress,
  onChangeStatus,
}: {
  p: QboProject;
  status: ProjectBizStatus;
  progress: number;
  onSaveProgress: (v: number) => void;
  onChangeStatus: (s: ProjectBizStatus) => void;
}) {
  const meta = (p.rubro && RUBRO_META[p.rubro]) || RUBRO_FALLBACK;
  const RubroIcon = meta.icon;
  const cerrado = status === "cerrado";
  return (
    <li className={cn("flex flex-wrap items-center gap-3 rounded-lg px-2 py-3 hover:bg-slate-50/60 sm:flex-nowrap", cerrado && "opacity-60")}>
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", meta.chip)} title={meta.label}>
        <RubroIcon className="size-4" />
      </span>

      <div className="min-w-0 flex-1 basis-full sm:basis-0">
        <p className="truncate text-sm font-semibold text-slate-900">{p.name}</p>
        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-500">
          <Building2 className="size-3 shrink-0 text-slate-400" />
          {p.clientName || meta.label}
        </p>
      </div>

      {/* Avance manual — escribí el número y se guarda solo */}
      <div className="w-24 shrink-0 sm:w-28">
        <ProgressInput value={progress} onSave={onSaveProgress} label={`Avance de ${p.name}`} />
      </div>

      {/* Financiero — gasto vs cobro + barra de rentabilidad */}
      <div className="w-40 shrink-0 sm:w-48">
        {p.income !== null ? (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] text-slate-400">Cobro</span>
              <span className="text-sm font-bold tabular-nums text-slate-900">{bal(p.income)}</span>
            </div>
            <div className="mt-0.5 flex items-baseline justify-between gap-2">
              <span className="text-[11px] text-rose-400">Gasto</span>
              <span className="text-xs font-semibold tabular-nums text-rose-600">{p.cost !== null ? bal(p.cost) : "—"}</span>
            </div>
            <div className="mt-1.5">
              <ProfitBar income={p.income} cost={p.cost ?? 0} />
              {p.margin !== null ? (
                <p className={cn("mt-1 text-right text-[10px] font-semibold tabular-nums", marginTextColor(p.margin))}>
                  {Math.round(p.margin * 100)}% margen
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <p className="text-right text-[11px] italic text-slate-300">{cerrado ? "—" : "sin datos de QBO"}</p>
        )}
      </div>

      {/* Status — cambio fácil */}
      <div className="shrink-0">
        <StatusPicker value={status} onChange={onChangeStatus} />
      </div>
    </li>
  );
}
