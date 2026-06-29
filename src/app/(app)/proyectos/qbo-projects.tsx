"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Loader2, AlertTriangle, Building2, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { getQboProjects, type QboProjectsResult } from "./qbo-actions";
import type { QboProject } from "@/lib/quickbooks/projects";

const RUBRO_LABEL: Record<string, string> = { DC: "Contratos", DM: "Mantenimiento", DS: "Servicio", DV: "Ventas" };
const RUBRO_CHIP: Record<string, string> = {
  DC: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
  DM: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  DS: "bg-amber-50 text-amber-700 ring-amber-600/20",
  DV: "bg-violet-50 text-violet-700 ring-violet-600/20",
};

function bal(n: number): string {
  return "B/. " + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function marginColor(m: number): string {
  if (m >= 0.4) return "bg-emerald-500";
  if (m >= 0.2) return "bg-amber-500";
  return "bg-rose-500";
}

export function QboProjectsBoard() {
  const [res, setRes] = useState<QboProjectsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<string>("all");

  async function load(force = false) {
    setLoading(true);
    const r = await getQboProjects(force ? { force: true } : undefined);
    setRes(r);
    setLoading(false);
  }
  useEffect(() => {
    void load(); // usa cache: refrescar la página no re-consulta QBO
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const projects = res?.ok ? res.projects : [];
  const rubros = useMemo(() => Array.from(new Set(projects.map((p) => p.rubro).filter((r): r is string => !!r))), [projects]);
  const shown = tab === "all" ? projects : projects.filter((p) => p.rubro === tab);

  return (
    <section className="mb-8 rounded-2xl border border-slate-200 bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="size-4 text-emerald-600" />
          <h2 className="text-sm font-semibold text-slate-900">
            Proyectos en QuickBooks {res?.ok ? <span className="text-slate-400">· {res.year}</span> : null}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          title="Re-consulta QuickBooks (lo demás usa cache de 15 min)"
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
        <p className="px-4 py-10 text-center text-sm text-slate-500">No hay proyectos {res?.ok ? res.year : ""} en QuickBooks (o no se pudieron leer).</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3">
            {[{ k: "all", label: "Todos" }, ...rubros.map((r) => ({ k: r, label: RUBRO_LABEL[r] ?? r }))].map((t) => (
              <button
                key={t.k}
                type="button"
                onClick={() => setTab(t.k)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium",
                  tab === t.k ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                )}
              >
                {t.label}
                <span className={cn("ml-1 tabular-nums", tab === t.k ? "text-white/70" : "text-slate-400")}>
                  {t.k === "all" ? projects.length : projects.filter((p) => p.rubro === t.k).length}
                </span>
              </button>
            ))}
          </div>

          {res?.ok && !res.financialsOk ? (
            <p className="mx-4 mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700 ring-1 ring-inset ring-amber-600/20">
              Rentabilidad pendiente — no se pudo leer el reporte de QBO todavía. La lista igual está; afinamos el margen al validar el reporte.
            </p>
          ) : null}

          <ul className="divide-y divide-slate-50 px-2 py-2">
            {shown.map((p) => (
              <ProjectRow key={p.id} p={p} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function ProjectRow({ p }: { p: QboProject }) {
  return (
    <li className="flex items-center gap-4 rounded-lg px-2 py-2.5 hover:bg-slate-50/60">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {p.rubro ? (
            <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset", RUBRO_CHIP[p.rubro] ?? "bg-slate-100 text-slate-600")}>
              {p.rubro}
            </span>
          ) : null}
          <p className="truncate text-sm font-medium text-slate-900">{p.name}</p>
        </div>
        {p.clientName ? (
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-500">
            <Building2 className="size-3 text-slate-400" />
            {p.clientName}
          </p>
        ) : null}
      </div>

      <div className="w-44 shrink-0">
        {p.margin !== null ? (
          <>
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-900">{Math.round(p.margin * 100)}%</span>
              <span className="text-[10px] text-slate-400">margen</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className={cn("h-full rounded-full", marginColor(p.margin))} style={{ width: `${Math.max(4, Math.min(100, p.margin * 100))}%` }} />
            </div>
            <div className="mt-1 flex justify-between text-[10px] tabular-nums text-slate-400">
              <span>{p.income !== null ? bal(p.income) : "—"}</span>
              <span>{p.cost !== null ? bal(p.cost) : "—"}</span>
            </div>
          </>
        ) : (
          <p className="text-right text-[11px] text-slate-400">sin datos de QBO</p>
        )}
      </div>
    </li>
  );
}
