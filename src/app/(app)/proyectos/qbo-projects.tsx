"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  RefreshCw,
  Loader2,
  AlertTriangle,
  Building2,
  CalendarRange,
  Check,
  TrendingUp,
  FileSignature,
  Search,
  Wrench,
  Hammer,
  Package,
  Briefcase,
  ChevronDown,
  FileText,
  ArrowUpRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { getQboProjects, setProjectStatus, setProjectDates, diagnosticarProyecto, setProjectQuoteNo, getQuotesPorProyecto, listCotizacionesAsignables, asignarCotizaciones, type QboProjectsResult, type QuotesPorProyecto, type CotizacionAsignable } from "./qbo-actions";
import { codigoDeProyecto } from "@/lib/quickbooks/codigo";
import { SortTh, toggleSort, compareVals, type SortState } from "@/components/ui/sortable";
import type { QboProject, ProjectBizStatus, PnlDiagnostico } from "@/lib/quickbooks/projects";
import {
  effectiveDates,
  overlapFraction,
  sumarMeses,
  finDeMes,
  type DateRange,
  type FuenteFechas,
  type MesMonto,
} from "@/lib/quickbooks/prorate";

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

const FUENTE_TITULO: Record<FuenteFechas | "sin", string> = {
  manual: "Fechas del contrato, cargadas a mano — haz clic para editar",
  qbo: "Actividad real en QuickBooks (apertura del proyecto → último movimiento) — haz clic para fijar las del contrato",
  asumido: "Fechas asumidas (año del proyecto) — haz clic para poner las reales",
  sin: "Sin fechas — haz clic para agregarlas",
};
// Sin fecha de fin del contrato no hay cierre que mostrar. El label dice en qué
// punto está según el estado, en vez de inventar una fecha.
const SIN_FIN: Partial<Record<ProjectBizStatus, { label: string; title: string }>> = {
  activo: {
    label: "en ejecución",
    title:
      "Sigue en ejecución: no tiene fecha de fin cargada. QuickBooks solo sabe hasta cuándo hubo movimiento, no cuándo termina — haz clic para poner la del contrato.",
  },
  por_cobrar: {
    label: "sin cierre",
    title:
      "El trabajo terminó pero el proyecto no está cerrado, y no tiene fecha de fin cargada — haz clic para poner la del contrato.",
  },
};

// Cap de filas RENDERIZADAS: pintar cientos de proyectos (cada fila con su
// selector de estado, barras y editor) dispara la memoria del navegador en
// máquinas con poca RAM. Mostramos los primeros N según el orden elegido; el
// resto se alcanza filtrando/buscando. No afecta los totales ni el resumen.
const RENDER_CAP = 200;

// Mismo $ que el resto de la app (los "B/." viejos desentonaban con el Inicio).
function bal(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function balCompact(n: number): string {
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
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

const hoyPanama = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Panama" });
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function fmtCorta(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return `${MESES_CORTOS[(m ?? 1) - 1]} ${String(y).slice(2)}`;
}
function shiftDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
// Meses ("YYYY-MM-01") que toca el intervalo, ambos extremos incluidos.
function mesesEntre(desde: string, hasta: string): string[] {
  if (hasta < desde) return [];
  const out: string[] = [];
  const d = new Date(desde.slice(0, 7) + "-01T00:00:00Z");
  const fin = hasta.slice(0, 7);
  // Tope de 5 años: un dato sucio (fecha del 2099) no debe colgar el navegador.
  for (let i = 0; i < 60; i++) {
    const mes = d.toISOString().slice(0, 7);
    out.push(`${mes}-01`);
    if (mes >= fin) break;
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

// ── Rangos de fecha (presets + custom) ────────────────────────────────────────
type RangeKey = "year" | "3m" | "6m" | "lastyear" | "all" | "custom";
const RANGE_LABEL: Record<RangeKey, string> = {
  year: "Este año",
  "3m": "Últimos 3 meses",
  "6m": "Últimos 6 meses",
  lastyear: "Año pasado",
  all: "Todo",
  custom: "Personalizado",
};
const RANGE_ORDER: RangeKey[] = ["year", "3m", "6m", "lastyear", "all", "custom"];

function rangeFor(key: RangeKey, customFrom: string, customTo: string): DateRange | null {
  const hoy = hoyPanama();
  const y = Number(hoy.slice(0, 4));
  switch (key) {
    case "year":
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    case "3m":
      return { from: shiftDays(hoy, -90), to: hoy };
    case "6m":
      return { from: shiftDays(hoy, -180), to: hoy };
    case "lastyear":
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    case "all":
      return null;
    case "custom": {
      const from = customFrom || "2000-01-01";
      const to = customTo || hoy;
      return from <= to ? { from, to } : { from: to, to: from };
    }
  }
}

type SortKey = "nombre" | "cliente" | "cobro" | "gasto" | "margen" | "inicio" | "fin" | "estado" | "cotizacion";

// Proyección de un proyecto dentro del rango activo.
//
// `real` distingue las dos formas de llegar a los montos del rango:
//   true  → se sumaron los meses que QuickBooks reportó dentro del rango.
//   false → se prorrateó el total por días (proyecto sin desglose mensual:
//           cerrado con números congelados, o un contrato aún sin facturar).
type Enriched = {
  p: QboProject;
  eff: { start: string; end: string; fuente: FuenteFechas } | null;
  fraction: number; // 0..1 dentro del rango (1 sin rango o sin fechas)
  inRange: boolean;
  real: boolean;
  totalBase: number | null; // contrato (o cobro real como fallback)
  usaContrato: boolean;
  enRango: number | null; // meses del rango, o totalBase × fraction
  gastoRango: number | null;
  meses: MesMonto[]; // desglose del proyecto (vacío si no hay)
};

export function QboProjectsBoard() {
  const [res, setRes] = useState<QboProjectsResult | null>(null);
  const [loading, setLoading] = useState(true);
  // Rubros seleccionados. Vacío = todos. Es un SET, no una pestaña: el equipo
  // mira "contratos + mantenimiento" o "contratos + servicio" como un bloque.
  const [rubros, setRubros] = useState<Set<string>>(new Set());
  const [statusOv, setStatusOv] = useState<Map<string, ProjectBizStatus>>(new Map());
  const [datesOv, setDatesOv] = useState<Map<string, { startDate: string | null; endDate: string | null; contractTotal: number | null }>>(new Map());
  const [rowError, setRowError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  // Barra de progreso del refresh de QBO. El refresh es UNA sola llamada que
  // vuelve al final (no hay progreso granular real), así que la barra avanza
  // por tiempo estimado (easing hacia 92%) y se completa al llegar la respuesta
  // — sobre todo útil cuando el gateway estaba dormido y tarda.
  const [refreshPct, setRefreshPct] = useState<number | null>(null);
  const refreshTimer = useRef<number | null>(null);

  // Filtros / orden / búsqueda / rango.
  const [q, setQ] = useState("");
  const [statusFiltro, setStatusFiltro] = useState<ProjectBizStatus | "all">("all");
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "cobro", dir: "desc" });
  const [rangeKey, setRangeKey] = useState<RangeKey>("year");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [editingDates, setEditingDates] = useState<string | null>(null);
  const [editingQuotes, setEditingQuotes] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<QuotesPorProyecto>({});
  const quotesDe = (p: QboProject) => {
    const code = codigoDeProyecto(p.name) ?? codigoDeProyecto(p.fullName);
    return code ? quotes[code] : undefined;
  };

  function pararBarra(completar: boolean) {
    if (refreshTimer.current) {
      window.clearInterval(refreshTimer.current);
      refreshTimer.current = null;
    }
    if (completar) {
      setRefreshPct(100);
      window.setTimeout(() => setRefreshPct(null), 1200);
    } else {
      setRefreshPct(null);
    }
  }

  async function load(force = false) {
    setLoading(true);
    setRefreshError(null);
    if (force) {
      setRefreshPct(4);
      if (refreshTimer.current) window.clearInterval(refreshTimer.current);
      // Easing hacia 92%: rápido al inicio, desacelerando — nunca "llena" hasta
      // que la respuesta real dispara el 100%. Reasegura que algo está pasando.
      refreshTimer.current = window.setInterval(() => {
        setRefreshPct((p) => (p === null ? p : Math.min(92, p + (92 - p) * 0.06)));
      }, 400);
    }
    try {
      const r = await getQboProjects({ force, allYears: true });
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
      // Solo limpiar los overrides cuando llegó data fresca que ya los trae.
      setStatusOv(new Map());
      setDatesOv(new Map());
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : "Se cortó la actualización — reintenta");
    } finally {
      setLoading(false);
      if (force) pararBarra(true);
    }
  }
  useEffect(() => () => {
    if (refreshTimer.current) window.clearInterval(refreshTimer.current);
  }, []);
  const statusOf = (p: QboProject) => statusOv.get(p.id) ?? p.status;
  const datesOf = (p: QboProject) => {
    const ov = datesOv.get(p.id);
    return {
      startDate: ov ? ov.startDate : p.startDate,
      endDate: ov ? ov.endDate : p.endDate,
      contractTotal: ov ? ov.contractTotal : p.contractTotal,
    };
  };
  async function changeStatus(p: QboProject, next: ProjectBizStatus) {
    const prev = statusOf(p);
    setStatusOv((m) => new Map(m).set(p.id, next));
    try {
      const r = await setProjectStatus(p.id, next);
      if (!r.ok) {
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
  async function saveDates(p: QboProject, v: { startDate: string | null; endDate: string | null; contractTotal: number | null }) {
    try {
      const r = await setProjectDates(p.id, v);
      if (!r.ok) {
        setRowError(r.error);
        return false;
      }
      setDatesOv((m) => new Map(m).set(p.id, v));
      setRowError(null);
      return true;
    } catch (e) {
      setRowError(e instanceof Error ? e.message : "No se pudieron guardar las fechas — reintenta");
      return false;
    }
  }
  useEffect(() => {
    void getQuotesPorProyecto().then(setQuotes).catch(() => {});
    void load(); // lee de la base: abrir la página NO consulta QBO
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const projects = res?.ok ? res.projects : [];
  const range = useMemo(() => rangeFor(rangeKey, customFrom, customTo), [rangeKey, customFrom, customTo]);
  // QuickBooks se consulta desde enero del año pasado. Si el rango elegido va
  // más atrás, esos meses no tienen desglose y sus montos son estimaciones — se
  // avisa en vez de mostrar un número que parece exacto y no lo es.
  const mesesDesde = res?.ok ? res.mesesDesde : null;
  const fueraDeCobertura = !!mesesDesde && (!range || range.from < mesesDesde);

  // Proyección de cada proyecto dentro del rango. Con desglose mensual de QBO
  // los montos se SUMAN (número real); sin él, se prorratean por días.
  const enriched: Enriched[] = useMemo(() => {
    return projects.map((p) => {
      const d = datesOf(p);
      const eff = effectiveDates({
        startDate: d.startDate,
        endDate: d.endDate,
        qboCreatedAt: p.qboCreatedAt,
        firstTxnDate: p.firstTxnDate,
        lastTxnDate: p.lastTxnDate,
        year: p.year,
      });
      const meses = p.meses ?? [];
      const contractTotal = d.contractTotal;
      const usaContrato = contractTotal !== null;
      const totalBase = contractTotal ?? p.income;
      const round2 = (n: number) => Math.round(n * 100) / 100;

      // Camino real: sumar los meses del rango. Se usa cuando hay desglose y no
      // hay un total de contrato que mande (un contrato firmado se devenga a lo
      // largo del período aunque todavía no se haya facturado completo).
      if (meses.length > 0 && !usaContrato) {
        const s = sumarMeses(meses, range);
        // Dentro del rango = tuvo movimiento ahí. Un proyecto de 2025 deja de
        // aparecer en "Este año" solo porque su nombre diga 26.
        const inRange = !range || s.income !== 0 || s.cost !== 0;
        return {
          p,
          eff,
          fraction: totalBase && totalBase > 0 ? Math.min(1, s.income / totalBase) : 1,
          inRange,
          real: true,
          totalBase,
          usaContrato,
          enRango: s.income,
          gastoRango: s.cost,
          meses,
        };
      }

      let fraction = 1;
      let inRange = true;
      if (range) {
        if (eff) {
          fraction = overlapFraction(eff.start, eff.end, range);
          inRange = fraction > 0;
        } // sin ninguna pista de fechas: se muestra siempre (no se puede juzgar)
      }
      return {
        p,
        eff,
        fraction,
        inRange,
        real: false,
        totalBase,
        usaContrato,
        enRango: totalBase === null ? null : round2(totalBase * fraction),
        gastoRango: p.cost === null ? null : round2(p.cost * fraction),
        meses,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, range, datesOv]);

  // Todos los filtros MENOS el de rubro. Las cards de arriba SON ese filtro, así
  // que se calculan sobre esto: al buscar "Cirion" muestran los rubros de
  // Cirion. Antes ignoraban búsqueda y estado, y sus números no cuadraban con la
  // lista de abajo. Búsqueda: nombre, cliente — y montos si escribes dígitos.
  const sinRubro = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const digits = needle.replace(/[^0-9]/g, "");
    return enriched.filter((e) => {
      if (!e.inRange) return false;
      if (statusFiltro !== "all" && statusOf(e.p) !== statusFiltro) return false;
      if (!needle) return true;
      const hay = `${e.p.fullName} ${e.p.name} ${e.p.clientName}`.toLowerCase();
      if (hay.includes(needle)) return true;
      if (digits.length >= 3) {
        const montos = [e.p.income, e.p.cost, e.totalBase, e.enRango]
          .filter((n): n is number => n !== null)
          .map((n) => String(Math.round(n)));
        if (montos.some((m) => m.includes(digits))) return true;
      }
      return false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enriched, q, statusFiltro, statusOv]);

  const toggleRubro = (key: string) =>
    setRubros((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  // Set vacío = todos los rubros.
  const filtered = useMemo(
    () => (rubros.size === 0 ? sinRubro : sinRubro.filter((e) => rubros.has(e.p.rubro ?? "otro"))),
    [sinRubro, rubros],
  );

  const rangeActive = !!range;

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const val = (e: Enriched): string | number | null => {
      switch (sort.key) {
        case "nombre":
          return e.p.fullName.toLowerCase();
        case "cliente":
          return e.p.clientName.toLowerCase();
        case "cobro":
          return e.enRango ?? e.p.income;
        case "gasto":
          return e.gastoRango ?? e.p.cost;
        case "margen":
          return e.p.margin;
        case "inicio":
          return e.eff?.start ?? null;
        case "fin":
          // Un proyecto sin fin cargado no tiene fecha que ordenar: va al final
          // como cualquier vacío, en vez de colarse por su último movimiento.
          return datesOf(e.p).endDate ?? (statusOf(e.p) === "cerrado" ? e.eff?.end ?? null : null);
        case "estado":
          return STATUS_ORDER.indexOf(statusOf(e.p));
        case "cotizacion":
          return quotesDe(e.p)?.count ?? null;
      }
    };
    arr.sort((a, b) => {
      // Cerrados siempre al final, ordene por lo que ordene.
      const ca = Number(statusOf(a.p) === "cerrado");
      const cb = Number(statusOf(b.p) === "cerrado");
      if (ca !== cb) return ca - cb;
      return compareVals(val(a), val(b), sort.dir);
    });
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sort, statusOv, datesOv, quotes]);

  const porRubro = useMemo(() => {
    const m = new Map<string, { count: number; cobro: number; gasto: number }>();
    for (const key of RUBRO_ORDER) m.set(key, { count: 0, cobro: 0, gasto: 0 });
    for (const e of sinRubro) {
      const key = e.p.rubro && RUBRO_META[e.p.rubro] ? e.p.rubro : "otro";
      const b = m.get(key) ?? { count: 0, cobro: 0, gasto: 0 };
      b.count++;
      b.cobro += e.enRango ?? 0;
      b.gasto += e.gastoRango ?? 0;
      m.set(key, b);
    }
    return m;
  }, [sinRubro]);

  // Serie mensual de la vista: cobro y gasto por mes, sumando lo que QuickBooks
  // reportó en cada uno. Los proyectos sin desglose (cerrados, contratos aún sin
  // facturar) reparten su monto prorrateado entre los meses que cubren, para que
  // la gráfica no se contradiga con el total de la barra de resumen.
  const serieMensual = useMemo(() => {
    const acc = new Map<string, { cobro: number; gasto: number }>();
    const suma = (mes: string, cobro: number, gasto: number) => {
      const b = acc.get(mes) ?? { cobro: 0, gasto: 0 };
      b.cobro += cobro;
      b.gasto += gasto;
      acc.set(mes, b);
    };
    for (const e of sorted) {
      if (e.real) {
        for (const m of e.meses) {
          const f = range ? overlapFraction(m.month, finDeMes(m.month), range) : 1;
          if (f > 0) suma(m.month, m.income * f, m.cost * f);
        }
        continue;
      }
      if (!e.eff || (e.enRango === null && e.gastoRango === null)) continue;
      const cubiertos = mesesEntre(
        range && range.from > e.eff.start ? range.from : e.eff.start,
        range && range.to < e.eff.end ? range.to : e.eff.end,
      );
      if (cubiertos.length === 0) continue;
      const porMes = 1 / cubiertos.length;
      for (const mes of cubiertos) suma(mes, (e.enRango ?? 0) * porMes, (e.gastoRango ?? 0) * porMes);
    }
    return Array.from(acc, ([month, v]) => ({ month, ...v })).sort((a, b) => a.month.localeCompare(b.month));
  }, [sorted, range]);

  // Totales de la vista actual. `prorrateados` cuenta los que NO tienen desglose
  // mensual de QBO y por lo tanto llevan un monto repartido por días — es el
  // aviso de "este número es una estimación", no un dato de QuickBooks.
  const vista = useMemo(() => {
    let cobro = 0;
    let gasto = 0;
    let prorrateados = 0;
    for (const e of sorted) {
      cobro += e.enRango ?? 0;
      gasto += e.gastoRango ?? 0;
      if (!e.real && e.fraction < 1) prorrateados++;
    }
    return { cobro, gasto, prorrateados, margen: cobro > 0 ? (cobro - gasto) / cobro : null };
  }, [sorted]);

  const hasProjects = projects.length > 0;

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="size-4 text-emerald-600" />
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Proyectos en QuickBooks <span className="text-slate-400">· {RANGE_LABEL[rangeKey]}</span>
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
          {refreshPct !== null ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          {refreshPct !== null ? "Actualizando…" : "Actualizar"}
        </button>
      </div>

      {refreshPct !== null ? (
        <div className="mb-3 rounded-lg border border-slate-100 bg-white px-3 py-2 shadow-sm">
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className="font-semibold text-slate-600">
              Consultando QuickBooks… {refreshPct < 90 ? "(puede tardar si el servicio estaba en reposo)" : "casi listo"}
            </span>
            <span className="tabular-nums text-slate-400">{Math.round(refreshPct)}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${refreshPct}%` }} />
          </div>
        </div>
      ) : null}

      {/* Filtros por rubro. Se COMBINAN: contratos + mantenimiento, contratos +
          servicio, lo que haga falta. Ninguno marcado = todos. */}
      {hasProjects ? (
        <div className="mb-3 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {RUBRO_ORDER.map((key) => {
            const meta = RUBRO_META[key];
            const Icon = meta.icon;
            const b = porRubro.get(key) ?? { count: 0, cobro: 0, gasto: 0 };
            const active = rubros.has(key);
            const maxCobro = Math.max(...RUBRO_ORDER.map((k) => porRubro.get(k)?.cobro ?? 0), 1);
            const margen = b.cobro > 0 ? (b.cobro - b.gasto) / b.cobro : null;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => toggleRubro(key)}
                className={cn(
                  "group relative cursor-pointer overflow-hidden rounded-2xl border bg-white p-3.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2",
                  active ? cn("border-transparent ring-2", meta.ring) : "border-slate-100",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className={cn("flex size-8 items-center justify-center rounded-xl", meta.chip)}>
                    <Icon className="size-4" />
                  </span>
                  <span className="flex items-center gap-1.5">
                    {active ? <Check className="size-3.5 text-slate-400" /> : null}
                    <span className="text-lg font-bold tabular-nums text-slate-900">{b.count}</span>
                  </span>
                </div>
                <p className="mt-2 text-sm font-semibold text-slate-800">{meta.label}</p>
                <p className="mt-0.5 flex items-baseline gap-1.5 text-xs tabular-nums text-slate-500">
                  {b.cobro > 0 ? (
                    <>
                      <span className="font-semibold text-slate-700">{balCompact(b.cobro)}</span>
                      {margen !== null ? <span className={marginTextColor(margen)}>{Math.round(margen * 100)}%</span> : null}
                    </>
                  ) : (
                    "—"
                  )}
                </p>
                {/* Barra de proporción: el peso del rubro se ve, no se calcula. */}
                <span className="mt-2 block h-1 overflow-hidden rounded-full bg-slate-100">
                  <span
                    className="block h-full rounded-full transition-all"
                    style={{ width: `${Math.max(b.cobro > 0 ? 4 : 0, (b.cobro / maxCobro) * 100)}%`, backgroundColor: meta.accent }}
                  />
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Cobro vs gasto mes a mes dentro del rango. */}
      {hasProjects && serieMensual.length > 1 ? (
        <MonthlyProfitChart data={serieMensual} todoReal={sorted.every((e) => e.real)} />
      ) : null}

      {/* Toolbar: búsqueda + rango de fechas + status + orden */}
      {hasProjects ? (
        <div className="mb-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar por proyecto, cliente o monto…"
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm focus:border-slate-400 focus:outline-none"
              />
            </div>
            <select
              value={statusFiltro}
              onChange={(e) => setStatusFiltro(e.target.value as ProjectBizStatus | "all")}
              aria-label="Filtrar por estado"
              className="cursor-pointer rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 focus:outline-none"
            >
              <option value="all">Todos los estados</option>
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s].label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <CalendarRange className="size-3.5 text-slate-400" />
            {RANGE_ORDER.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setRangeKey(k)}
                aria-pressed={rangeKey === k}
                className={cn(
                  "cursor-pointer rounded-full px-2.5 py-1 text-xs font-semibold transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-1",
                  rangeKey === k ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                )}
              >
                {RANGE_LABEL[k]}
              </button>
            ))}
            {rangeKey === "custom" ? (
              <span className="inline-flex items-center gap-1.5">
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  aria-label="Desde"
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs focus:outline-none"
                />
                <span className="text-xs text-slate-400">→</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  aria-label="Hasta"
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs focus:outline-none"
                />
              </span>
            ) : null}
            {fueraDeCobertura ? (
              <span className="text-[11px] text-slate-400" title="El desglose mensual se trae desde esa fecha. Antes solo hay el total del proyecto, repartido por días.">
                Detalle mensual desde {fmtCorta(mesesDesde!)}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
        {/* Barra de resumen de la vista: cobro vs gasto vs margen (prorrateado). */}
        {hasProjects ? (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-slate-100 px-4 py-2.5 text-xs">
            <span className="font-semibold text-slate-700">
              {rubros.size === 0
                ? "Todos"
                : RUBRO_ORDER.filter((k) => rubros.has(k))
                    .map((k) => RUBRO_META[k].label)
                    .join(" + ")}
              <span className="ml-1 tabular-nums text-slate-400">{sorted.length}</span>
            </span>
            {rubros.size > 0 || q || statusFiltro !== "all" ? (
              <button
                type="button"
                onClick={() => {
                  setRubros(new Set());
                  setQ("");
                  setStatusFiltro("all");
                }}
                className="cursor-pointer text-slate-400 hover:text-slate-700"
              >
                Limpiar filtros
              </button>
            ) : null}
            <span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1">
              {vista.prorrateados > 0 ? (
                <span
                  className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-600/20"
                  title={`${vista.prorrateados} proyecto${vista.prorrateados === 1 ? "" : "s"} multi-período: se muestra solo la porción del contrato dentro del rango`}
                >
                  {vista.prorrateados} prorrateado{vista.prorrateados === 1 ? "" : "s"}
                </span>
              ) : null}
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
            <span className="flex-1">No se pudo actualizar desde QuickBooks ({refreshError}). Se muestran los últimos datos guardados.</span>
            <button
              type="button"
              onClick={() => load(true)}
              disabled={loading}
              className="shrink-0 rounded-md bg-amber-100 px-2 py-1 font-semibold text-amber-800 hover:bg-amber-200 disabled:opacity-50"
            >
              Reintentar
            </button>
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
            <p className="px-4 py-10 text-center text-sm text-slate-500">No hay proyectos en QuickBooks.</p>
          )
        ) : sorted.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            Nada matchea los filtros{range ? ` en “${RANGE_LABEL[rangeKey]}”` : ""}.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-b-2xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                    <th className="hidden w-9 px-3 py-2.5 sm:table-cell"></th>
                    <SortTh label="Proyecto" k="nombre" sort={sort} onSort={(k) => setSort((v) => toggleSort(v, k))} />
                    <SortTh label={rangeActive ? "En rango" : "Cobro"} k="cobro" sort={sort} onSort={(k) => setSort((v) => toggleSort(v, k, "desc"))} align="right" className="text-right" />
                    <SortTh label="Gasto" k="gasto" sort={sort} onSort={(k) => setSort((v) => toggleSort(v, k, "desc"))} align="right" className="text-right" />
                    <SortTh label="Margen" k="margen" sort={sort} onSort={(k) => setSort((v) => toggleSort(v, k, "desc"))} align="right" className="text-right" />
                    <SortTh label="Inicio" k="inicio" sort={sort} onSort={(k) => setSort((v) => toggleSort(v, k, "desc"))} className="hidden lg:table-cell" />
                    <SortTh label="Fin" k="fin" sort={sort} onSort={(k) => setSort((v) => toggleSort(v, k, "desc"))} className="hidden lg:table-cell" />
                    <SortTh label="Estado" k="estado" sort={sort} onSort={(k) => setSort((v) => toggleSort(v, k))} />
                    <SortTh label="Cotización" k="cotizacion" sort={sort} onSort={(k) => setSort((v) => toggleSort(v, k, "desc"))} className="hidden md:table-cell" />
                    <th className="px-3 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.slice(0, RENDER_CAP).map((e) => (
                    <ProjectRow
                      key={e.p.id}
                      e={e}
                      rangeActive={rangeActive}
                      status={statusOf(e.p)}
                      dates={datesOf(e.p)}
                      quotes={quotesDe(e.p)}
                      codigo={codigoDeProyecto(e.p.name) ?? codigoDeProyecto(e.p.fullName)}
                      editing={editingDates === e.p.id}
                      pickingQuotes={editingQuotes === e.p.id}
                      onTogglePickQuotes={() => setEditingQuotes((prev) => (prev === e.p.id ? null : e.p.id))}
                      onQuotesChanged={() => void getQuotesPorProyecto().then(setQuotes)}
                      onToggleEdit={() => setEditingDates((prev) => (prev === e.p.id ? null : e.p.id))}
                      onChangeStatus={(s) => changeStatus(e.p, s)}
                      onSaveDates={async (v) => {
                        const ok = await saveDates(e.p, v);
                        if (ok) setEditingDates(null);
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            {sorted.length > RENDER_CAP ? (
              <p className="border-t border-slate-100 px-4 py-2.5 text-center text-xs text-slate-400">
                Mostrando los primeros {RENDER_CAP} de {sorted.length} · afina el rango, el rubro o la búsqueda para ver el resto.
              </p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

// ── Cobro vs gasto por mes ───────────────────────────────────────────────────
// Mismas specs que los charts del Inicio: SVG puro, grid recesivo, marcas con
// tope redondeado ancladas a la base, tooltip por mes y texto en tokens de
// texto (nunca del color de la serie). El gasto va DENTRO de la barra de cobro
// en vez de al lado: lo que importa leer de un vistazo es cuánto del cobro se
// fue en gasto, y dos barras pegadas obligan a compararlas a ojo.
type PuntoMes = { month: string; cobro: number; gasto: number };

function MonthlyProfitChart({ data, todoReal }: { data: PuntoMes[]; todoReal: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = 168;
  const PAD_L = 8;
  const PAD_B = 20;
  const PAD_T = 16;
  const max = Math.max(1, ...data.map((d) => d.cobro), ...data.map((d) => d.gasto));
  const innerW = W - PAD_L * 2;
  const slot = innerW / data.length;
  const barW = Math.min(30, slot * 0.6);
  const y = (v: number) => H - PAD_B - (v / max) * (H - PAD_B - PAD_T);
  const maxIdx = data.reduce((mi, d, i) => (d.cobro > data[mi].cobro ? i : mi), 0);
  const totalCobro = data.reduce((a, d) => a + d.cobro, 0);
  const totalGasto = data.reduce((a, d) => a + d.gasto, 0);
  const margen = totalCobro > 0 ? (totalCobro - totalGasto) / totalCobro : null;

  // Barra con el tope redondeado. Piso de 3px: un mes de $200 al lado de uno de
  // $50,000 se dibujaría como una raya invisible y se leería como "sin
  // movimiento", que es justo lo contrario de lo que dice el dato.
  const barra = (v: number, x: number, w: number): string => {
    const base = H - PAD_B;
    const top = Math.min(y(v), base - 3);
    const r = Math.min(4, (base - top) / 2);
    return `M ${x} ${base} L ${x} ${top + r} Q ${x} ${top} ${x + r} ${top} L ${x + w - r} ${top} Q ${x + w} ${top} ${x + w} ${top + r} L ${x + w} ${base} Z`;
  };

  return (
    <div className="mb-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm font-semibold text-slate-900">Cobro y gasto por mes</h3>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="inline-flex items-center gap-1.5 text-slate-500">
            <span className="size-2 rounded-full bg-slate-800" /> Cobro
            <span className="font-semibold tabular-nums text-slate-900">{balCompact(totalCobro)}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-slate-500">
            <span className="size-2 rounded-full bg-rose-400" /> Gasto
            <span className="font-semibold tabular-nums text-rose-600">{balCompact(totalGasto)}</span>
          </span>
          {margen !== null ? (
            <span className={cn("font-semibold tabular-nums", marginTextColor(margen))}>{Math.round(margen * 100)}% margen</span>
          ) : null}
        </div>
      </div>
      <p className="mb-2 text-[11px] text-slate-400">
        {todoReal
          ? "Lo que QuickBooks reporta en cada mes."
          : "Los proyectos sin desglose mensual en QBO reparten su monto entre los meses que cubren."}
      </p>

      <div className="relative">
        {/* El aria-label lleva los números, no solo el título: para un lector de
            pantalla la gráfica es su descripción — "gráfica de barras" no dice nada. */}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={`Cobro y gasto por mes. ${data
            .map((d) => `${fmtCorta(d.month)}: cobro ${balCompact(d.cobro)}, gasto ${balCompact(d.gasto)}`)
            .join(". ")}`}
        >
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <line key={f} x1={PAD_L} x2={W - PAD_L} y1={y(max * f)} y2={y(max * f)} stroke="#F1F5F9" strokeWidth="1" />
          ))}
          <line x1={PAD_L} x2={W - PAD_L} y1={H - PAD_B} y2={H - PAD_B} stroke="#E2E8F0" strokeWidth="1" />

          {data.map((d, i) => {
            const cx = PAD_L + slot * i + slot / 2;
            const x = cx - barW / 2;
            const active = hover === i;
            const dim = hover !== null && !active;
            const gastoW = barW * 0.55;
            return (
              <g key={d.month} opacity={dim ? 0.4 : 1} style={{ transition: "opacity 150ms" }}>
                <rect
                  x={PAD_L + slot * i}
                  y={PAD_T}
                  width={slot}
                  height={H - PAD_B - PAD_T}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
                {d.cobro > 0 ? (
                  <path d={barra(d.cobro, x, barW)} fill={active ? "#0F172A" : "#334155"} style={{ pointerEvents: "none" }} />
                ) : null}
                {d.gasto > 0 ? (
                  <path
                    d={barra(d.gasto, cx - gastoW / 2, gastoW)}
                    fill="#FB7185"
                    opacity={0.92}
                    style={{ pointerEvents: "none" }}
                  />
                ) : null}
                {/* Etiqueta directa solo en el mes más alto: da la escala sin
                    obligar a pasar el mouse ni llenar la gráfica de números. */}
                {i === maxIdx && d.cobro > 0 && hover === null ? (
                  <text x={cx} y={y(d.cobro) - 5} textAnchor="middle" className="fill-slate-600" fontSize="10" fontWeight="600">
                    {balCompact(d.cobro)}
                  </text>
                ) : null}
                <text x={cx} y={H - 6} textAnchor="middle" className="fill-slate-500" fontSize="9">
                  {MESES_CORTOS[Number(d.month.slice(5, 7)) - 1]}
                  {data.length > 12 && d.month.slice(5, 7) === "01" ? ` ${d.month.slice(2, 4)}` : ""}
                </text>
              </g>
            );
          })}
        </svg>

        {hover !== null ? (
          <div
            className="pointer-events-none absolute -top-1 z-10 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] leading-relaxed text-white shadow-lg"
            style={{ left: `${((PAD_L + slot * hover + slot / 2) / W) * 100}%`, transform: "translateX(-50%)" }}
          >
            <span className="font-semibold">{fmtCorta(data[hover].month)}</span> · cobro {balCompact(data[hover].cobro)} · gasto{" "}
            {balCompact(data[hover].gasto)}
          </div>
        ) : null}
      </div>
    </div>
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

// Editor inline de fechas del contrato + monto total (base del prorrateo).
function DatesEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: { startDate: string | null; endDate: string | null; contractTotal: number | null };
  onSave: (v: { startDate: string | null; endDate: string | null; contractTotal: number | null }) => Promise<void>;
  onCancel: () => void;
}) {
  const [start, setStart] = useState(initial.startDate ?? "");
  const [end, setEnd] = useState(initial.endDate ?? "");
  const [total, setTotal] = useState(initial.contractTotal !== null ? String(initial.contractTotal) : "");
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2.5">
      <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Inicio
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="mt-0.5 block rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-normal normal-case tracking-normal focus:outline-none" />
      </label>
      <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Fin <span className="font-normal normal-case tracking-normal text-slate-400">· vacío = en ejecución</span>
        <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="mt-0.5 block rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-normal normal-case tracking-normal focus:outline-none" />
      </label>
      <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Contrato total $
        <input
          inputMode="decimal"
          value={total}
          onChange={(e) => setTotal(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="24000"
          className="mt-0.5 block w-24 rounded-md border border-slate-200 bg-white px-2 py-1 text-right text-xs font-normal normal-case tabular-nums tracking-normal focus:outline-none"
        />
      </label>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onSave({
              startDate: start || null,
              endDate: end || null,
              contractTotal: total.trim() === "" ? null : Number(total),
            });
          } finally {
            setBusy(false);
          }
        }}
        className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />} Guardar
      </button>
      <button type="button" onClick={onCancel} disabled={busy} className="cursor-pointer rounded-md px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100">
        Cancelar
      </button>
    </div>
  );
}

// Panel para armar las cotizaciones de un proyecto. Escribe en el MISMO campo
// que la columna Proyecto de Cotizaciones (`sales_quotes.qbo_project_no`), así
// que lo que se arma acá se ve allá y al revés — no hay dos verdades.
function CotizacionesPicker({
  codigo,
  onClose,
  onChanged,
}: {
  codigo: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [todas, setTodas] = useState<CotizacionAsignable[] | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void listCotizacionesAsignables().then((r) => {
      if (vivo) setTodas(r);
    });
    return () => {
      vivo = false;
    };
  }, []);

  const puestas = useMemo(() => (todas ?? []).filter((c) => c.projectNo === codigo), [todas, codigo]);
  // Solo se buscan las que NO están ya en el proyecto. Sin texto no se lista
  // nada: son 390 y volcarlas todas no ayuda a encontrar una.
  const resultados = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle || !todas) return [];
    return todas
      .filter((c) => c.projectNo !== codigo)
      .filter((c) =>
        `${c.quoteNumber} ${c.clientName ?? ""} ${c.description ?? ""}`.toLowerCase().includes(needle),
      )
      .slice(0, 40);
  }, [todas, q, codigo]);

  async function mover(c: CotizacionAsignable, destino: string | null) {
    setBusy(c.id);
    setError(null);
    const antes = c.projectNo;
    setTodas((prev) => (prev ?? []).map((x) => (x.id === c.id ? { ...x, projectNo: destino } : x)));
    const r = await asignarCotizaciones([c.id], destino);
    setBusy(null);
    if (!r.ok) {
      setTodas((prev) => (prev ?? []).map((x) => (x.id === c.id ? { ...x, projectNo: antes } : x)));
      setError(r.error);
      return;
    }
    onChanged();
  }

  const total = puestas.reduce((a, c) => a + (c.amount ?? 0), 0);

  return (
    <div className="mt-2 rounded-lg bg-slate-50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-700">
          Cotizaciones de {codigo}
          <span className="ml-1.5 font-normal text-slate-500">
            {puestas.length === 0 ? "· ninguna todavía" : `· ${puestas.length} · ${bal(total)}`}
          </span>
        </p>
        <button type="button" onClick={onClose} className="cursor-pointer rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-200">
          Cerrar
        </button>
      </div>

      {error ? (
        <p className="mb-2 rounded-md bg-red-50 px-2 py-1.5 text-[11px] text-red-700 ring-1 ring-inset ring-red-600/20">{error}</p>
      ) : null}

      {todas === null ? (
        <p className="py-3 text-center text-xs text-slate-500">Cargando cotizaciones…</p>
      ) : (
        <>
          {puestas.length > 0 ? (
            <ul className="mb-3 space-y-1">
              {puestas.map((c) => (
                <li key={c.id} className="flex items-center gap-2 rounded-md bg-white px-2 py-1.5 text-xs ring-1 ring-inset ring-slate-200">
                  <FileText className="size-3.5 shrink-0 text-violet-500" />
                  <span className="font-semibold text-slate-800">{c.quoteNumber}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-500">
                    {c.clientName ?? "—"}
                    {c.description ? ` · ${c.description}` : ""}
                  </span>
                  <span className="shrink-0 tabular-nums text-slate-700">{c.amount !== null ? bal(c.amount) : "—"}</span>
                  <button
                    type="button"
                    disabled={busy === c.id}
                    onClick={() => mover(c, null)}
                    title="Quitar del proyecto"
                    className="shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-[11px] font-semibold text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                  >
                    {busy === c.id ? "…" : "Quitar"}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar COT DC, cliente o descripción para agregar…"
              className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-xs focus:border-slate-400 focus:outline-none"
            />
          </div>

          {q.trim() ? (
            resultados.length === 0 ? (
              <p className="mt-2 text-center text-[11px] text-slate-400">Ninguna cotización matchea.</p>
            ) : (
              <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
                {resultados.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 rounded-md bg-white px-2 py-1.5 text-xs ring-1 ring-inset ring-slate-100">
                    <span className="font-semibold text-slate-800">{c.quoteNumber}</span>
                    <span className="min-w-0 flex-1 truncate text-slate-500">
                      {c.clientName ?? "—"}
                      {c.description ? ` · ${c.description}` : ""}
                    </span>
                    {/* Una cotización vive en un solo proyecto: si ya está en otro,
                        agregarla acá la MUEVE. Se avisa antes, no después. */}
                    {c.projectNo ? (
                      <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20">
                        en {c.projectNo}
                      </span>
                    ) : null}
                    <span className="shrink-0 tabular-nums text-slate-700">{c.amount !== null ? bal(c.amount) : "—"}</span>
                    <button
                      type="button"
                      disabled={busy === c.id}
                      onClick={() => mover(c, codigo)}
                      title={c.projectNo ? `Moverla de ${c.projectNo} a ${codigo}` : `Agregarla a ${codigo}`}
                      className="shrink-0 cursor-pointer rounded bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      {busy === c.id ? "…" : c.projectNo ? "Mover" : "Agregar"}
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </>
      )}
    </div>
  );
}

// Cotización de origen del proyecto. Se llena sola al enviar desde Cotizaciones;
// editable a mano para los proyectos creados directo en QBO.
function CotizacionChip({ qbJobId, value }: { qbJobId: string; value: string | null }) {
  const [txt, setTxt] = useState("");
  const [editando, setEditando] = useState(false);
  // Lo escrito acá gana sobre el prop hasta el próximo "Actualizar" (que ya trae
  // el valor guardado). Evita sincronizar el prop con un efecto.
  const [override, setOverride] = useState<string | null | undefined>(undefined);
  const guardado = override === undefined ? value : override;
  const [err, setErr] = useState<string | null>(null);

  async function guardar() {
    const v = txt.trim() ? txt.trim().toUpperCase() : null;
    setEditando(false);
    if (v === guardado) return;
    const r = await setProjectQuoteNo(qbJobId, v);
    if (r.ok) {
      setOverride(v);
      setErr(null);
    } else {
      setErr(r.error);
      setTxt(guardado ?? "");
    }
  }

  if (editando) {
    return (
      <input
        autoFocus
        value={txt}
        onChange={(ev) => setTxt(ev.target.value)}
        onBlur={() => void guardar()}
        onKeyDown={(ev) => {
          if (ev.key === "Enter") void guardar();
          if (ev.key === "Escape") {
            setTxt(guardado ?? "");
            setEditando(false);
          }
        }}
        placeholder="COT DC 26-141"
        className="w-32 rounded-md border border-slate-300 px-1.5 py-0.5 text-[10px] uppercase outline-none focus:border-slate-900"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        setTxt(guardado ?? "");
        setEditando(true);
      }}
      title={err ?? (guardado ? `Cotización ${guardado}` : "Sin cotización — clic para asignarla")}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset transition-colors",
        err
          ? "bg-red-50 text-red-700 ring-red-600/20"
          : guardado
            ? "bg-indigo-50 text-indigo-700 ring-indigo-600/20 hover:bg-indigo-100"
            : "bg-slate-50 text-slate-400 ring-slate-200 hover:bg-slate-100",
      )}
    >
      <FileText className="size-3" />
      {guardado ?? "cotización"}
    </button>
  );
}

// "sin datos de QBO" puede venir de causas muy distintas (el gateway no aisló el
// P&L, la respuesta no parseó, el proyecto está cerrado, el gateway está caído)
// y desde afuera se ven igual. Esto pregunta y muestra qué contestó QBO.
function PorQueSinDatos({ qbJobId, cerrado }: { qbJobId: string; cerrado: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [diag, setDiag] = useState<PnlDiagnostico | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function consultar() {
    setAbierto(true);
    setBusy(true);
    setError(null);
    try {
      const r = await diagnosticarProyecto(qbJobId, cerrado);
      if (r.ok) setDiag(r.data);
      else setError(r.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo consultar");
    } finally {
      setBusy(false);
    }
  }

  const money = (p: { income: number; cost: number } | null) =>
    p ? `cobro ${bal(p.income)} · gasto ${bal(p.cost)}` : "sin respuesta";

  if (!abierto) {
    return (
      <button type="button" onClick={() => void consultar()} className="mt-0.5 text-[10px] font-semibold text-slate-400 hover:text-slate-600">
        ¿por qué?
      </button>
    );
  }
  return (
    <div className="mt-1 rounded-lg bg-slate-50 p-2 text-left ring-1 ring-slate-200">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Diagnóstico</span>
        <button type="button" onClick={() => setAbierto(false)} className="text-[10px] font-semibold text-slate-400 hover:text-slate-600">
          cerrar
        </button>
      </div>
      {busy ? <p className="mt-1 text-[10px] text-slate-400">Consultando QBO…</p> : null}
      {error ? <p className="mt-1 rounded bg-red-50 px-1.5 py-1 text-[10px] text-red-700">{error}</p> : null}
      {diag ? (
        <div className="mt-1 space-y-1 text-[10px] leading-snug text-slate-600">
          <p className="font-semibold text-slate-700">{diag.conclusion}</p>
          <p>
            Empresa: {money(diag.empresa)} · Cliente: {money(diag.cliente)} · {diag.proyecto.siblings} proyecto(s) del mismo cliente
          </p>
          {diag.variantes.map((v, i) => (
            <p key={i} className="truncate" title={`${v.args} → ${v.error ?? ""}`}>
              <span className={cn("font-semibold", v.veredicto.startsWith("ACEPTADA") ? "text-emerald-700" : "text-amber-700")}>
                {v.veredicto}
              </span>
              {v.pnl ? ` — ${money(v.pnl)}` : v.error ? ` — ${v.error.slice(0, 60)}` : ""}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ProjectRow({
  e,
  rangeActive,
  status,
  dates,
  quotes,
  codigo,
  editing,
  pickingQuotes,
  onTogglePickQuotes,
  onQuotesChanged,
  onToggleEdit,
  onChangeStatus,
  onSaveDates,
}: {
  e: Enriched;
  rangeActive: boolean;
  status: ProjectBizStatus;
  dates: { startDate: string | null; endDate: string | null; contractTotal: number | null };
  quotes: { count: number; amount: number } | undefined;
  codigo: string | null;
  editing: boolean;
  pickingQuotes: boolean;
  onTogglePickQuotes: () => void;
  onQuotesChanged: () => void;
  onToggleEdit: () => void;
  onChangeStatus: (s: ProjectBizStatus) => void;
  onSaveDates: (v: { startDate: string | null; endDate: string | null; contractTotal: number | null }) => Promise<void>;
}) {
  const p = e.p;
  const meta = (p.rubro && RUBRO_META[p.rubro]) || RUBRO_FALLBACK;
  const RubroIcon = meta.icon;
  const cerrado = status === "cerrado";
  // Sin fecha de fin del contrato, el "fin" que se calcula es el último mes con
  // movimiento en QBO — que en un proyecto vivo es el mes actual. Pintarlo como
  // fecha de cierre hace ver terminado lo que sigue corriendo. El cálculo del
  // rango igual la usa (necesita un intervalo); lo que cambia es lo que se lee.
  const sinFin = e.eff && !dates.endDate ? SIN_FIN[status] : undefined;
  // `parcial`: el rango muestra solo una porción del proyecto. `prorrateado`:
  // además esa porción es una ESTIMACIÓN (repartida por días) y no lo que
  // QuickBooks reportó en esos meses — solo ahí corresponde el aviso.
  const parcial = rangeActive && e.fraction < 1;
  const prorrateado = parcial && !e.real;
  const conDatos = e.enRango !== null || p.income !== null;
  const fuente = e.eff?.fuente ?? "sin";
  const cobro = e.enRango ?? p.income ?? 0;
  const gasto = e.gastoRango ?? p.cost ?? 0;
  const celdaFecha = "hidden whitespace-nowrap px-3 py-2.5 lg:table-cell";
  return (
    <>
      <tr className={cn("border-b border-slate-50 last:border-0 hover:bg-slate-50/60", cerrado && "opacity-60")}>
        <td className="hidden px-3 py-2.5 sm:table-cell">
          <span className={cn("flex size-8 items-center justify-center rounded-xl", meta.chip)} title={meta.label}>
            <RubroIcon className="size-4" />
          </span>
        </td>

        <td className="max-w-[150px] px-3 py-2.5 sm:max-w-[260px] xl:max-w-[380px]">
          <div className="truncate font-medium text-slate-900" title={p.fullName}>
            {p.name}
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
            <Building2 className="size-3 shrink-0 text-slate-400" />
            <span className="truncate" title={p.clientName}>
              {p.clientName || meta.label}
            </span>
          </div>
        </td>

        {/* Cobro. Con rango activo el número es el del rango; el total queda de
            apoyo abajo para no perder la escala del proyecto completo. */}
        <td className="whitespace-nowrap px-3 py-2.5 text-right">
          {conDatos ? (
            <>
              <div className="font-semibold tabular-nums text-slate-900">{bal(cobro)}</div>
              {parcial && e.totalBase !== null ? (
                <div className="text-[11px] tabular-nums text-slate-400" title={e.usaContrato ? "Contrato total" : "Total del proyecto"}>
                  de {bal(e.totalBase)} ({Math.round(e.fraction * 100)}%)
                </div>
              ) : null}
            </>
          ) : (
            <div className="text-right">
              <span className="text-[11px] italic text-slate-300">{cerrado ? "—" : "sin datos de QBO"}</span>
              <PorQueSinDatos qbJobId={p.id} cerrado={cerrado} />
            </div>
          )}
        </td>

        <td className="whitespace-nowrap px-3 py-2.5 text-right">
          {conDatos ? (
            <span className="font-medium tabular-nums text-rose-600" title={prorrateado ? "Prorrateado por días: el rango corta meses sin desglose en QuickBooks" : undefined}>
              {e.gastoRango !== null ? bal(e.gastoRango) : p.cost !== null ? bal(p.cost) : "—"}
              {prorrateado ? <span className="text-rose-300"> ~</span> : null}
            </span>
          ) : (
            <span className="text-slate-300">—</span>
          )}
        </td>

        <td className="w-28 whitespace-nowrap px-3 py-2.5 text-right">
          {conDatos ? (
            <>
              {p.margin !== null ? (
                <div className={cn("text-xs font-semibold tabular-nums", marginTextColor(p.margin))}>{Math.round(p.margin * 100)}%</div>
              ) : (
                <div className="text-xs text-slate-300">—</div>
              )}
              <div className="mt-1">
                <ProfitBar income={cobro} cost={gasto} />
              </div>
            </>
          ) : (
            <span className="text-slate-300">—</span>
          )}
        </td>

        {/* Fechas: clic en cualquiera abre el editor, igual que el chip anterior.
            El ámbar marca "asumida", que es la única que puede estar lejos. */}
        <td className={celdaFecha}>
          <button
            type="button"
            onClick={onToggleEdit}
            title={FUENTE_TITULO[fuente]}
            className={cn(
              "cursor-pointer rounded px-1 py-0.5 text-xs tabular-nums hover:bg-slate-100",
              fuente === "asumido" ? "text-amber-700" : fuente === "manual" ? "font-medium text-slate-900" : "text-slate-600",
            )}
          >
            {e.eff ? fmtCorta(e.eff.start) : "—"}
            {fuente === "asumido" ? "*" : ""}
          </button>
        </td>

        <td className={celdaFecha}>
          <button
            type="button"
            onClick={onToggleEdit}
            title={sinFin?.title ?? FUENTE_TITULO[fuente]}
            className={cn(
              "cursor-pointer rounded px-1 py-0.5 text-xs hover:bg-slate-100",
              sinFin ? "font-medium text-slate-500" : fuente === "asumido" ? "tabular-nums text-amber-700" : fuente === "manual" ? "font-medium tabular-nums text-slate-900" : "tabular-nums text-slate-600",
            )}
          >
            {!e.eff ? "—" : sinFin ? sinFin.label : `${fmtCorta(e.eff.end)}${fuente === "asumido" ? "*" : ""}`}
          </button>
        </td>

        <td className="whitespace-nowrap px-3 py-2.5">
          <StatusPicker value={status} onChange={onChangeStatus} />
        </td>

        {/* Cotizaciones de origen. Un proyecto puede tener varias, así que el
            link lleva a Cotizaciones filtrado por el correlativo en vez de
            abrir una sola. Sin match, queda el número editable a mano. */}
        {/* El chip abre el panel para armar la lista; la flecha va a verlas en
            Cotizaciones. Sin correlativo no hay con qué vincular. */}
        <td className="hidden whitespace-nowrap px-3 py-2.5 md:table-cell">
          {codigo ? (
            <span className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={onTogglePickQuotes}
                aria-expanded={pickingQuotes}
                title={
                  quotes
                    ? `${quotes.count} cotización${quotes.count === 1 ? "" : "es"} · ${bal(quotes.amount)} cotizado — clic para agregar o quitar`
                    : `Sin cotizaciones asignadas a ${codigo} — clic para agregarlas`
                }
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset transition-colors",
                  quotes
                    ? "bg-violet-50 text-violet-700 ring-violet-600/20 hover:bg-violet-100"
                    : "bg-slate-50 text-slate-400 ring-slate-200 hover:bg-slate-100 hover:text-slate-600",
                  pickingQuotes && "ring-2 ring-violet-400",
                )}
              >
                <FileText className="size-3" />
                {quotes ? (
                  <>
                    {quotes.count}
                    <span className="font-normal text-violet-500">· {bal(quotes.amount)}</span>
                  </>
                ) : (
                  "Agregar"
                )}
              </button>
              {quotes ? (
                <Link
                  href={`/potenciales?q=${encodeURIComponent(codigo)}`}
                  title={`Ver las cotizaciones de ${codigo} en Cotizaciones`}
                  className="cursor-pointer rounded p-0.5 text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-600"
                >
                  <ArrowUpRight className="size-3.5" />
                </Link>
              ) : null}
            </span>
          ) : (
            <CotizacionChip qbJobId={p.id} value={p.quoteNumber} />
          )}
        </td>

        <td className="px-3 py-2.5 text-right">
          <button
            type="button"
            onClick={onToggleEdit}
            aria-label="Editar fechas y contrato"
            aria-expanded={editing}
            title="Editar fechas y monto del contrato"
            className={cn(
              "cursor-pointer rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700",
              editing && "bg-slate-100 text-slate-700",
            )}
          >
            <CalendarRange className="size-4" />
          </button>
        </td>
      </tr>
      {editing ? (
        <tr className="border-b border-slate-50">
          <td colSpan={10} className="px-3 pb-3">
            <DatesEditor initial={dates} onSave={onSaveDates} onCancel={onToggleEdit} />
          </td>
        </tr>
      ) : null}
      {pickingQuotes && codigo ? (
        <tr className="border-b border-slate-50">
          <td colSpan={10} className="px-3 pb-3">
            <CotizacionesPicker codigo={codigo} onClose={onTogglePickQuotes} onChanged={onQuotesChanged} />
          </td>
        </tr>
      ) : null}
    </>
  );
}


