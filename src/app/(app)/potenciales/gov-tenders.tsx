"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AirVent,
  AlarmClock,
  AlertTriangle,
  Building2,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Droplets,
  ExternalLink,
  Fan,
  Landmark,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Snowflake,
  Target,
  Wind,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney, formatMoneyExact } from "@/lib/pipeline/types";
import { norm } from "@/lib/clients/normalize";
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

// Cuando el gobierno no publica precio de referencia, el tipo de proceso
// al menos acota el monto — mejor que no mostrar nada.
const TIPO_RANGO: Record<string, string> = {
  compra_menor_50k: "$10,000 – $50,000",
  compra_menor_10k: "hasta $10,000",
};

function diasParaCierre(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((+new Date(iso) - Date.now()) / 86400000);
}

function estaAbierta(r: GovTenderRow): boolean {
  return !r.fecha_cierre || +new Date(r.fecha_cierre) >= Date.now();
}

const FECHA_FMT = new Intl.DateTimeFormat("es-PA", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
function fmtFechaCierre(iso: string): string {
  return FECHA_FMT.format(new Date(iso));
}

// Categorización visual: bucket HVAC por keywords sobre título + motivo.
// El ícono identifica el rubro de un vistazo; el color nunca es el único indicador.
type CatVisual = { label: string; icon: LucideIcon; cls: string };
const CATEGORIAS: (CatVisual & { kws: string[] })[] = [
  {
    label: "Clima / aire acondicionado",
    icon: AirVent,
    cls: "bg-sky-50 text-sky-600",
    kws: ["aire acondicionado", "acondicionador", "split", "hvac", "vrf", "fan coil", "manejadora", "clima", "unidad paquete", "aire central"],
  },
  {
    label: "Refrigeración",
    icon: Snowflake,
    cls: "bg-indigo-50 text-indigo-600",
    kws: ["chiller", "enfriador", "refrigera", "cuarto frio", "camara fria", "camara frigorif", "congelador", "serpentin", "deshumidificador", "evaporadora", "condensadora"],
  },
  {
    label: "Torres / agua helada / bombas",
    icon: Droplets,
    cls: "bg-teal-50 text-teal-600",
    kws: ["torre de enfriamiento", "torres de enfriamiento", "agua helada", "agua fria", "bomba"],
  },
  {
    label: "Ductos / ventilación",
    icon: Wind,
    cls: "bg-amber-50 text-amber-600",
    kws: ["ducto", "ventilacion", "extractor", "rejilla", "difusor"],
  },
];
const CAT_HVAC: CatVisual = { label: "HVAC / relacionado", icon: Fan, cls: "bg-emerald-50 text-emerald-600" };
const CAT_OTRO: CatVisual = { label: "Otro rubro", icon: Building2, cls: "bg-slate-100 text-slate-400" };
const CAT_SIN: CatVisual = { label: "Sin clasificar", icon: CircleDashed, cls: "bg-slate-50 text-slate-300" };

function categoriaVisual(r: GovTenderRow): CatVisual {
  if (r.relevante === false) return CAT_OTRO;
  if (r.relevante === null) return CAT_SIN;
  const hay = norm(`${r.titulo ?? ""} ${r.relevancia_motivo ?? ""}`);
  for (const c of CATEGORIAS) if (c.kws.some((k) => hay.includes(k))) return c;
  return CAT_HVAC;
}

const SWEET_DEFAULT = { min: 20000, max: 250000 };
const SWEET_LS_KEY = "cotiza.govSweetSpot";

function MoneyInput({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <input
      inputMode="numeric"
      aria-label={label}
      value={value > 0 ? value.toLocaleString("en-US") : ""}
      onChange={(e) => onChange(Number(e.target.value.replace(/[^0-9]/g, "")) || 0)}
      className="w-16 bg-transparent text-right text-xs font-semibold tabular-nums text-amber-900 placeholder:text-amber-300 focus:outline-none"
      placeholder="0"
    />
  );
}

function MiniKpi({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  icon: LucideIcon;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${accent}17`, color: accent }}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-slate-500">{label}</p>
          <p className="text-xl font-bold tabular-nums text-slate-900">{value}</p>
          <p className="truncate text-[11px] text-slate-400">{sub}</p>
        </div>
      </div>
    </div>
  );
}

function TenderRowItem({
  r,
  sweet,
  busy,
  onSeguir,
  className,
}: {
  r: GovTenderRow;
  sweet: boolean;
  busy: boolean;
  onSeguir: () => void;
  className?: string;
}) {
  const dias = diasParaCierre(r.fecha_cierre);
  const cerrada = dias !== null && dias < 0;
  const siguiendo = !!r.converted_tender_id;
  const cat = categoriaVisual(r);
  const CatIcon = cat.icon;
  return (
    <div className={cn("flex items-start gap-3 px-3 py-3", cerrada && "opacity-60", className)}>
      <span className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl", cat.cls)} title={cat.label}>
        <CatIcon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold tabular-nums text-slate-500">{r.num_proceso}</span>
          {r.tipo ? (
            <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-600/20">
              {TIPO_LABEL[r.tipo] ?? r.tipo}
            </span>
          ) : null}
          {r.relevante === true && r.relevancia_motivo ? (
            <span className="max-w-56 truncate rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
              {r.relevancia_motivo}
            </span>
          ) : null}
          {r.relevante === false && r.relevancia_motivo ? (
            <span className="max-w-56 truncate rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
              {r.relevancia_motivo}
            </span>
          ) : null}
          {r.relevante === null ? (
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">sin clasificar</span>
          ) : null}
          {sweet ? (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20">
              <Target className="size-3" /> sweet spot
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm font-medium leading-snug text-slate-900 line-clamp-2">{r.titulo ?? "—"}</p>
        <p className="mt-0.5 truncate text-xs text-slate-500">{r.entidad ?? "—"}</p>
        {r.fecha_cierre ? (
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <CalendarClock className="size-3.5 shrink-0 text-slate-400" />
            <span>
              Presentar antes: <span className="font-semibold text-slate-700">{fmtFechaCierre(r.fecha_cierre)}</span>
            </span>
            {dias !== null ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset",
                  cerrada
                    ? "bg-slate-100 text-slate-400 ring-slate-200"
                    : dias <= 2
                      ? "bg-red-50 text-red-700 ring-red-600/20"
                      : dias < 5
                        ? "bg-amber-50 text-amber-700 ring-amber-600/20"
                        : "bg-slate-100 text-slate-500 ring-slate-200",
                )}
              >
                {cerrada ? "cerrada" : dias === 0 ? "cierra hoy" : `cierra en ${dias} d`}
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <div className="text-right">
          {r.precio_ref !== null ? (
            <>
              <p className={cn("text-sm font-bold tabular-nums", sweet ? "text-amber-600" : "text-slate-900")}>
                {formatMoneyExact(r.precio_ref)}
              </p>
              <p className="text-[10px] text-slate-400">precio ref.</p>
            </>
          ) : r.tipo && TIPO_RANGO[r.tipo] ? (
            <>
              <p className="text-xs font-semibold tabular-nums text-slate-500">{TIPO_RANGO[r.tipo]}</p>
              <p className="text-[10px] text-slate-400">rango del tipo</p>
            </>
          ) : (
            <p className="text-[11px] italic text-slate-300">sin precio ref.</p>
          )}
        </div>
        <div className="flex items-center gap-1">
          {r.url ? (
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              title="Ver en PanamaCompra"
            >
              <ExternalLink className="size-4" />
            </a>
          ) : null}
          {siguiendo ? (
            <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700">
              <CheckCircle2 className="size-3.5" /> Siguiendo
            </span>
          ) : (
            <button
              type="button"
              onClick={onSeguir}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
              title="Copiarla a tus licitaciones (pipeline propio)"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              Seguir
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function GovTendersBoard({ onFollowed, onStats }: { onFollowed?: () => void; onStats?: (relevantesAbiertas: number) => void }) {
  const [rows, setRows] = useState<GovTenderRow[]>([]);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [soloRelevantes, setSoloRelevantes] = useState(true);
  const [tipoFiltro, setTipoFiltro] = useState<string>("all");
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);

  // Sweet spot parametrizable en la página; persiste por navegador.
  const [ssMin, setSsMin] = useState(SWEET_DEFAULT.min);
  const [ssMax, setSsMax] = useState(SWEET_DEFAULT.max);
  const [soloSweet, setSoloSweet] = useState(false);
  const ssLoaded = useRef(false);
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(SWEET_LS_KEY) ?? "") as { min?: number; max?: number };
      if (typeof s.min === "number" && s.min >= 0) setSsMin(s.min);
      if (typeof s.max === "number" && s.max >= 0) setSsMax(s.max);
    } catch {
      /* defaults */
    }
    ssLoaded.current = true;
  }, []);
  useEffect(() => {
    if (!ssLoaded.current) return;
    try {
      localStorage.setItem(SWEET_LS_KEY, JSON.stringify({ min: ssMin, max: ssMax }));
    } catch {
      /* sin storage */
    }
  }, [ssMin, ssMax]);
  const inSweet = (p: number | null) => p !== null && ssMax > ssMin && p >= ssMin && p <= ssMax;

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
    onStats?.(r.data.rows.filter((x) => x.relevante === true && estaAbierta(x)).length);
  }
  useEffect(() => {
    void load(); // lee de la base — no toca PanamaCompra
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    setLastRefresh(
      `${r.data.total} procesos · ${r.data.nuevos} nuevos · ${r.data.relevantes} relevantes clasificados` +
        (r.data.conPrecio > 0 ? ` · ${r.data.conPrecio} montos traídos` : "") +
        (r.data.pendientesPrecio > 0 ? ` · quedan ~${r.data.pendientesPrecio} sin monto (tocá Actualizar de nuevo)` : ""),
    );
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

  // Resumen global (sobre todo lo abierto y relevante, sin filtros de vista).
  const stats = useMemo(() => {
    let urgentes = 0;
    let sweet = 0;
    let sweetSum = 0;
    let relevantes = 0;
    for (const r of rows) {
      if (r.relevante !== true || !estaAbierta(r)) continue;
      relevantes++;
      const d = diasParaCierre(r.fecha_cierre);
      if (d !== null && d >= 0 && d < 5) urgentes++;
      if (inSweet(r.precio_ref)) {
        sweet++;
        sweetSum += r.precio_ref ?? 0;
      }
    }
    return { urgentes, sweet, sweetSum, relevantes };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, ssMin, ssMax]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (soloRelevantes && r.relevante !== true) return false;
      // Relevantes = accionables: las ya cerradas solo se ven en "Todas".
      if (soloRelevantes && !estaAbierta(r)) return false;
      if (tipoFiltro !== "all" && r.tipo !== tipoFiltro) return false;
      if (soloSweet && !inSweet(r.precio_ref)) return false;
      if (needle && !`${r.num_proceso} ${r.titulo ?? ""} ${r.entidad ?? ""}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    // Abiertas primero (cierre más próximo arriba); cerradas al final.
    const rank = (r: GovTenderRow) => (!r.fecha_cierre ? 1 : estaAbierta(r) ? 0 : 2);
    return list.sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      const ta = a.fecha_cierre ? +new Date(a.fecha_cierre) : 0;
      const tb = b.fecha_cierre ? +new Date(b.fecha_cierre) : 0;
      return ra === 2 ? tb - ta : ta - tb;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, soloRelevantes, tipoFiltro, soloSweet, ssMin, ssMax]);

  // Prioridad: relevantes que cierran en <5 días (todavía se puede participar).
  const urgentes = useMemo(
    () =>
      shown.filter((r) => {
        const d = diasParaCierre(r.fecha_cierre);
        return r.relevante === true && d !== null && d >= 0 && d < 5;
      }),
    [shown],
  );
  const urgentIds = useMemo(() => new Set(urgentes.map((r) => r.id)), [urgentes]);
  const resto = useMemo(() => shown.filter((r) => !urgentIds.has(r.id)), [shown, urgentIds]);

  return (
    <div className="space-y-4">
      {!loading && rows.length > 0 ? (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MiniKpi
            label="Cierran en <5 días"
            value={String(stats.urgentes)}
            sub="relevantes aún abiertas"
            icon={AlarmClock}
            accent="#EF4444"
          />
          <MiniKpi
            label="En sweet spot"
            value={String(stats.sweet)}
            sub={stats.sweet > 0 ? `${formatMoney(stats.sweetSum)} ref. en juego` : `${formatMoney(ssMin)} – ${formatMoney(ssMax)}`}
            icon={Target}
            accent="#F59E0B"
          />
          <MiniKpi label="Relevantes DICEC" value={String(stats.relevantes)} sub="abiertas para participar" icon={Snowflake} accent="#10B981" />
          <MiniKpi
            label="Procesos monitoreados"
            value={String(rows.length)}
            sub={syncedAt ? `actualizado ${relTime(syncedAt)}` : "PanamaCompra"}
            icon={Landmark}
            accent="#6366F1"
          />
        </section>
      ) : null}

      <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <Landmark className="size-4 text-indigo-600" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Licitaciones públicas vigentes · PanamaCompra</h3>
              {syncedAt ? <p className="text-[11px] text-slate-400">Actualizado {relTime(syncedAt)} · sync automático diario</p> : null}
            </div>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
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
                "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                soloRelevantes ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
              )}
            >
              Relevantes DICEC{" "}
              <span className={cn("tabular-nums", soloRelevantes ? "text-white/70" : "text-slate-400")}>{stats.relevantes}</span>
            </button>
            <button
              type="button"
              onClick={() => setSoloRelevantes(false)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
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
                  "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                  tipoFiltro === t.k ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                )}
              >
                {t.label}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-slate-200" />
            <button
              type="button"
              onClick={() => setSoloSweet((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors",
                soloSweet ? "bg-amber-500 text-white" : "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20 hover:bg-amber-100",
              )}
              title="Solo procesos dentro del rango sweet spot"
            >
              <Target className="size-3.5" /> Solo sweet spot
            </button>
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 ring-1 ring-inset ring-amber-600/20">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600">Sweet spot</span>
              <span className="text-xs text-amber-700">$</span>
              <MoneyInput value={ssMin} onChange={setSsMin} label="Sweet spot mínimo (USD)" />
              <span className="text-xs text-amber-400">–</span>
              <span className="text-xs text-amber-700">$</span>
              <MoneyInput value={ssMax} onChange={setSsMax} label="Sweet spot máximo (USD)" />
            </span>
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
          <div className="space-y-2 px-4 pb-6 pt-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex animate-pulse items-center gap-3 rounded-xl bg-slate-50 px-3 py-4">
                <div className="size-9 rounded-xl bg-slate-100" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-2/3 rounded bg-slate-100" />
                  <div className="h-3 w-1/3 rounded bg-slate-100" />
                </div>
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 pb-8 pt-2 text-center">
            <p className="text-sm text-slate-500">Todavía no trajiste licitaciones de PanamaCompra.</p>
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
            >
              {refreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Traer de PanamaCompra
            </button>
          </div>
        ) : (
          <div className="pb-2">
            {urgentes.length > 0 ? (
              <div className="mx-3 mb-2 rounded-xl border border-red-100 bg-red-50/60">
                <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
                  <AlarmClock className="size-4 text-red-600" />
                  <p className="text-xs font-bold uppercase tracking-wide text-red-700">
                    Cierran en menos de 5 días · {urgentes.length}
                  </p>
                  <p className="hidden text-[11px] text-red-400 sm:block">todavía estás a tiempo de participar</p>
                </div>
                <div className="space-y-1.5 p-2">
                  {urgentes.map((r) => (
                    <TenderRowItem
                      key={r.id}
                      r={r}
                      sweet={inSweet(r.precio_ref)}
                      busy={busy === r.id}
                      onSeguir={() => seguir(r.id)}
                      className="rounded-lg bg-white ring-1 ring-red-100"
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {urgentes.length > 0 && resto.length > 0 ? (
              <p className="px-5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Demás procesos</p>
            ) : null}
            <ul className="divide-y divide-slate-50 px-2">
              {resto.map((r) => (
                <li key={r.id} className="rounded-lg transition-colors hover:bg-slate-50/60">
                  <TenderRowItem r={r} sweet={inSweet(r.precio_ref)} busy={busy === r.id} onSeguir={() => seguir(r.id)} />
                </li>
              ))}
              {shown.length === 0 ? (
                <li className="px-2 py-6 text-center text-sm text-slate-400">
                  Nada matchea ese filtro.
                  {soloRelevantes && rows.length > 0 && stats.relevantes === 0 ? (
                    <span className="mt-1 block text-xs">
                      Todavía no hay clasificadas — tocá &ldquo;Actualizar&rdquo; para clasificar con IA, o mirá &ldquo;Todas&rdquo;.
                    </span>
                  ) : null}
                </li>
              ) : null}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
