"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Loader2, AlertTriangle, ExternalLink, Landmark, Plus, CheckCircle2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoneyExact } from "@/lib/pipeline/types";
import { listGovTenders, refreshGovTenders, followGovTender, type GovTenderRow } from "./gov-actions";

function relTime(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 60) return `hace ${Math.max(1, m)} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

const TIPO_LABEL: Record<string, string> = {
  licitacion_publica: "Licitación Pública",
  compra_menor_50k: "CM 10–50k",
  compra_menor_10k: "CM ≤10k",
  programada: "Programada",
};

function diasParaCierre(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((+new Date(iso) - Date.now()) / 86400000);
}

export function GovTendersBoard({ onFollowed }: { onFollowed?: () => void }) {
  const [rows, setRows] = useState<GovTenderRow[]>([]);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [soloRelevantes, setSoloRelevantes] = useState(true);
  const [tipoFiltro, setTipoFiltro] = useState<string>("all");

  async function load() {
    const r = await listGovTenders();
    setLoading(false);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    setError(null);
    setRows(r.data.rows);
    setSyncedAt(r.data.syncedAt);
  }
  useEffect(() => {
    void load(); // lee de la base — no toca PanamaCompra
  }, []);

  const [lastRefresh, setLastRefresh] = useState<string | null>(null);

  async function refresh() {
    setRefreshing(true);
    setError(null);
    setLastRefresh(null);
    const r = await refreshGovTenders();
    setRefreshing(false);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    setLastRefresh(`${r.data.total} procesos · ${r.data.nuevos} nuevos · ${r.data.relevantes} relevantes clasificados`);
    await load();
  }

  async function seguir(id: string) {
    setBusy(id);
    const r = await followGovTender(id);
    setBusy(null);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    setRows((prev) => prev.map((x) => (x.id === id ? { ...x, converted_tender_id: r.data.tenderId } : x)));
    onFollowed?.();
  }

  const relevantesCount = useMemo(() => rows.filter((r) => r.relevante === true).length, [rows]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (soloRelevantes && r.relevante !== true) return false;
      if (tipoFiltro !== "all" && r.tipo !== tipoFiltro) return false;
      if (needle && !`${r.num_proceso} ${r.titulo ?? ""} ${r.entidad ?? ""}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, q, soloRelevantes, tipoFiltro]);

  return (
    <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <Landmark className="size-4 text-indigo-600" />
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Licitaciones públicas vigentes · PanamaCompra</h3>
            {syncedAt ? <p className="text-[11px] text-slate-400">Actualizado {relTime(syncedAt)}</p> : null}
          </div>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          title="Consulta PanamaCompra y guarda — abrir la página usa lo guardado"
        >
          {refreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          {refreshing ? "Consultando…" : "Actualizar"}
        </button>
      </header>

      <div className="px-4 py-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filtrar por acto, entidad, objeto… (ej: aire, chiller, clima)"
            className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-sm focus:border-slate-400 focus:outline-none"
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSoloRelevantes(true)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-semibold",
              soloRelevantes ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
            )}
          >
            Relevantes DICEC <span className={cn("tabular-nums", soloRelevantes ? "text-white/70" : "text-slate-400")}>{relevantesCount}</span>
          </button>
          <button
            type="button"
            onClick={() => setSoloRelevantes(false)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-semibold",
              !soloRelevantes ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
            )}
          >
            Todas <span className={cn("tabular-nums", !soloRelevantes ? "text-white/70" : "text-slate-400")}>{rows.length}</span>
          </button>
          <span className="mx-1 h-4 w-px bg-slate-200" />
          {[{ k: "all", label: "Todos los tipos" }, ...Object.entries(TIPO_LABEL).map(([k, label]) => ({ k, label }))].map((t) => (
            <button
              key={t.k}
              type="button"
              onClick={() => setTipoFiltro(t.k)}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium",
                tipoFiltro === t.k ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {lastRefresh ? (
          <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 ring-1 ring-inset ring-emerald-600/20">{lastRefresh}</p>
        ) : null}
        {error ? (
          <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-inset ring-red-600/20">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {error}
          </p>
        ) : null}
      </div>

      {loading ? (
        <p className="px-4 pb-8 pt-2 text-center text-sm text-slate-500">Cargando…</p>
      ) : rows.length === 0 ? (
        <div className="px-4 pb-8 pt-2 text-center">
          <p className="text-sm text-slate-500">Todavía no trajiste licitaciones de PanamaCompra.</p>
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {refreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Traer de PanamaCompra
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-slate-50 px-2 pb-2">
          {shown.map((r) => {
            const dias = diasParaCierre(r.fecha_cierre);
            const siguiendo = !!r.converted_tender_id;
            return (
              <li key={r.id} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-slate-50/60">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold tabular-nums text-slate-500">{r.num_proceso}</span>
                    {r.tipo ? (
                      <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-600/20">
                        {TIPO_LABEL[r.tipo] ?? r.tipo}
                      </span>
                    ) : null}
                    {r.relevante === true && r.relevancia_motivo ? (
                      <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                        {r.relevancia_motivo}
                      </span>
                    ) : null}
                    {r.relevante === null ? (
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">sin clasificar</span>
                    ) : null}
                    {dias !== null ? (
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset",
                          dias <= 3
                            ? "bg-red-50 text-red-700 ring-red-600/20"
                            : dias <= 7
                              ? "bg-amber-50 text-amber-700 ring-amber-600/20"
                              : "bg-slate-100 text-slate-500 ring-slate-200",
                        )}
                      >
                        {dias < 0 ? "cerrada" : dias === 0 ? "cierra hoy" : `cierra en ${dias} d`}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-sm font-medium text-slate-900">{r.titulo ?? "—"}</p>
                  <p className="truncate text-xs text-slate-500">{r.entidad ?? "—"}</p>
                </div>
                <div className="shrink-0 text-right text-xs tabular-nums text-slate-600">
                  {r.precio_ref !== null ? formatMoneyExact(r.precio_ref) : ""}
                </div>
                {r.url ? (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    title="Ver en PanamaCompra"
                  >
                    <ExternalLink className="size-4" />
                  </a>
                ) : null}
                {siguiendo ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700">
                    <CheckCircle2 className="size-3.5" /> Siguiendo
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => seguir(r.id)}
                    disabled={busy === r.id}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                    title="Copiarla a tus licitaciones (pipeline propio)"
                  >
                    {busy === r.id ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                    Seguir
                  </button>
                )}
              </li>
            );
          })}
          {shown.length === 0 ? (
            <li className="px-2 py-6 text-center text-sm text-slate-400">
              Nada matchea ese filtro.
              {soloRelevantes && rows.length > 0 && relevantesCount === 0 ? (
                <span className="mt-1 block text-xs">Todavía no hay clasificadas — tocá &ldquo;Actualizar&rdquo; para clasificar con IA, o mirá &ldquo;Todas&rdquo;.</span>
              ) : null}
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}
