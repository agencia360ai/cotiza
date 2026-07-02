"use client";

import { useEffect, useMemo, useState } from "react";
import {
  RefreshCw,
  Loader2,
  AlertTriangle,
  Building2,
  TrendingUp,
  Lock,
  LockOpen,
  FileSignature,
  Wrench,
  Hammer,
  Package,
  Briefcase,
  Check,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { getQboProjects, setProjectClosed, setProjectProgress, type QboProjectsResult } from "./qbo-actions";
import type { QboProject } from "@/lib/quickbooks/projects";

// Identidad visual por rubro (misma paleta que el donut del Inicio):
// DC índigo · DM sky · DS esmeralda · DV ámbar. Ícono + color, nunca solo color.
type RubroMeta = { label: string; icon: LucideIcon; chip: string; solid: string; tinted: string };
const RUBRO_META: Record<string, RubroMeta> = {
  DC: {
    label: "Contratos",
    icon: FileSignature,
    chip: "bg-indigo-50 text-indigo-600",
    solid: "bg-indigo-600 text-white",
    tinted: "bg-indigo-50 text-indigo-700 hover:bg-indigo-100",
  },
  DM: {
    label: "Mantenimiento",
    icon: Wrench,
    chip: "bg-sky-50 text-sky-600",
    solid: "bg-sky-600 text-white",
    tinted: "bg-sky-50 text-sky-700 hover:bg-sky-100",
  },
  DS: {
    label: "Servicio",
    icon: Hammer,
    chip: "bg-emerald-50 text-emerald-600",
    solid: "bg-emerald-600 text-white",
    tinted: "bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
  },
  DV: {
    label: "Ventas",
    icon: Package,
    chip: "bg-amber-50 text-amber-600",
    solid: "bg-amber-500 text-white",
    tinted: "bg-amber-50 text-amber-700 hover:bg-amber-100",
  },
};
const RUBRO_FALLBACK: RubroMeta = {
  label: "Proyecto",
  icon: Briefcase,
  chip: "bg-slate-100 text-slate-500",
  solid: "bg-slate-900 text-white",
  tinted: "bg-slate-100 text-slate-600 hover:bg-slate-200",
};

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
  const [override, setOverride] = useState<Map<string, boolean>>(new Map());
  const [progressOv, setProgressOv] = useState<Map<string, number>>(new Map());
  const [editingProgress, setEditingProgress] = useState<string | null>(null);
  const [progressError, setProgressError] = useState<string | null>(null);

  async function load(force = false) {
    setLoading(true);
    const r = await getQboProjects(force ? { force: true } : undefined);
    setRes(r);
    setOverride(new Map());
    setProgressOv(new Map());
    setLoading(false);
  }
  const isClosed = (p: QboProject) => (override.has(p.id) ? override.get(p.id)! : p.closed);
  const progressOf = (p: QboProject) => progressOv.get(p.id) ?? p.progress ?? 0;
  async function toggleClosed(p: QboProject) {
    const next = !isClosed(p);
    setOverride((m) => new Map(m).set(p.id, next));
    await setProjectClosed(p.id, next);
  }
  function changeProgress(p: QboProject, v: number) {
    setProgressOv((m) => new Map(m).set(p.id, v));
  }
  async function saveProgress(p: QboProject) {
    const v = progressOf(p);
    const r = await setProjectProgress(p.id, v);
    if (!r.ok) setProgressError(r.error);
    else setProgressError(null);
  }
  useEffect(() => {
    void load(); // lee de la base: abrir la página NO consulta QBO
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const projects = res?.ok ? res.projects : [];
  const rubros = useMemo(() => Array.from(new Set(projects.map((p) => p.rubro).filter((r): r is string => !!r))), [projects]);
  const shown = (tab === "all" ? projects : projects.filter((p) => p.rubro === tab))
    .slice()
    .sort((a, b) => Number(isClosed(a)) - Number(isClosed(b))); // abiertos primero
  const closedCount = projects.filter(isClosed).length;
  const facturadoVista = shown.reduce((acc, p) => acc + (p.income ?? 0), 0);

  return (
    <section className="mb-8 rounded-2xl border border-slate-100 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
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
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          title="Trae los datos de QuickBooks y los guarda. Abrir la página usa lo guardado, no consulta QBO."
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Actualizar
        </button>
      </header>

      {loading && !res ? (
        <p className="px-4 py-10 text-center text-sm text-slate-500">Trayendo proyectos de QuickBooks…</p>
      ) : res && !res.ok ? (
        <div className="m-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-inset ring-red-600/20">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{res.error}</span>
        </div>
      ) : projects.length === 0 ? (
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
        <>
          <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3">
            {[{ k: "all", label: "Todos" }, ...rubros.map((r) => ({ k: r, label: RUBRO_META[r]?.label ?? r }))].map((t) => {
              const meta = t.k === "all" ? RUBRO_FALLBACK : (RUBRO_META[t.k] ?? RUBRO_FALLBACK);
              const active = tab === t.k;
              return (
                <button
                  key={t.k}
                  type="button"
                  onClick={() => setTab(t.k)}
                  className={cn("rounded-full px-3 py-1 text-xs font-semibold transition-colors", active ? meta.solid : meta.tinted)}
                >
                  {t.label}
                  <span className={cn("ml-1 tabular-nums", active ? "text-white/70" : "opacity-60")}>
                    {t.k === "all" ? projects.length : projects.filter((p) => p.rubro === t.k).length}
                  </span>
                </button>
              );
            })}
            {facturadoVista > 0 ? (
              <span className="ml-auto text-xs text-slate-500">
                Facturado en vista: <span className="font-bold tabular-nums text-slate-900">{balCompact(facturadoVista)}</span>
              </span>
            ) : null}
          </div>

          {res?.ok && !res.financialsOk ? (
            <p className="mx-4 mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700 ring-1 ring-inset ring-amber-600/20">
              Rentabilidad pendiente — no se pudo leer el reporte de QBO todavía. La lista igual está; afinamos el margen al validar el reporte.
            </p>
          ) : null}
          {progressError ? (
            <p className="mx-4 mt-3 rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-700 ring-1 ring-inset ring-red-600/20">{progressError}</p>
          ) : null}

          <ul className="divide-y divide-slate-50 px-2 py-2">
            {shown.map((p) => (
              <ProjectRow
                key={p.id}
                p={p}
                closed={isClosed(p)}
                progress={progressOf(p)}
                editing={editingProgress === p.id}
                onStartEdit={() => setEditingProgress(p.id)}
                onChangeProgress={(v) => changeProgress(p, v)}
                onDoneProgress={() => {
                  setEditingProgress(null);
                  void saveProgress(p);
                }}
                onToggle={() => toggleClosed(p)}
              />
            ))}
          </ul>
          {closedCount > 0 ? (
            <p className="px-4 pb-3 text-[11px] text-slate-400">
              {closedCount} cerrado{closedCount === 1 ? "" : "s"} — no se re-consultan a QBO en cada actualización.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

function ProjectRow({
  p,
  closed,
  progress,
  editing,
  onStartEdit,
  onChangeProgress,
  onDoneProgress,
  onToggle,
}: {
  p: QboProject;
  closed: boolean;
  progress: number;
  editing: boolean;
  onStartEdit: () => void;
  onChangeProgress: (v: number) => void;
  onDoneProgress: () => void;
  onToggle: () => void;
}) {
  const meta = (p.rubro && RUBRO_META[p.rubro]) || RUBRO_FALLBACK;
  const RubroIcon = meta.icon;
  return (
    <li className={cn("flex items-center gap-3 rounded-lg px-2 py-3 hover:bg-slate-50/60", closed && "opacity-60")}>
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", meta.chip)} title={meta.label}>
        <RubroIcon className="size-4" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="truncate text-sm font-semibold text-slate-900">{p.name}</p>
          {closed ? <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">cerrado</span> : null}
        </div>
        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-500">
          <Building2 className="size-3 shrink-0 text-slate-400" />
          {p.clientName || meta.label}
        </p>
      </div>

      {/* Avance manual — click para actualizar */}
      <div className="w-28 shrink-0 sm:w-36">
        {editing ? (
          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold tabular-nums text-blue-700">{progress}%</span>
              <button
                type="button"
                onClick={onDoneProgress}
                className="inline-flex items-center gap-0.5 rounded-md bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white hover:bg-blue-700"
              >
                <Check className="size-3" /> Listo
              </button>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={progress}
              onChange={(e) => onChangeProgress(Number(e.target.value))}
              className="mt-1.5 w-full accent-blue-600"
              aria-label={`Avance de ${p.name}`}
            />
          </div>
        ) : (
          <button type="button" onClick={onStartEdit} className="group w-full text-left" title="Click para actualizar el avance">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold tabular-nums text-slate-900">{progress}%</span>
              <span className="text-[10px] text-slate-400 transition-colors group-hover:text-blue-600">avance ✎</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
            </div>
          </button>
        )}
      </div>

      {/* Monto del proyecto — protagonista; el margen queda secundario */}
      <div className="w-28 shrink-0 text-right sm:w-36">
        {p.income !== null ? (
          <>
            <p className="text-base font-bold tabular-nums tracking-tight text-slate-900 sm:text-lg">{bal(p.income)}</p>
            <p className="text-[10px] text-slate-400">
              facturado
              {p.margin !== null ? (
                <span className={cn("ml-1.5 font-semibold", marginTextColor(p.margin))}>{Math.round(p.margin * 100)}% margen</span>
              ) : null}
            </p>
          </>
        ) : (
          <p className="text-[11px] italic text-slate-300">{closed ? "—" : "sin datos de QBO"}</p>
        )}
      </div>

      <button
        type="button"
        onClick={onToggle}
        title={closed ? "Reabrir — vuelve a refrescar desde QBO" : "Cerrar — deja de refrescar (congela los números)"}
        className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      >
        {closed ? <LockOpen className="size-4" /> : <Lock className="size-4" />}
      </button>
    </li>
  );
}
