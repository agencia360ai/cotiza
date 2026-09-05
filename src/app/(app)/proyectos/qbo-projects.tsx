"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { getQboProjects, setProjectStatus, setProjectDates, diagnosticarProyecto, setProjectQuoteNo, getQuotesPorProyecto, listCotizacionesAsignables, asignarCotizaciones, diagnosticarCobradoAction, diagnosticarFechasAction, type QboProjectsResult, type QuotesPorProyecto, type CotizacionAsignable } from "./qbo-actions";
import { codigoDeProyecto } from "@/lib/quickbooks/codigo";
import { toggleSort, compareVals, type SortState } from "@/components/ui/sortable";
import { useColumnas, ColumnaTh, ColumnasMenu, SORT_DE_COL, type ColKey, type Columnas } from "./columnas";
import type { QboProject, ProjectBizStatus, PnlDiagnostico } from "@/lib/quickbooks/projects";
import {
  effectiveDates,
  overlapFraction,
  sumarMeses,
  finDeMes,
  type DateRange,
  type FechasEfectivas,
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
const SIN_FIN: Partial<Record<ProjectBizStatus, { label: string; title: string; cls: string }>> = {
  activo: {
    cls: "bg-slate-100 text-slate-600 ring-slate-200",
    label: "Sin cerrar",
    title:
      "Sigue en ejecución: no tiene fecha de fin cargada. QuickBooks solo sabe hasta cuándo hubo movimiento, no cuándo termina — haz clic para poner la del contrato.",
  },
  por_cobrar: {
    cls: "bg-rose-50 text-rose-700 ring-rose-600/20",
    label: "Falta fecha",
    title:
      "El trabajo terminó pero el proyecto sigue sin fecha de fin. Hay que cargarla en QuickBooks — haz clic para ponerla acá.",
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
// Fecha de calendario: día, mes y año, sin abreviar el año — "ago 26" se leía
// tanto como "26 de agosto" como "agosto de 2026", y en un board donde el rango
// de fechas cambia lo que muestran todas las demás columnas esa duda cuesta.
//
// Las fechas ASUMIDAS van sin día: cuando solo se sabe el año del proyecto, el
// cálculo pone 1-ene/31-dic, y escribir ese día lo haría pasar por un dato.
function fmtFecha(iso: string, conDia: boolean): string {
  const [y, m, d] = iso.split("-").map(Number);
  const mes = MESES_CORTOS[(m ?? 1) - 1];
  return conDia ? `${d} ${mes} ${y}` : `${mes} ${y}`;
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

type SortKey = "nombre" | "cliente" | "cobro" | "cobrado" | "gasto" | "margen" | "inicio" | "fin" | "estado" | "cotizacion";

// Proyección de un proyecto dentro del rango activo.
//
// `real` distingue las dos formas de llegar a los montos del rango:
//   true  → se sumaron los meses que QuickBooks reportó dentro del rango.
//   false → se prorrateó el total por días (proyecto sin desglose mensual:
//           cerrado con números congelados, o un contrato aún sin facturar).
type Enriched = {
  p: QboProject;
  eff: FechasEfectivas | null;
  fraction: number; // 0..1 dentro del rango (1 sin rango o sin fechas)
  inRange: boolean;
  real: boolean;
  totalBase: number | null; // contrato (o cobro real como fallback)
  usaContrato: boolean;
  enRango: number | null; // meses del rango, o totalBase × fraction
  gastoRango: number | null;
  // Lo cobrado que cae en el rango. QuickBooks solo da el saldo pendiente de
  // HOY, así que `paid` es una foto sin fecha: para recortarlo al rango se
  // reparte según qué porción de lo FACTURADO cae adentro. Null = sin dato.
  cobradoRango: number | null;
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
  // Orden y visibilidad de las columnas: preferencia de cada quien, guardada en
  // el navegador. `arrastrando` es solo el estado del gesto en curso.
  const cols = useColumnas();
  const [arrastrando, setArrastrando] = useState<ColKey | null>(null);
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
        txnDatesSource: p.txnDatesSource,
        year: p.year,
      });
      const meses = p.meses ?? [];
      const contractTotal = d.contractTotal;
      const usaContrato = contractTotal !== null;
      const totalBase = contractTotal ?? p.income;
      const round2 = (n: number) => Math.round(n * 100) / 100;
      // Se prorratea sobre lo FACTURADO, nunca sobre el total de contrato: un
      // contrato firmado y todavía sin facturar no tiene nada cobrado que
      // repartir, y usar su monto inflaría la barra verde.
      const cobradoDe = (share: number): number | null =>
        p.paid === null ? null : round2(p.paid * Math.min(1, Math.max(0, share)));

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
          cobradoRango: cobradoDe(p.income && p.income > 0 ? s.income / p.income : 1),
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
        cobradoRango: cobradoDe(fraction),
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
        case "cobrado":
          return e.cobradoRango;
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
  //
  // El cobrado sale del MISMO número que muestran la columna y el KPI, repartido
  // entre los meses igual que lo facturado. Así la barra verde suma exactamente
  // lo mismo que la columna —dos cifras para lo mismo es peor que una cifra
  // menos— y la distancia hasta la barra oscura es lo que ese mes sigue sin
  // cobrarse. Dice "de lo facturado en este mes, cuánto entró", no la fecha en
  // que entró la plata: QuickBooks solo da el saldo pendiente de hoy.
  const serieMensual = useMemo(() => {
    const acc = new Map<string, { cobro: number; gasto: number; cobrado: number; conCobrado: boolean }>();
    const suma = (mes: string, cobro: number, gasto: number, cobrado: number | null) => {
      const b = acc.get(mes) ?? { cobro: 0, gasto: 0, cobrado: 0, conCobrado: false };
      b.cobro += cobro;
      b.gasto += gasto;
      if (cobrado !== null) {
        b.cobrado += cobrado;
        b.conCobrado = true;
      }
      acc.set(mes, b);
    };
    for (const e of sorted) {
      // El cobrado se reparte en la MISMA proporción que lo facturado, para que
      // la serie sume el total de la columna por construcción y no por suerte.
      const porcion = (parte: number): number | null =>
        e.cobradoRango === null || !e.enRango ? null : (parte / e.enRango) * e.cobradoRango;
      if (e.real) {
        for (const m of e.meses) {
          const f = range ? overlapFraction(m.month, finDeMes(m.month), range) : 1;
          if (f > 0) suma(m.month, m.income * f, m.cost * f, porcion(m.income * f));
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
      for (const mes of cubiertos) {
        suma(
          mes,
          (e.enRango ?? 0) * porMes,
          (e.gastoRango ?? 0) * porMes,
          e.cobradoRango === null ? null : e.cobradoRango * porMes,
        );
      }
    }
    return Array.from(acc, ([month, v]) => ({
      month,
      cobro: v.cobro,
      gasto: v.gasto,
      cobrado: v.conCobrado ? v.cobrado : null,
    })).sort((a, b) => a.month.localeCompare(b.month));
  }, [sorted, range]);

  // Totales de la vista actual. `prorrateados` cuenta los que NO tienen desglose
  // mensual de QBO y por lo tanto llevan un monto repartido por días — es el
  // aviso de "este número es una estimación", no un dato de QuickBooks.
  const vista = useMemo(() => {
    let cobro = 0;
    let gasto = 0;
    let prorrateados = 0;
    // El cobrado solo suma donde HAY dato. Si ningún proyecto lo tiene, el KPI
    // dice "s/d" en vez de un cero que se leería como "no cobramos nada".
    let cobrado = 0;
    let conCobrado = 0;
    for (const e of sorted) {
      cobro += e.enRango ?? 0;
      gasto += e.gastoRango ?? 0;
      if (e.cobradoRango !== null) {
        cobrado += e.cobradoRango;
        conCobrado++;
      }
      if (!e.real && e.fraction < 1) prorrateados++;
    }
    // Por cobrar y abiertos son del proyecto ENTERO, no de la porción en rango:
    // un proyecto no está "medio por cobrar" porque el filtro corte su año.
    let porCobrar = 0;
    let nPorCobrar = 0;
    let abiertos = 0;
    for (const e of sorted) {
      const st = statusOf(e.p);
      if (st === "por_cobrar") {
        nPorCobrar++;
        porCobrar += e.p.income ?? 0;
      }
      if (st !== "cerrado") abiertos++;
    }
    return {
      cobro,
      gasto,
      prorrateados,
      cobrado: conCobrado > 0 ? cobrado : null,
      porCobrar,
      nPorCobrar,
      abiertos,
      margen: cobro > 0 ? (cobro - gasto) / cobro : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, statusOv]);

  // Pendientes de la vista. Se cuentan sobre lo FILTRADO: si el equipo mira
  // solo mantenimiento, el pie tiene que hablar de mantenimiento.
  const pendientes = useMemo(() => {
    let sinCotizacion = 0;
    let sinFechaFin = 0;
    for (const e of sorted) {
      const code = codigoDeProyecto(e.p.name) ?? codigoDeProyecto(e.p.fullName);
      if (!code || !quotes[code]) sinCotizacion++;
      if (statusOf(e.p) === "por_cobrar" && !datesOf(e.p).endDate) sinFechaFin++;
    }
    return { sinCotizacion, sinFechaFin };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, quotes, statusOv, datesOv]);

  // Degradado en el borde derecho mientras quede tabla por ver. En macOS la
  // barra de scroll está oculta, así que sin esto la tabla se lee como cortada
  // y nadie descubre que hay columnas más allá.
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [hayMas, setHayMas] = useState(false);
  const medirScroll = (el: HTMLDivElement | null) => {
    if (!el) return;
    setHayMas(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
  };
  const onScrollTabla = (e: React.UIEvent<HTMLDivElement>) => medirScroll(e.currentTarget);
  useEffect(() => {
    const el = scrollerRef.current;
    medirScroll(el);
    if (!el) return;
    const ro = new ResizeObserver(() => medirScroll(el));
    ro.observe(el);
    return () => ro.disconnect();
  }, [sorted.length]);

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

      {/* Los cinco números que resumen la vista. Responden al rango y a los
          filtros activos: es el estado de LO QUE SE ESTÁ MIRANDO. */}
      {hasProjects ? (
        <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          {/* Los tres KPIs de plata responden todos al rango; decírselo solo a
              este hacía pensar que los otros dos no. */}
          <KpiProyecto label="Total facturado" value={bal(vista.cobro)} />
          {/* Lo que efectivamente entró. Se separa del total porque facturar no
              es cobrar, y en una empresa que vive del flujo esa es la diferencia
              que importa. "s/d" cuando QuickBooks no dio el pendiente. */}
          <KpiProyecto
            label="Cobrado"
            value={vista.cobrado !== null ? bal(vista.cobrado) : "s/d"}
            sub={vista.cobrado !== null && vista.cobro > 0 ? `${Math.round((vista.cobrado / vista.cobro) * 100)}% del total` : undefined}
            color="#047857"
            // Sin dato hay que poder ver POR QUÉ: el reporte puede no existir,
            // no traer filas, o traer ids que no son los de estos proyectos.
            extra={vista.cobrado === null ? <PorQueSinCobrado /> : null}
          />
          <KpiProyecto label="Gasto" value={bal(vista.gasto)} color="#BE123C" />
          <KpiProyecto
            label="Margen"
            value={vista.margen !== null ? `${Math.round(vista.margen * 100)}%` : "s/d"}
            color={vista.margen !== null && vista.margen >= 0.3 ? "#047857" : "#B45309"}
            tint="bg-[#F8FDFB]"
          />
          <KpiProyecto
            label="Por cobrar"
            value={bal(vista.porCobrar)}
            sub={`${vista.nPorCobrar} pendiente${vista.nPorCobrar === 1 ? "" : "s"}`}
            color="#B45309"
          />
          <KpiProyecto label="Abiertos" value={String(vista.abiertos)} sub={`de ${sorted.length} en la vista`} />
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
            <ColumnasMenu cols={cols} />
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
            <div className="relative">
              <div ref={scrollerRef} onScroll={onScrollTabla} className="overflow-x-auto rounded-b-2xl">
                <table className="w-full text-[13px]" style={{ minWidth: cols.minWidth }}>
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                    <th className="w-10 px-2 py-2.5"></th>
                    {cols.visibles.map((k) => (
                      <ColumnaTh
                        key={k}
                        col={k}
                        sortKey={SORT_DE_COL[k] as SortKey}
                        sort={sort}
                        onSort={(sk) => setSort((v) => toggleSort(v, sk, k === "nombre" || k === "cliente" || k === "estado" ? "asc" : "desc"))}
                        arrastrando={arrastrando}
                        onArrastrar={(from, to) => {
                          if (from === to) return setArrastrando(from);
                          cols.reordenar(from, to);
                          setArrastrando(null);
                        }}
                      />
                    ))}
                    <th className="w-11 px-2 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.slice(0, RENDER_CAP).map((e) => (
                    <ProjectRow
                      key={e.p.id}
                      e={e}
                      rangeActive={rangeActive}
                      cols={cols}
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
              {hayMas ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-white to-transparent"
                />
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-soft bg-surface-muted px-4 py-2.5 text-[11px] text-slate-500">
              <span>
                Mostrando{" "}
                <span className="font-semibold tabular-nums text-slate-700">
                  {Math.min(sorted.length, RENDER_CAP)} de {projects.length}
                </span>
              </span>
              {pendientes.sinCotizacion > 0 ? (
                <span className="text-orange-700">
                  · <span className="font-semibold tabular-nums">{pendientes.sinCotizacion}</span> sin cotización vinculada
                </span>
              ) : null}
              {/* Ni una sola fecha con día real: la lectura de transacciones no
                  está trayendo nada y conviene poder ver por qué. */}
              {sorted.length > 0 && !sorted.some((e) => e.eff?.diaStart || e.eff?.diaEnd) ? (
                <span>· <PorQueSinDia /></span>
              ) : null}
              {pendientes.sinFechaFin > 0 ? (
                <span className="text-rose-700">
                  · <span className="font-semibold tabular-nums">{pendientes.sinFechaFin}</span> por cobrar sin fecha de fin en QuickBooks
                </span>
              ) : null}
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
// texto (nunca del color de la serie). Cobro y gasto van LADO A LADO, igual que
// en Inicio: las dos series arrancan de la misma base y se comparan por altura
// sin que una tape a la otra. Antes el gasto iba dentro de la barra de cobro y
// en los meses de gasto alto casi la llenaba, haciendo ver poco margen donde
// había, y encima cada pantalla dibujaba lo mismo distinto.
type PuntoMes = { month: string; cobro: number; gasto: number; cobrado: number | null };

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
  // Dos barras por mes: cada una toma poco menos de la mitad del espacio útil,
  // y el gap las separa lo justo para leerlas como un par y no como dos cosas.
  // Dos o tres barras por mes según haya serie de cobrado. El ancho se reparte
  // entre las que haya para que el grupo ocupe siempre lo mismo.
  const hayCobrado = data.some((d) => d.cobrado !== null);
  const nBarras = hayCobrado ? 3 : 2;
  const barW = Math.max(3, Math.min(13, (slot * 0.62) / nBarras));
  const gap = Math.max(1.5, barW * 0.22);
  const y = (v: number) => H - PAD_B - (v / max) * (H - PAD_B - PAD_T);
  const maxIdx = data.reduce((mi, d, i) => (d.cobro > data[mi].cobro ? i : mi), 0);
  const totalCobro = data.reduce((a, d) => a + d.cobro, 0);
  const totalGasto = data.reduce((a, d) => a + d.gasto, 0);
  const conCobrado = data.filter((d) => d.cobrado !== null);
  const totalCobrado = conCobrado.length > 0 ? conCobrado.reduce((a, d) => a + (d.cobrado ?? 0), 0) : null;
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
        <h3 className="text-sm font-semibold text-slate-900">
          {hayCobrado ? "Facturado, cobrado y gasto por mes" : "Facturado y gasto por mes"}
        </h3>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="inline-flex items-center gap-1.5 text-slate-500">
            <span className="size-2 rounded-full bg-[#1E293B]" /> Facturado
            <span className="font-semibold tabular-nums text-slate-900">{balCompact(totalCobro)}</span>
          </span>
          {totalCobrado !== null ? (
            <span className="inline-flex items-center gap-1.5 text-slate-500">
              <span className="size-2 rounded-full bg-[#059669]" /> Cobrado
              <span className="font-semibold tabular-nums text-emerald-700">{balCompact(totalCobrado)}</span>
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1.5 text-slate-500">
            <span className="size-2 rounded-full bg-[#F43F5E]" /> Gasto
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
        {hayCobrado ? " Cobrado = de lo facturado ese mes, cuánto ya entró; lo que falta hasta la barra oscura sigue por cobrar." : ""}
      </p>

      <div className="relative">
        {/* El aria-label lleva los números, no solo el título: para un lector de
            pantalla la gráfica es su descripción — "gráfica de barras" no dice nada. */}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={`${hayCobrado ? "Facturado, cobrado y gasto por mes" : "Facturado y gasto por mes"}. ${data
            .map((d) => `${fmtCorta(d.month)}: facturado ${balCompact(d.cobro)}${d.cobrado !== null ? `, cobrado ${balCompact(d.cobrado)}` : ""}, gasto ${balCompact(d.gasto)}`)
            .join(". ")}`}
        >
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <line key={f} x1={PAD_L} x2={W - PAD_L} y1={y(max * f)} y2={y(max * f)} stroke="#F1F5F9" strokeWidth="1" />
          ))}
          <line x1={PAD_L} x2={W - PAD_L} y1={H - PAD_B} y2={H - PAD_B} stroke="#E2E8F0" strokeWidth="1" />

          {data.map((d, i) => {
            const cx = PAD_L + slot * i + slot / 2;
            // Grupo centrado en el mes, sea de dos barras o de tres.
            const anchoGrupo = nBarras * barW + (nBarras - 1) * gap;
            const x0 = cx - anchoGrupo / 2;
            const xCobro = x0;
            const xCobrado = hayCobrado ? x0 + barW + gap : null;
            const xGasto = x0 + (nBarras - 1) * (barW + gap);
            const active = hover === i;
            const dim = hover !== null && !active;
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
                  <path d={barra(d.cobro, xCobro, barW)} fill={active ? "#0F172A" : "#1E293B"} style={{ pointerEvents: "none" }} />
                ) : null}
                {/* Cobrado: lo que entró ese mes. Verde porque es plata en la
                    mano, no una promesa — y al lado del facturado la brecha
                    entre los dos es lo que se está financiando. */}
                {xCobrado !== null && (d.cobrado ?? 0) > 0 ? (
                  <path d={barra(d.cobrado ?? 0, xCobrado, barW)} fill="#059669" style={{ pointerEvents: "none" }} />
                ) : null}
                {d.gasto > 0 ? (
                  <path d={barra(d.gasto, xGasto, barW)} fill="#F43F5E" style={{ pointerEvents: "none" }} />
                ) : null}
                {/* Etiqueta directa solo en el mes más alto: da la escala sin
                    obligar a pasar el mouse ni llenar la gráfica de números. */}
                {i === maxIdx && d.cobro > 0 && hover === null ? (
                  <text x={cx - barW / 2 - gap / 4} y={y(d.cobro) - 5} textAnchor="middle" className="fill-slate-600" fontSize="10" fontWeight="600">
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
            <span className="font-semibold">{fmtCorta(data[hover].month)}</span> · facturado {balCompact(data[hover].cobro)}
            {data[hover].cobrado !== null ? ` · cobrado ${balCompact(data[hover].cobrado ?? 0)}` : ""} · gasto{" "}
            {balCompact(data[hover].gasto)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// Barra de rentabilidad: gasto (rosa) vs margen (verde) como % del cobro.
// KPI de la cabecera de Proyectos. El valor va con clamp y nowrap: cinco
// montos en fila no se pueden pisar entre sí en pantallas angostas.
function KpiProyecto({
  label,
  value,
  sub,
  color,
  tint,
  extra,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  tint?: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-card border border-line bg-surface px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,.04)]", tint)}>
      <p className="text-[10px] font-bold uppercase tracking-[0.09em] text-slate-500">{label}</p>
      <p
        className="mt-0.5 whitespace-nowrap font-bold tracking-[-0.03em] tabular-nums text-slate-900"
        style={{ fontSize: "clamp(18px, 1.6vw, 24px)", ...(color ? { color } : {}) }}
      >
        {value}
      </p>
      {sub ? <p className="text-[11px] text-slate-500">{sub}</p> : null}
      {extra}
    </div>
  );
}

// Diagnóstico del cobrado. Lo mismo que PorQueSinDatos hace con el P&L: cuando
// el número no está, el camino para averiguarlo tiene que estar al lado del
// hueco, no en la cabeza de quien programó.
function PorQueSinCobrado() {
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [txt, setTxt] = useState<string | null>(null);

  async function ver() {
    setAbierto(true);
    if (txt || cargando) return;
    setCargando(true);
    const r = await diagnosticarCobradoAction();
    setCargando(false);
    if (!r.ok) {
      setTxt(r.error);
      return;
    }
    const d = r.data;
    setTxt(
      [
        `Herramienta: ${d.herramienta ?? "ninguna"}`,
        d.variante ? `Variante: ${d.variante}` : null,
        `IDs en el reporte: ${d.totalIdsReporte} · coinciden con proyectos: ${d.idsQueMatchean}`,
        d.idsEnReporte.length ? `Primeros: ${d.idsEnReporte.join(", ")}` : null,
        "",
        d.muestraCruda,
      ]
        .filter((x) => x !== null)
        .join("\n"),
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={ver}
        className="mt-0.5 cursor-pointer text-[11px] text-slate-400 underline decoration-dotted hover:text-slate-600"
      >
        sin dato de QBO · por qué
      </button>
      {abierto ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onClick={() => setAbierto(false)}>
          <div className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-card bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Por qué no hay cobrado</h3>
              <button type="button" onClick={() => setAbierto(false)} className="cursor-pointer rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100">
                Cerrar
              </button>
            </div>
            <pre className="whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-700">
              {cargando ? "Consultando QuickBooks…" : txt}
            </pre>
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * Por qué las fechas no tienen día.
 *
 * Aparece solo cuando NINGÚN proyecto de la vista trae día real: ahí no es una
 * curiosidad, es que la lectura de transacciones no está funcionando, y sin
 * esto la única forma de saber por qué sería adivinar.
 */
function PorQueSinDia() {
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [txt, setTxt] = useState<string | null>(null);

  async function ver() {
    setAbierto(true);
    if (txt || cargando) return;
    setCargando(true);
    const r = await diagnosticarFechasAction();
    setCargando(false);
    if (!r.ok) {
      setTxt(r.error);
      return;
    }
    const d = r.data;
    setTxt(
      [
        `Herramientas de transacciones en el gateway: ${d.herramientas.join(", ") || "(ninguna)"}`,
        "",
        ...d.probadas.map(
          (p) =>
            `${p.tool} ${p.variante} → ${p.error ? `error: ${p.error}` : `fechas de ${p.fechasVistas} clientes, ${p.idsQueMatchean} son proyectos nuestros`}`,
        ),
        "",
        d.muestraCruda,
      ].join("\n"),
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={ver}
        className="cursor-pointer text-[11px] text-slate-400 underline decoration-dotted hover:text-slate-600"
      >
        fechas sin día · por qué
      </button>
      {abierto ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onClick={() => setAbierto(false)}>
          <div className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-card bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Por qué las fechas no tienen día</h3>
              <button type="button" onClick={() => setAbierto(false)} className="cursor-pointer rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100">
                Cerrar
              </button>
            </div>
            <pre className="whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-700">
              {cargando ? "Consultando QuickBooks…" : txt}
            </pre>
          </div>
        </div>
      ) : null}
    </>
  );
}

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
        className="h-8 w-[118px] cursor-pointer appearance-none rounded-lg bg-transparent px-2.5 text-xs font-semibold text-transparent focus:outline-none focus:ring-2 focus:ring-slate-900/10"
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
  cols,
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
  cols: Columnas;
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
  // Gasto en cero con cobro registrado en un proyecto vivo no es 100% de
  // margen: es gasto sin cargar. Mostrar 100% invita a leer una ganancia que
  // no existe, así que el margen dice s/d y la barra queda gris.
  const faltaGasto = (e.gastoRango ?? p.cost ?? 0) === 0 && (e.enRango ?? p.income ?? 0) > 0 && status !== "cerrado";
  // `parcial`: el rango muestra solo una porción del proyecto. `prorrateado`:
  // además esa porción es una ESTIMACIÓN (repartida por días) y no lo que
  // QuickBooks reportó en esos meses — solo ahí corresponde el aviso.
  const parcial = rangeActive && e.fraction < 1;
  const prorrateado = parcial && !e.real;
  const conDatos = e.enRango !== null || p.income !== null;
  const fuente = e.eff?.fuente ?? "sin";
  const cobro = e.enRango ?? p.income ?? 0;
  const gasto = e.gastoRango ?? p.cost ?? 0;
  // La celda del margen cuando no tiene columna propia: va pegada al total,
  // que es de donde sale.
  const margenAdentro = !cols.ocultas.has("margen") ? null : faltaGasto ? (
    <div className="mt-0.5 text-[11px] font-semibold text-orange-600" title="Falta cargar el gasto en QuickBooks">
      margen s/d
    </div>
  ) : p.margin !== null ? (
    <div className="mt-1 flex items-center justify-end gap-1.5">
      <span className="w-12">
        <ProfitBar income={cobro} cost={gasto} />
      </span>
      <span className={cn("text-[11px] font-semibold tabular-nums", marginTextColor(p.margin))}>
        {Math.round(p.margin * 100)}%
      </span>
    </div>
  ) : null;

  const botonFecha = (iso: string | null, conDia: boolean, esFin: boolean) => (
    <button
      type="button"
      onClick={onToggleEdit}
      title={
        (esFin ? sinFin?.title : undefined) ??
        (iso && !conDia
          ? `${FUENTE_TITULO[fuente]} — sin día: QuickBooks reporta el movimiento por mes, no por fecha`
          : FUENTE_TITULO[fuente])
      }
      className={cn(
        "cursor-pointer rounded px-1 py-0.5 text-[13px] tabular-nums transition-colors hover:bg-slate-100",
        fuente === "asumido" ? "text-amber-700" : fuente === "manual" ? "font-medium text-slate-900" : "text-slate-700",
      )}
    >
      {iso === null ? "—" : `${fmtFecha(iso, conDia)}${fuente === "asumido" ? "*" : ""}`}
    </button>
  );

  // Cada celda vive bajo su llave porque el orden de las columnas lo elige quien
  // mira, no el JSX. Sin esto, mover una columna sería editar código.
  const celdas: Record<ColKey, ReactNode> = {
    nombre: (
      <td key="nombre" className="max-w-[190px] px-3 py-2.5 sm:max-w-[250px] xl:max-w-[285px]">
        <div className="truncate font-semibold text-slate-900" title={p.fullName}>
          {p.name}
        </div>
        {/* Sin columna de Cliente el dato baja acá: es lo que más se necesita
            cuando dos proyectos se llaman parecido. */}
        {cols.ocultas.has("cliente") ? (
          <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
            <Building2 className="size-3 shrink-0 text-slate-400" />
            <span className="truncate">{p.clientName || meta.label}</span>
          </div>
        ) : null}
      </td>
    ),

    cliente: (
      <td key="cliente" className="max-w-[110px] px-3 py-2.5 xl:max-w-[150px]">
        <span className="block truncate text-slate-600" title={p.clientName}>
          {p.clientName || "—"}
        </span>
      </td>
    ),

    // Cotización de origen: el chip abre el panel para armarla; la flecha lleva
    // a verlas en Cotizaciones. Sin correlativo no hay con qué vincular, así que
    // queda el número editable a mano.
    cotizacion: (
      <td key="cotizacion" className="whitespace-nowrap px-3 py-2.5">
        {codigo ? (
          <span className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={onTogglePickQuotes}
              aria-expanded={pickingQuotes}
              title={
                quotes
                  ? `${quotes.count} cotización${quotes.count === 1 ? "" : "es"} · ${bal(quotes.amount)} cotizado — clic para agregar o quitar`
                  : `Sin cotizaciones vinculadas a ${codigo} — clic para vincularlas`
              }
              className={cn(
                "inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset transition-colors",
                quotes
                  ? "bg-violet-50 text-violet-700 ring-violet-600/20 hover:bg-violet-100"
                  : // Naranja: es una acción pendiente, no un dato faltante.
                    "bg-orange-50 text-orange-700 ring-orange-600/20 hover:bg-orange-100",
                pickingQuotes && "ring-2 ring-violet-400",
              )}
            >
              <FileText className="size-3" />
              {quotes ? (
                <>
                  {quotes.count}
                  <span className="font-normal text-violet-500">· {balCompact(quotes.amount)}</span>
                </>
              ) : (
                "Vincular cotización"
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
    ),

    // Total facturado. Con rango activo el número es el del rango; el total del
    // proyecto queda de apoyo abajo para no perder la escala.
    total: (
      <td key="total" className="whitespace-nowrap px-2.5 py-2.5 text-right">
        {conDatos ? (
          <>
            <div className="font-semibold tabular-nums text-slate-900">{bal(cobro)}</div>
            {parcial && e.totalBase !== null ? (
              <div className="text-[11px] tabular-nums text-slate-400" title={e.usaContrato ? "Contrato total" : "Total del proyecto"}>
                de {bal(e.totalBase)} ({Math.round(e.fraction * 100)}%)
              </div>
            ) : null}
            {margenAdentro}
          </>
        ) : (
          <div className="text-right">
            <span className="text-[11px] italic text-slate-300">{cerrado ? "—" : "sin datos de QBO"}</span>
            <PorQueSinDatos qbJobId={p.id} cerrado={cerrado} />
          </div>
        )}
      </td>
    ),

    // Cobrado: lo que entró de verdad. En gris cuando falta el dato, para no
    // confundir "no sé" con "no cobraron".
    cobrado: (
      <td key="cobrado" className="whitespace-nowrap px-2.5 py-2.5 text-right">
        {!conDatos ? (
          <span className="text-slate-300">—</span>
        ) : e.cobradoRango === null ? (
          <span className="text-[11px] italic text-slate-400" title="QuickBooks no reportó el saldo pendiente de este proyecto">
            s/d
          </span>
        ) : (
          <span
            className="font-medium tabular-nums text-emerald-700"
            title={parcial && p.paid !== null ? `${bal(p.paid)} cobrados en todo el proyecto` : undefined}
          >
            {bal(e.cobradoRango)}
          </span>
        )}
      </td>
    ),

    gasto: (
      <td key="gasto" className="whitespace-nowrap px-2.5 py-2.5 text-right">
        {conDatos ? (
          <span
            className="font-medium tabular-nums text-rose-600"
            title={prorrateado ? "Prorrateado por días: el rango corta meses sin desglose en QuickBooks" : undefined}
          >
            {e.gastoRango !== null ? bal(e.gastoRango) : p.cost !== null ? bal(p.cost) : "—"}
            {prorrateado ? <span className="text-rose-300"> ~</span> : null}
          </span>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
    ),

    margen: (
      <td key="margen" className="w-28 whitespace-nowrap px-3 py-2.5 text-right">
        {!conDatos ? (
          <span className="text-slate-300">—</span>
        ) : faltaGasto ? (
          <>
            <div className="text-xs font-semibold text-orange-600" title="Falta cargar el gasto en QuickBooks">
              s/d
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-slate-200" />
          </>
        ) : (
          <>
            {p.margin !== null ? (
              <div className={cn("text-xs font-semibold tabular-nums", marginTextColor(p.margin))}>
                {Math.round(p.margin * 100)}%
              </div>
            ) : (
              <div className="text-xs text-slate-300">—</div>
            )}
            <div className="mt-1">
              <ProfitBar income={cobro} cost={gasto} />
            </div>
          </>
        )}
      </td>
    ),

    // Fechas: clic en cualquiera abre el editor. El ámbar marca "asumida", que
    // es la única que puede estar lejos de la realidad.
    inicio: (
      <td key="inicio" className="whitespace-nowrap px-2.5 py-2.5">
        {botonFecha(e.eff?.start ?? null, e.eff?.diaStart ?? false, false)}
      </td>
    ),

    fin: (
      <td key="fin" className="whitespace-nowrap px-2.5 py-2.5">
        {!e.eff ? (
          botonFecha(null, false, true)
        ) : sinFin ? (
          <button type="button" onClick={onToggleEdit} title={sinFin.title} className="cursor-pointer">
            <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", sinFin.cls)}>
              {sinFin.label}
            </span>
          </button>
        ) : (
          botonFecha(e.eff.end, e.eff.diaEnd, true)
        )}
      </td>
    ),

    estado: (
      <td key="estado" className="whitespace-nowrap px-2.5 py-2.5">
        <StatusPicker value={status} onChange={onChangeStatus} />
      </td>
    ),
  };

  return (
    <>
      <tr className={cn("border-b border-slate-50 last:border-0 hover:bg-slate-50/60", cerrado && "opacity-60")}>
        <td className="px-2 py-2.5">
          <span className={cn("flex size-8 items-center justify-center rounded-xl", meta.chip)} title={meta.label}>
            <RubroIcon className="size-4" />
          </span>
        </td>

        {cols.visibles.map((k) => celdas[k])}

        <td className="px-2 py-2.5 text-right">
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
          <td colSpan={cols.visibles.length + 2} className="px-3 pb-3">
            <DatesEditor initial={dates} onSave={onSaveDates} onCancel={onToggleEdit} />
          </td>
        </tr>
      ) : null}
      {pickingQuotes && codigo ? (
        <tr className="border-b border-slate-50">
          <td colSpan={cols.visibles.length + 2} className="px-3 pb-3">
            <CotizacionesPicker codigo={codigo} onClose={onTogglePickQuotes} onChanged={onQuotesChanged} />
          </td>
        </tr>
      ) : null}
    </>
  );
}


