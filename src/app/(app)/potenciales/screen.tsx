"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlarmClock,
  FileText,
  Gavel,
  Plus,
  Search,
  X,
  Loader2,
  CheckCircle2,
  Clock,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  ArrowUpRight,
  Trash2,
  ExternalLink,
  ChevronDown,
  MessageCircle,
  Mail,
  FolderOpen,
  MapPin,
  Sparkles,
  Link2,
  CloudUpload,
  Landmark,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { norm } from "@/lib/clients/normalize";
import {
  RUBROS,
  QUOTE_STATUS_LABEL,
  QUOTE_STATUS_COLOR,
  TENDER_STATUS_LABEL,
  TENDER_STATUS_COLOR,
  MODALIDAD_LABEL,
  formatMoney,
  formatMoneyExact,
  type QuoteRow,
  type TenderRow,
  type QuoteStatus,
  type TenderStatus,
  type Rubro,
  type Modalidad,
} from "@/lib/pipeline/types";
import { type ProjectType } from "@/lib/projects/types";
import {
  updateQuote,
  createQuote,
  deleteQuote,
  convertQuoteToProject,
  updateTender,
} from "./actions";
import { DropboxImportDialog } from "./dropbox-import";
import { GovTendersBoard } from "./gov-tenders";
import { listGovTenders } from "./gov-actions";
import {
  suggestQboProjectSetup,
  sendQuoteToQbo,
  dismissSeguimiento,
  restoreSeguimiento,
  type QboSendSuggestion,
} from "./qbo-send-actions";
import { groupRevisions, parseRev } from "@/lib/pipeline/revisions";
import { CotizadorDialog } from "./cotizador";
import { publishQuote, getQuoteLetter, createQuoteSharedLink, type QuoteLetterBundle } from "./cotizador-actions";
import { EngineerLinkDialog } from "./engineer-link";
import { SortTh, toggleSort, compareVals, type SortState } from "@/components/ui/sortable";

const RUBRO_KEYS = Object.keys(RUBROS) as Rubro[];
type ClientOpt = { id: string; name: string; locations: { id: string; name: string }[] };

type QSortKey = "quote_number" | "client_name" | "amount_usd" | "status" | "sent_date";
type TSortKey = "entity" | "amount_ref_usd" | "status" | "modalidad";
const QUOTE_STATUSES: QuoteStatus[] = ["borrador", "enviada", "aprobada", "rechazada"];
const TENDER_STATUSES: TenderStatus[] = ["presentada", "en_revision", "por_partir", "ganada", "no_ganada"];
const MODALIDADES: Modalidad[] = ["licitacion_publica", "compra_menor", "contratacion_menor", "otro"];

// Fecha LOCAL de Panamá (UTC-5): toISOString() es UTC y después de las 7pm
// local ya devuelve "mañana" — corría follow-ups un día antes.
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Panama" });
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString("es-PA", { day: "2-digit", month: "short", year: "2-digit" });
}

// ── Antigüedad de enviadas (aging) ────────────────────────────────────────────
// Bandas: fresca ≤7 d (gris) · 8–20 d (ámbar) · ≥21 d (rojo = entra a
// "Seguimiento pendiente" hasta que se apruebe/rechace o se descarte).
const STALE_DAYS = 21;

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const d = Math.floor((+new Date(today() + "T00:00:00") - +new Date(iso + "T00:00:00")) / 86400000);
  return d >= 0 ? d : 0;
}

function AgingChip({ days, compact }: { days: number; compact?: boolean }) {
  const cls =
    days >= STALE_DAYS
      ? "bg-rose-50 text-rose-700 ring-rose-600/20"
      : days >= 8
        ? "bg-amber-50 text-amber-700 ring-amber-600/20"
        : "bg-slate-100 text-slate-500 ring-slate-200";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full font-semibold ring-1 ring-inset tabular-nums",
        compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]",
        cls,
      )}
      title={`Enviada hace ${days} día${days === 1 ? "" : "s"} sin respuesta`}
    >
      <Clock className="size-3" />
      {days === 0 ? "hoy" : `hace ${days} d`}
    </span>
  );
}
// Sugerir tipo de proyecto desde el rubro de la cotización.
function suggestType(rubro: Rubro | null): ProjectType {
  if (rubro === "DC") return "obra";
  if (rubro === "DV") return "instalacion";
  return "otro";
}
function waLink(phone: string | null): string | null {
  if (!phone) return null;
  const t = phone.trim();
  // Acepta un link wa.me / whatsapp pegado tal cual.
  if (/wa\.me|whatsapp/i.test(t)) {
    return t.startsWith("http") ? t : `https://${t.replace(/^\/+/, "")}`;
  }
  // O un número en cualquier formato (+507 6123-4567, 507..., etc.) → wa.me/<dígitos>
  const digits = t.replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : null;
}

// Revisiones: lógica compartida con Inicio (una sola fuente de verdad para que
// los KPIs de ambas pantallas cuadren). Ver src/lib/pipeline/revisions.ts.
type QuoteGroup = { main: QuoteRow; older: QuoteRow[]; dupCount: number };

type Tab = "cotizaciones" | "licitaciones";

export function PotencialesScreen({
  quotes: quotesProp,
  tenders: tendersProp,
  clients,
}: {
  quotes: QuoteRow[];
  tenders: TenderRow[];
  clients: ClientOpt[];
}) {
  const [tab, setTab] = useState<Tab>("cotizaciones");
  const [quotes, setQuotes] = useState<QuoteRow[]>(quotesProp);
  const [tenders, setTenders] = useState<TenderRow[]>(tendersProp);

  return (
    <div className="min-h-full bg-slate-50/70">
    <div className="px-4 py-6 md:px-10 md:py-8 max-w-7xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Cotizaciones y Licitaciones</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Lo que puede convertirse en negocio.
        </p>
      </header>

      <div className="mb-6 flex gap-1 border-b border-slate-200">
        <TabButton active={tab === "cotizaciones"} onClick={() => setTab("cotizaciones")} icon={FileText}>
          Cotizaciones <span className="ml-1 text-xs text-slate-400">{quotes.length}</span>
        </TabButton>
        <TabButton active={tab === "licitaciones"} onClick={() => setTab("licitaciones")} icon={Gavel}>
          Licitaciones <span className="ml-1 text-xs text-slate-400">{tenders.length}</span>
        </TabButton>
      </div>

      {tab === "cotizaciones" ? (
        <CotizacionesTab quotes={quotes} setQuotes={setQuotes} clients={clients} />
      ) : (
        <LicitacionesTab tenders={tenders} setTenders={setTenders} clients={clients} />
      )}
    </div>
    </div>
  );
}

// ════════════════════════════════════ COTIZACIONES ════════════════════════════

function CotizacionesTab({
  quotes,
  setQuotes,
  clients,
}: {
  quotes: QuoteRow[];
  setQuotes: React.Dispatch<React.SetStateAction<QuoteRow[]>>;
  clients: ClientOpt[];
}) {
  const years = useMemo(
    () => Array.from(new Set(quotes.map((q) => q.year).filter((y): y is number => !!y))).sort((a, b) => b - a),
    [quotes],
  );
  const [year, setYear] = useState<number | "all">(years[0] ?? "all");
  const [estado, setEstado] = useState<QuoteStatus | "all">("all");
  const [rubro, setRubro] = useState<Rubro | "all">("all");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [soloSinCliente, setSoloSinCliente] = useState(false);
  const [sort, setSort] = useState<SortState<QSortKey>>({ key: "sent_date", dir: "desc" });
  const [editing, setEditing] = useState<QuoteRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [sendingQbo, setSendingQbo] = useState<QuoteRow | null>(null);
  const [dismissing, setDismissing] = useState<QuoteRow | null>(null);
  const [showDescartadas, setShowDescartadas] = useState(false);
  const [showDropbox, setShowDropbox] = useState(false);
  const [showCotizador, setShowCotizador] = useState(false);
  const [showEngineerLink, setShowEngineerLink] = useState(false);
  const [editingLetter, setEditingLetter] = useState<QuoteLetterBundle | null>(null);

  // Agrupar revisiones: solo la vigente cuenta; las anteriores van colapsadas.
  // Los borradores se agrupan aparte (cada uno su propio grupo) para que un
  // borrador con nº de revisión no gane como "vigente" y esconda —de la tabla y
  // de los KPIs— la revisión publicada real que va debajo.
  const groups = useMemo(() => {
    const publicadas = quotes.filter((x) => x.status !== "borrador");
    const borradores = quotes.filter((x) => x.status === "borrador");
    return [...groupRevisions(publicadas), ...borradores.map((main) => ({ main, older: [], dupCount: 0 }))];
  }, [quotes]);

  const passesFilters = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ({ main: x, older }: QuoteGroup): boolean => {
      if (year !== "all" && x.year !== year) return false;
      if (estado !== "all" && x.status !== estado) return false;
      if (rubro !== "all" && x.rubro !== rubro) return false;
      if (from && (!x.sent_date || x.sent_date < from)) return false;
      if (to && (!x.sent_date || x.sent_date > to)) return false;
      if (needle) {
        const hay = [x, ...older]
          .map((r) => `${r.quote_number} ${r.client_name ?? ""} ${r.client_std_name ?? ""} ${r.description ?? ""}`)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    };
  }, [year, estado, rubro, q, from, to]);

  const filtered = useMemo(
    () => groups.filter((g) => passesFilters(g) && (!soloSinCliente || !g.main.client_id)),
    [groups, passesFilters, soloSinCliente],
  );

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => compareVals(a.main[sort.key], b.main[sort.key], sort.dir));
    return arr;
  }, [filtered, sort]);

  const kpis = useMemo(() => {
    let enviadaMonto = 0;
    let aprobadaCount = 0;
    let aprobadaMonto = 0;
    let rechazadaCount = 0;
    let porCobrar = 0;
    for (const { main: x } of filtered) {
      const m = x.amount_usd ?? 0;
      if (x.status === "enviada") enviadaMonto += m;
      else if (x.status === "aprobada") {
        aprobadaCount += 1;
        aprobadaMonto += m;
        if (x.invoice_status === "pendiente") porCobrar += 1;
      } else if (x.status === "rechazada") rechazadaCount += 1;
    }
    const decididas = aprobadaCount + rechazadaCount;
    const cierre = decididas > 0 ? Math.round((aprobadaCount / decididas) * 100) : 0;
    return { enviadaMonto, aprobadaCount, aprobadaMonto, rechazadaCount, porCobrar, cierre };
  }, [filtered]);

  // Cuenta dentro de los filtros activos (lo que vas a ver al tocar el chip);
  // la global sirve para avisar si hay más escondidas en otro año/filtro.
  const sinClienteCount = useMemo(
    () => groups.filter((g) => passesFilters(g) && !g.main.client_id).length,
    [groups, passesFilters],
  );
  const sinClienteGlobal = useMemo(() => groups.filter((g) => !g.main.client_id).length, [groups]);
  const olderTotal = useMemo(() => groups.reduce((a, g) => a + g.older.length, 0), [groups]);
  const dupTotal = useMemo(() => groups.reduce((a, g) => a + g.dupCount, 0), [groups]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function applyLocal(updated: QuoteRow) {
    setQuotes((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
  }

  // Action points de seguimiento: enviadas VIGENTES con ≥21 días sin respuesta y
  // sin descartar. Global (ignora los filtros de vista): es una lista de tareas,
  // no una vista. Las descartadas quedan consultables con su motivo.
  const seguimiento = useMemo(() => {
    const pend: { q: QuoteRow; days: number }[] = [];
    const descartadas: QuoteRow[] = [];
    for (const g of groups) {
      const x = g.main;
      if (x.status !== "enviada") continue;
      if (x.seguimiento_descartado_at) {
        descartadas.push(x);
        continue;
      }
      const d = daysSince(x.sent_date);
      if (d !== null && d >= STALE_DAYS) pend.push({ q: x, days: d });
    }
    pend.sort((a, b) => b.days - a.days);
    return { pend, descartadas };
  }, [groups]);

  return (
    <>
      <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="En juego" value={formatMoney(kpis.enviadaMonto)} sub="enviadas sin cerrar" icon={Clock} accent="#F59E0B" />
        <Kpi label="Aprobadas" value={String(kpis.aprobadaCount)} sub={formatMoney(kpis.aprobadaMonto)} icon={CheckCircle2} accent="#10B981" />
        <Kpi label="Por cobrar" value={String(kpis.porCobrar)} sub="aprobadas sin pago" icon={DollarSign} accent="#2563EB" />
        <Kpi label="Tasa de cierre" value={`${kpis.cierre}%`} sub={`${kpis.rechazadaCount} rechazadas`} icon={TrendingUp} accent="#6366F1" />
      </section>

      {/* Seguimiento pendiente: enviadas viejas que piden acción */}
      {seguimiento.pend.length > 0 || seguimiento.descartadas.length > 0 ? (
        <section className="mb-4 rounded-2xl border border-amber-200/70 bg-amber-50/50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex size-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                <AlarmClock className="size-4" />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Seguimiento pendiente
                  {seguimiento.pend.length > 0 ? (
                    <span className="ml-2 rounded-full bg-amber-600 px-2 py-0.5 text-[11px] font-bold text-white tabular-nums">
                      {seguimiento.pend.length}
                    </span>
                  ) : null}
                </h3>
                <p className="text-[11px] text-slate-500">
                  Enviadas hace más de {STALE_DAYS} días sin respuesta — dales seguimiento o descártalas con un motivo.
                </p>
              </div>
            </div>
            {seguimiento.descartadas.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowDescartadas((v) => !v)}
                className="text-xs font-semibold text-slate-500 hover:text-slate-700"
              >
                {showDescartadas ? "Ocultar descartadas" : `Descartadas (${seguimiento.descartadas.length})`}
              </button>
            ) : null}
          </div>

          {seguimiento.pend.length > 0 ? (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {seguimiento.pend.slice(0, 6).map(({ q: x, days }) => (
                <li
                  key={x.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-amber-100 bg-white px-3 py-2.5 shadow-sm"
                >
                  <button type="button" onClick={() => setEditing(x)} className="min-w-0 flex-1 cursor-pointer text-left">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold tabular-nums text-slate-700">{x.quote_number}</span>
                      <AgingChip days={days} compact />
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-600">
                      {x.client_std_name ?? x.client_name ?? "—"}
                      <span className="ml-1.5 font-semibold text-slate-800">
                        {x.amount_usd !== null ? formatMoneyExact(x.amount_usd) : ""}
                      </span>
                    </p>
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {waLink(x.contact_phone) ? (
                      <a
                        href={waLink(x.contact_phone)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex size-7 items-center justify-center rounded-md text-emerald-600 hover:bg-emerald-50"
                        title="Dar seguimiento por WhatsApp"
                      >
                        <MessageCircle className="size-4" />
                      </a>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setDismissing(x)}
                      className="flex size-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      title="Descartar del seguimiento (con motivo)"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-slate-500">Nada pendiente — todas las enviadas viejas están descartadas o resueltas.</p>
          )}
          {seguimiento.pend.length > 6 ? (
            <p className="mt-2 text-[11px] text-slate-500">
              +{seguimiento.pend.length - 6} más — filtra por estado &ldquo;Enviada&rdquo; y ordena por fecha para verlas todas.
            </p>
          ) : null}

          {showDescartadas && seguimiento.descartadas.length > 0 ? (
            <ul className="mt-3 space-y-1.5 border-t border-amber-100 pt-3">
              {seguimiento.descartadas.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/70 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold tabular-nums text-slate-500">
                      {x.quote_number} <span className="font-normal">· {x.client_std_name ?? x.client_name ?? "—"}</span>
                    </p>
                    <p className="truncate text-[11px] italic text-slate-400">
                      {x.seguimiento_descartado_motivo || "sin motivo"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const r = await restoreSeguimiento(x.id);
                        if (!("error" in r)) {
                          applyLocal({ ...x, seguimiento_descartado_at: null, seguimiento_descartado_motivo: null });
                        }
                      } catch {
                        /* reintenta con otro click */
                      }
                    }}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <Undo2 className="size-3.5" /> Restaurar
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {/* Filtros */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SegMulti
          options={[{ k: "all", label: "Todos" }, ...years.map((y) => ({ k: String(y), label: String(y) }))]}
          value={year === "all" ? "all" : String(year)}
          onChange={(k) => setYear(k === "all" ? "all" : Number(k))}
        />
        <Dropdown
          label="Estado"
          value={estado}
          onChange={(v) => setEstado(v as QuoteStatus | "all")}
          options={[{ v: "all", label: "Todos" }, ...QUOTE_STATUSES.map((s) => ({ v: s, label: QUOTE_STATUS_LABEL[s] }))]}
        />
        <Dropdown
          label="Rubro"
          value={rubro}
          onChange={(v) => setRubro(v as Rubro | "all")}
          options={[{ v: "all", label: "Todos" }, ...RUBRO_KEYS.map((r) => ({ v: r, label: RUBROS[r].label }))]}
        />
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar nº, cliente, descripción…"
            className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-sm focus:border-slate-400 focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowDropbox(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          title="Importar cotizaciones desde la carpeta de Dropbox"
        >
          <FolderOpen className="size-4 text-blue-600" />
          <span className="hidden sm:inline">Dropbox</span>
        </button>
        <button
          type="button"
          onClick={() => setShowEngineerLink(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-2.5 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-50"
          title="Link del cotizador para ingenieros (sin login)"
        >
          <Link2 className="size-4" />
          <span className="hidden lg:inline">Link ingenieros</span>
        </button>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          title="Crear una cotización manualmente (formulario)"
        >
          <Plus className="size-4" />
          <span className="hidden sm:inline">Manual</span>
        </button>
        <button
          type="button"
          onClick={() => setShowCotizador(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2 text-sm font-bold text-white shadow-md shadow-violet-600/25 transition-all hover:from-violet-700 hover:to-indigo-700 hover:shadow-lg"
          title="Generar una cotización con IA: texto, voz o foto"
        >
          <Sparkles className="size-4" />
          Crear cotización
        </button>
      </div>

      {/* Rango de fechas (por fecha de envío) */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="font-semibold uppercase tracking-wider">Envío</span>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:border-slate-400 focus:outline-none" />
        <span>→</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:border-slate-400 focus:outline-none" />
        {(from || to) ? (
          <button type="button" onClick={() => { setFrom(""); setTo(""); }} className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold text-slate-500 hover:bg-slate-100">
            <X className="size-3" /> Limpiar
          </button>
        ) : null}
        <span className="mx-1 h-4 w-px bg-slate-200" />
        <button
          type="button"
          onClick={() => setSoloSinCliente((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold",
            soloSinCliente ? "bg-amber-100 text-amber-700" : "text-slate-500 hover:bg-slate-100",
          )}
          title="Mostrar solo cotizaciones sin cliente estandarizado"
        >
          Sin cliente{sinClienteCount > 0 ? ` (${sinClienteCount})` : ""}
        </button>
      </div>

      <p className="mb-2 text-xs text-muted-foreground">
        {filtered.length} de {groups.length} cotizaciones vigentes
        {olderTotal > 0 ? <span className="text-slate-400"> · {olderTotal} versiones anteriores (colapsadas)</span> : null}
        {dupTotal > 0 ? <span className="font-medium text-amber-600"> · {dupTotal} posible{dupTotal === 1 ? "" : "s"} duplicado{dupTotal === 1 ? "" : "s"}</span> : null}
      </p>

      <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                <SortTh label="Nº" k="quote_number" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} />
                <SortTh label="Cliente" k="client_name" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} />
                <th className="hidden px-3 py-2.5 font-semibold lg:table-cell">Sucursal</th>
                <th className="hidden px-3 py-2.5 font-semibold md:table-cell">Descripción</th>
                <th className="px-3 py-2.5 font-semibold">Rubro</th>
                <SortTh label="Monto" k="amount_usd" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k, "desc"))} align="right" className="text-right" />
                <SortTh label="Estado" k="status" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} />
                <SortTh label="Envío" k="sent_date" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k, "desc"))} className="hidden sm:table-cell" />
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-12 text-center text-sm text-muted-foreground">
                    Sin cotizaciones con estos filtros.
                    {soloSinCliente && sinClienteGlobal > 0 ? (
                      <span className="mt-1 block text-xs text-amber-600">
                        Hay {sinClienteGlobal} sin cliente en otros años/filtros — prueba con &ldquo;Todos&rdquo; en el año.
                      </span>
                    ) : null}
                  </td>
                </tr>
              ) : (
                sorted.map((g) => {
                  const x = g.main;
                  const overdue = x.status === "enviada" && x.follow_up_date && x.follow_up_date < today();
                  const rev = parseRev(x.quote_number).rev;
                  const isOpen = expanded.has(x.id);
                  return (
                    <React.Fragment key={x.id}>
                    <tr
                      onClick={() => setEditing(x)}
                      className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50/60"
                    >
                      <td className="whitespace-nowrap px-3 py-2.5 font-medium text-slate-900">
                        <span className="inline-flex items-center gap-1.5">
                          {x.quote_number}
                          {rev > 0 ? (
                            <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 ring-1 ring-inset ring-blue-600/20">
                              Rev {rev}
                            </span>
                          ) : null}
                          {g.older.length > 0 ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleExpand(x.id);
                              }}
                              className={cn(
                                "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset",
                                g.dupCount > 0
                                  ? "bg-amber-50 text-amber-700 ring-amber-600/20 hover:bg-amber-100"
                                  : "bg-slate-100 text-slate-500 ring-slate-200 hover:bg-slate-200",
                              )}
                              title={g.dupCount > 0 ? "Incluye posibles duplicados" : "Ver versiones anteriores"}
                            >
                              <ChevronDown className={cn("size-3 transition-transform", isOpen && "rotate-180")} />
                              {g.older.length}
                            </button>
                          ) : null}
                        </span>
                      </td>
                      <td className="max-w-[180px] px-3 py-2.5">
                        <div className="truncate text-slate-700">{x.client_std_name ?? x.client_name ?? "—"}</div>
                        {!x.client_id && x.client_name ? (
                          <span className="text-[10px] font-medium text-amber-600">sin estandarizar</span>
                        ) : null}
                      </td>
                      <td className="hidden max-w-[150px] truncate px-3 py-2.5 text-slate-500 lg:table-cell">
                        {x.location_name ? (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="size-3 text-slate-400" />
                            {x.location_name}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="hidden max-w-[280px] truncate px-3 py-2.5 text-slate-500 md:table-cell">
                        {x.description ?? "—"}
                      </td>
                      <td className="px-3 py-2.5">{x.rubro ? <RubroChip rubro={x.rubro} /> : "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-700">
                        {x.amount_usd === null ? "—" : formatMoneyExact(x.amount_usd)}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <StatusChip color={QUOTE_STATUS_COLOR[x.status]} label={QUOTE_STATUS_LABEL[x.status]} />
                          {overdue ? <AlertTriangle className="size-3.5 text-amber-500" /> : null}
                          {x.converted_project_id ? (
                            <span title="Convertida a proyecto">
                              <ArrowUpRight className="size-3.5 text-emerald-600" />
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="hidden whitespace-nowrap px-3 py-2.5 text-slate-500 sm:table-cell">
                        <div>{fmtDate(x.sent_date)}</div>
                        {x.status === "enviada" && daysSince(x.sent_date) !== null ? (
                          <div className="mt-0.5">
                            <AgingChip days={daysSince(x.sent_date)!} compact />
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {waLink(x.contact_phone) ? (
                            <a
                              href={waLink(x.contact_phone)!}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="flex size-7 items-center justify-center rounded-md text-emerald-600 hover:bg-emerald-50"
                              title={`WhatsApp${x.contact_name ? ` · ${x.contact_name}` : ""}`}
                            >
                              <MessageCircle className="size-4" />
                            </a>
                          ) : x.contact_email ? (
                            <a
                              href={`mailto:${x.contact_email}`}
                              onClick={(e) => e.stopPropagation()}
                              className="flex size-7 items-center justify-center rounded-md text-blue-600 hover:bg-blue-50"
                              title={`Email${x.contact_name ? ` · ${x.contact_name}` : ""}`}
                            >
                              <Mail className="size-4" />
                            </a>
                          ) : null}
                          {x.qbo_job_id ? (
                            <span
                              className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20"
                              title={`En QBO desde ${x.qbo_sent_at ? fmtDate(x.qbo_sent_at.slice(0, 10)) : "—"}`}
                            >
                              <CheckCircle2 className="size-3.5" /> QBO
                            </span>
                          ) : x.status === "aprobada" ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSendingQbo(x);
                              }}
                              className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                              title="Crear el proyecto en QuickBooks"
                            >
                              → Proyecto
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    {isOpen
                      ? g.older.map((o) => {
                          const oRev = parseRev(o.quote_number).rev;
                          const isDup = oRev === rev;
                          return (
                            <tr
                              key={o.id}
                              onClick={() => setEditing(o)}
                              className="cursor-pointer border-b border-slate-50 bg-slate-50/40 text-slate-400 last:border-0 hover:bg-slate-100/60"
                            >
                              <td className="whitespace-nowrap px-3 py-2 pl-8 text-xs">
                                <span className="inline-flex items-center gap-1.5">
                                  {o.quote_number}
                                  <span
                                    className={cn(
                                      "rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset",
                                      isDup ? "bg-amber-50 text-amber-700 ring-amber-600/20" : "bg-slate-100 text-slate-500 ring-slate-200",
                                    )}
                                  >
                                    {isDup ? "posible duplicado" : "reemplazada"}
                                  </span>
                                </span>
                              </td>
                              <td className="max-w-[180px] truncate px-3 py-2 text-xs">{o.client_std_name ?? o.client_name ?? "—"}</td>
                              <td className="hidden px-3 py-2 text-xs lg:table-cell">{o.location_name ?? "—"}</td>
                              <td className="hidden max-w-[280px] truncate px-3 py-2 text-xs md:table-cell">{o.description ?? "—"}</td>
                              <td className="px-3 py-2 text-xs">{o.rubro ?? "—"}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums">
                                {o.amount_usd === null ? "—" : formatMoneyExact(o.amount_usd)}
                              </td>
                              <td className="px-3 py-2 text-xs">{QUOTE_STATUS_LABEL[o.status]}</td>
                              <td className="hidden whitespace-nowrap px-3 py-2 text-xs sm:table-cell">{fmtDate(o.sent_date)}</td>
                              <td className="px-3 py-2"></td>
                            </tr>
                          );
                        })
                      : null}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing ? (
        <QuoteDrawer
          quote={editing}
          clients={clients}
          onEditLetter={(b) => {
            setEditing(null);
            setEditingLetter(b);
          }}
          onClose={() => setEditing(null)}
          onSaved={(u) => {
            applyLocal(u);
            setEditing(null);
          }}
          onDeleted={(id) => {
            setQuotes((prev) => prev.filter((x) => x.id !== id));
            setEditing(null);
          }}
          onSendQbo={(q) => {
            applyLocal(q);
            setEditing(null);
            setSendingQbo(q);
          }}
        />
      ) : null}

      {creating ? (
        <NewQuoteDrawer
          defaultYear={year === "all" ? new Date().getFullYear() : year}
          onClose={() => setCreating(false)}
          onCreated={(row) => {
            setQuotes((prev) => [row, ...prev]);
            setCreating(false);
          }}
        />
      ) : null}

      {sendingQbo ? (
        <SendToQboDialog
          quote={sendingQbo}
          onClose={() => setSendingQbo(null)}
          onSent={(patch) => {
            setQuotes((prev) => prev.map((x) => (x.id === sendingQbo.id ? { ...x, ...patch } : x)));
          }}
        />
      ) : null}

      {dismissing ? (
        <DescartarSeguimientoDialog
          quote={dismissing}
          onClose={() => setDismissing(null)}
          onDone={(at, motivo) => {
            applyLocal({ ...dismissing, seguimiento_descartado_at: at, seguimiento_descartado_motivo: motivo });
            setDismissing(null);
          }}
        />
      ) : null}

      {showDropbox ? (
        <DropboxImportDialog
          onClose={() => setShowDropbox(false)}
          onImported={(rows) => {
            setQuotes((prev) => {
              const existing = new Set(prev.map((x) => x.id));
              const fresh = rows.filter((r) => !existing.has(r.id));
              return [...fresh, ...prev];
            });
          }}
        />
      ) : null}

      {showCotizador ? (
        <CotizadorDialog
          onClose={() => setShowCotizador(false)}
          onCreated={(row) => setQuotes((prev) => [row, ...prev])}
          onUpdated={(row) => setQuotes((prev) => prev.map((x) => (x.id === row.id ? row : x)))}
        />
      ) : null}

      {showEngineerLink ? <EngineerLinkDialog onClose={() => setShowEngineerLink(false)} /> : null}

      {editingLetter ? (
        <CotizadorDialog
          initial={editingLetter}
          onClose={() => setEditingLetter(null)}
          onCreated={(row) => setQuotes((prev) => [row, ...prev])}
          onUpdated={(row) => setQuotes((prev) => prev.map((x) => (x.id === row.id ? row : x)))}
        />
      ) : null}
    </>
  );
}

function QuoteDrawer({
  quote,
  clients,
  onClose,
  onSaved,
  onDeleted,
  onSendQbo,
  onEditLetter,
}: {
  quote: QuoteRow;
  clients: ClientOpt[];
  onClose: () => void;
  onSaved: (q: QuoteRow) => void;
  onDeleted: (id: string) => void;
  onSendQbo: (q: QuoteRow) => void;
  onEditLetter?: (b: QuoteLetterBundle) => void;
}) {
  const [f, setF] = useState<QuoteRow>(quote);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pubBusy, setPubBusy] = useState(false);
  const [pubErr, setPubErr] = useState<string | null>(null);

  function set<K extends keyof QuoteRow>(k: K, v: QuoteRow[K]) {
    setF((prev) => ({ ...prev, [k]: v }));
  }
  const clientLocs = clients.find((c) => c.id === f.client_id)?.locations ?? [];

  async function publicar() {
    if (saving || pubBusy) return; // no publicar mientras un guardado está en vuelo (y viceversa)
    setPubBusy(true);
    setPubErr(null);
    try {
      const r = await publishQuote(quote.id);
      if ("error" in r) {
        setPubErr(r.error);
        return;
      }
      // Fila optimista desde `quote` (lo PERSISTIDO), no desde `f` (ediciones
      // sin guardar): publicar no guarda el formulario — mostrarlo como
      // guardado desincronizaba la tabla de la base.
      onSaved({ ...quote, status: "enviada", dropbox_shared_url: r.data.url, dropbox_path: r.data.path });
    } catch (e) {
      setPubErr(e instanceof Error ? e.message : "Se cortó la publicación — reintenta");
    } finally {
      setPubBusy(false);
    }
  }

  async function crearLink() {
    if (saving || pubBusy) return;
    setPubBusy(true);
    setPubErr(null);
    try {
      const r = await createQuoteSharedLink(quote.id);
      if ("error" in r) {
        setPubErr(r.error);
        return;
      }
      onSaved({ ...quote, dropbox_shared_url: r.data.url });
    } catch (e) {
      setPubErr(e instanceof Error ? e.message : "No se pudo crear el link — reintenta");
    } finally {
      setPubBusy(false);
    }
  }

  async function editarCarta() {
    if (saving || pubBusy) return;
    setPubBusy(true);
    setPubErr(null);
    try {
      const r = await getQuoteLetter(quote.id);
      if ("error" in r) {
        setPubErr(r.error);
        return;
      }
      onEditLetter?.(r.data);
    } catch (e) {
      setPubErr(e instanceof Error ? e.message : "No se pudo abrir la carta — reintenta");
    } finally {
      setPubBusy(false);
    }
  }

  // Persistir el formulario. Devuelve true si guardó (para encadenar el envío
  // a QBO sin duplicar la lógica).
  async function doSave(): Promise<boolean> {
    setError(null);
    try {
      const r = await updateQuote(quote.id, {
        quote_number: f.quote_number,
        sent_date: f.sent_date,
        amount_usd: f.amount_usd,
        status: f.status,
        payment_status: f.payment_status,
        invoice_status: f.invoice_status,
        client_name: f.client_name,
        client_id: f.client_id,
        location_id: f.location_id,
        contact_name: f.contact_name,
        contact_phone: f.contact_phone,
        contact_email: f.contact_email,
        description: f.description,
        notes: f.notes,
        rubro: f.rubro,
        follow_up_date: f.follow_up_date,
        rejection_reason: f.rejection_reason,
      });
      if ("error" in r) {
        setError(r.error);
        return false;
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Se cortó el guardado — reintenta");
      return false;
    }
  }

  async function save() {
    if (saving || pubBusy) return; // guardar durante un publish podía revertir "enviada" a "borrador"
    setSaving(true);
    try {
      if (await doSave()) onSaved(f);
    } finally {
      setSaving(false);
    }
  }

  // Un solo flujo: guarda el formulario y abre el diálogo de envío a QBO.
  async function guardarYEnviar() {
    if (saving || pubBusy) return;
    setSaving(true);
    try {
      if (await doSave()) onSendQbo(f);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer title={`Cotización ${quote.quote_number}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/carta/${quote.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <ExternalLink className="size-3.5" /> Ver carta
          </a>
          {f.status === "borrador" ? (
            <>
              <button
                type="button"
                onClick={editarCarta}
                disabled={pubBusy || saving}
                className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50"
                title="Abrir la carta en el cotizador para terminarla (renglones, precios, condiciones)"
              >
                <Sparkles className="size-3.5" /> Editar carta
              </button>
              <button
                type="button"
                onClick={publicar}
                disabled={pubBusy || saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                title="Genera el PDF con membrete y lo sube a la carpeta de cartas en Dropbox"
              >
                {pubBusy ? <Loader2 className="size-3.5 animate-spin" /> : <CloudUpload className="size-3.5" />}
                Publicar PDF a Dropbox
              </button>
            </>
          ) : null}
          {!f.dropbox_shared_url && f.dropbox_path ? (
            <button
              type="button"
              onClick={crearLink}
              disabled={pubBusy || saving}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
              title="El PDF ya está en Dropbox — crear el link compartido para WhatsApp/Email"
            >
              {pubBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
              Crear link
            </button>
          ) : null}
          {f.dropbox_shared_url ? (
            <>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`Cotización ${f.quote_number} - ${f.client_std_name ?? f.client_name ?? ""}: ${f.dropbox_shared_url}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-100 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-200"
                title="Compartir el PDF por WhatsApp"
              >
                <MessageCircle className="size-3.5" /> WhatsApp
              </a>
              <a
                href={`mailto:?subject=${encodeURIComponent(`Cotización ${f.quote_number}`)}&body=${encodeURIComponent(`Cotización ${f.quote_number} - ${f.client_std_name ?? f.client_name ?? ""}: ${f.dropbox_shared_url}`)}`}
                className="inline-flex items-center gap-1 rounded-lg bg-blue-100 px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-200"
                title="Compartir el PDF por Email"
              >
                <Mail className="size-3.5" /> Email
              </a>
              <a
                href={f.dropbox_shared_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                PDF
              </a>
            </>
          ) : null}
        </div>
        {pubErr ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{pubErr}</p> : null}
        <Field label="Número" hint="editable — acomodalo como quieras">
          <input className={inputCls} value={f.quote_number} onChange={(e) => set("quote_number", e.target.value)} placeholder="COT DC 26-108" />
        </Field>
        <Field label="Cliente" hint="texto original + cliente estandarizado">
          <input
            className={inputCls}
            value={f.client_name ?? ""}
            onChange={(e) => set("client_name", e.target.value || null)}
            placeholder="Nombre tal como vino"
          />
          <select
            className={cn(inputCls, "mt-1.5")}
            value={f.client_id ?? ""}
            onChange={(e) => {
              const id = e.target.value || null;
              const name = id ? clients.find((c) => c.id === id)?.name ?? null : null;
              setF((prev) => ({ ...prev, client_id: id, client_std_name: name, location_id: null, location_name: null }));
            }}
          >
            <option value="">— Sin cliente estandarizado —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        {f.client_id && clientLocs.length > 0 ? (
          <Field label="Sucursal / lugar">
            <select
              className={inputCls}
              value={f.location_id ?? ""}
              onChange={(e) => {
                const id = e.target.value || null;
                const name = id ? clientLocs.find((l) => l.id === id)?.name ?? null : null;
                setF((prev) => ({ ...prev, location_id: id, location_name: name }));
              }}
            >
              <option value="">— Sin sucursal —</option>
              {clientLocs.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        {/* Contacto para seguimiento */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Contacto</span>
            <div className="flex items-center gap-1.5">
              {waLink(f.contact_phone) ? (
                <a
                  href={waLink(f.contact_phone)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-200"
                  title="Abrir WhatsApp"
                >
                  <MessageCircle className="size-3.5" /> WhatsApp
                </a>
              ) : null}
              {f.contact_email ? (
                <a
                  href={`mailto:${f.contact_email}`}
                  className="inline-flex items-center gap-1 rounded-md bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-200"
                  title="Enviar email"
                >
                  <Mail className="size-3.5" /> Email
                </a>
              ) : null}
            </div>
          </div>
          <div className="space-y-2">
            <input
              className={inputCls}
              placeholder="Persona de contacto"
              value={f.contact_name ?? ""}
              onChange={(e) => set("contact_name", e.target.value || null)}
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                className={inputCls}
                placeholder="WhatsApp: 507... o wa.me/507..."
                value={f.contact_phone ?? ""}
                onChange={(e) => set("contact_phone", e.target.value || null)}
              />
              <input
                type="email"
                className={inputCls}
                placeholder="Email"
                value={f.contact_email ?? ""}
                onChange={(e) => set("contact_email", e.target.value || null)}
              />
            </div>
          </div>
        </div>

        <Field label="Descripción">
          <textarea
            rows={3}
            className={inputCls}
            value={f.description ?? ""}
            onChange={(e) => set("description", e.target.value || null)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Monto (B/.)">
            <input
              type="number"
              step="0.01"
              className={inputCls}
              value={f.amount_usd ?? ""}
              onChange={(e) => set("amount_usd", e.target.value === "" ? null : Number(e.target.value))}
            />
          </Field>
          <Field label="Rubro">
            <select className={inputCls} value={f.rubro ?? ""} onChange={(e) => set("rubro", (e.target.value || null) as Rubro | null)}>
              <option value="">—</option>
              {RUBRO_KEYS.map((r) => (
                <option key={r} value={r}>
                  {RUBROS[r].label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Estado">
            <select className={inputCls} value={f.status} onChange={(e) => set("status", e.target.value as QuoteStatus)}>
              {QUOTE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {QUOTE_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Fecha de envío">
            <input type="date" className={inputCls} value={f.sent_date ?? ""} onChange={(e) => set("sent_date", e.target.value || null)} />
          </Field>
        </div>

        {f.status === "enviada" ? (
          <Field label="Seguimiento (fecha)" hint="Cuándo dar el próximo toque al cliente.">
            <input type="date" className={inputCls} value={f.follow_up_date ?? ""} onChange={(e) => set("follow_up_date", e.target.value || null)} />
          </Field>
        ) : null}

        {f.status === "rechazada" ? (
          <Field label="Motivo de rechazo">
            <textarea
              rows={2}
              className={inputCls}
              placeholder="¿Por qué no se cerró?"
              value={f.rejection_reason ?? ""}
              onChange={(e) => set("rejection_reason", e.target.value || null)}
            />
          </Field>
        ) : null}

        {f.status === "aprobada" ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Pago">
              <select className={inputCls} value={f.payment_status ?? ""} onChange={(e) => set("payment_status", (e.target.value || null) as "facturado" | null)}>
                <option value="">—</option>
                <option value="facturado">Facturado</option>
              </select>
            </Field>
            <Field label="Factura">
              <select className={inputCls} value={f.invoice_status ?? ""} onChange={(e) => set("invoice_status", (e.target.value || null) as "pendiente" | "cancelada" | null)}>
                <option value="">—</option>
                <option value="pendiente">Pendiente (por cobrar)</option>
                <option value="cancelada">Cancelada (cobrada)</option>
              </select>
            </Field>
          </div>
        ) : null}

        <Field label="Observaciones">
          <textarea rows={2} className={inputCls} value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value || null)} />
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          {f.qbo_job_id ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
              <CheckCircle2 className="size-4" />
              En QBO{f.qbo_sent_at ? ` · ${fmtDate(f.qbo_sent_at.slice(0, 10))}` : ""}
            </span>
          ) : null}
          {f.converted_project_id ? (
            <Link
              href={`/proyectos/${f.converted_project_id}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
            >
              <ArrowUpRight className="size-4" />
              Ver proyecto vinculado
            </Link>
          ) : null}
        </div>

        {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          {!f.qbo_job_id ? (
            <button
              type="button"
              onClick={guardarYEnviar}
              disabled={saving || pubBusy}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              title="Guarda los cambios y crea el proyecto en QuickBooks (asigna el próximo número DC/DM)"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <ArrowUpRight className="size-4" />}
              Guardar y enviar a proyectos
            </button>
          ) : null}
          <button
            type="button"
            onClick={save}
            disabled={saving || pubBusy}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50",
              f.qbo_job_id
                ? "bg-slate-900 text-white hover:bg-slate-800"
                : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
            )}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Guardar
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={saving || pubBusy}
            className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving || pubBusy}
            onClick={async () => {
              if (!confirm(`¿Eliminar la cotización ${quote.quote_number}?`)) return;
              setSaving(true);
              setError(null);
              try {
                const r = await deleteQuote(quote.id);
                // Fallo visible: antes un error se tragaba y el drawer quedaba
                // ahí sin explicación.
                if ("error" in r) setError(r.error);
                else onDeleted(quote.id);
              } catch (e) {
                setError(e instanceof Error ? e.message : "No se pudo eliminar — reintenta");
              } finally {
                setSaving(false);
              }
            }}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            <Trash2 className="size-4" />
            Eliminar
          </button>
        </div>
      </div>
    </Drawer>
  );
}

function NewQuoteDrawer({
  defaultYear,
  onClose,
  onCreated,
}: {
  defaultYear: number;
  onClose: () => void;
  onCreated: (row: QuoteRow) => void;
}) {
  const [quoteNumber, setQuoteNumber] = useState("");
  const [client, setClient] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [rubro, setRubro] = useState<Rubro | "">("");
  const [status, setStatus] = useState<QuoteStatus>("enviada");
  const [sentDate, setSentDate] = useState(today());
  const [followUp, setFollowUp] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!quoteNumber.trim()) {
      setError("El número es obligatorio");
      return;
    }
    setSaving(true);
    setError(null);
    // Año desde la FECHA de envío (no el filtro de año activo): filtrando 2025
    // y creando con fecha de hoy, la fila quedaba en el año equivocado.
    const year = sentDate ? Number(sentDate.slice(0, 4)) || defaultYear : defaultYear;
    // Mayúsculas: los imports y el cotizador normalizan a upper — sin esto un
    // número tipeado en minúscula nunca matchea el aviso de duplicados.
    const numero = quoteNumber.trim().toUpperCase();
    try {
      const r = await createQuote({
        quote_number: numero,
        year,
        sent_date: sentDate || null,
        amount_usd: amount === "" ? null : Number(amount),
        status,
        client_name: client || null,
        contact_name: contactName || null,
        contact_phone: contactPhone || null,
        contact_email: contactEmail || null,
        description: description || null,
        rubro: rubro || null,
        follow_up_date: status === "enviada" ? followUp || null : null,
      });
      if ("error" in r) {
        setError(r.error);
        return;
      }
      onCreated({
        id: r.data.id,
        quote_number: numero,
        year,
      sent_date: sentDate || null,
      amount_usd: amount === "" ? null : Number(amount),
      status,
      payment_status: null,
      invoice_status: null,
      client_name: client || null,
      client_id: r.data.client_id,
      client_std_name: r.data.client_std_name,
      location_id: r.data.location_id,
      location_name: r.data.location_name,
      dropbox_shared_url: null,
      dropbox_path: null,
      contact_name: contactName || null,
      contact_phone: contactPhone || null,
      contact_email: contactEmail || null,
      description: description || null,
      notes: null,
      rubro: rubro || null,
      progress: 0,
      follow_up_date: status === "enviada" ? followUp || null : null,
      rejection_reason: null,
      converted_project_id: null,
      qbo_job_id: null,
      qbo_sent_at: null,
      seguimiento_descartado_at: null,
      seguimiento_descartado_motivo: null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Se cortó el guardado — reintenta");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer title="Nueva cotización" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Número *">
          <input className={inputCls} placeholder="COT DC 26-108" value={quoteNumber} onChange={(e) => setQuoteNumber(e.target.value)} />
        </Field>
        <Field label="Cliente">
          <input className={inputCls} value={client} onChange={(e) => setClient(e.target.value)} />
        </Field>
        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500">Contacto (opcional)</span>
          <div className="space-y-2">
            <input className={inputCls} placeholder="Persona de contacto" value={contactName} onChange={(e) => setContactName(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <input className={inputCls} placeholder="WhatsApp" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
              <input type="email" className={inputCls} placeholder="Email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
            </div>
          </div>
        </div>
        <Field label="Descripción">
          <textarea rows={3} className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Monto (B/.)">
            <input type="number" step="0.01" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Rubro">
            <select className={inputCls} value={rubro} onChange={(e) => setRubro(e.target.value as Rubro | "")}>
              <option value="">—</option>
              {RUBRO_KEYS.map((r) => (
                <option key={r} value={r}>
                  {RUBROS[r].label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Estado">
            <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as QuoteStatus)}>
              {QUOTE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {QUOTE_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Fecha de envío">
            <input type="date" className={inputCls} value={sentDate} onChange={(e) => setSentDate(e.target.value)} />
          </Field>
        </div>
        {status === "enviada" ? (
          <Field label="Seguimiento (fecha)">
            <input type="date" className={inputCls} value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
          </Field>
        ) : null}
        {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
        <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Crear cotización
          </button>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
            Cancelar
          </button>
        </div>
      </div>
    </Drawer>
  );
}

// ── Enviar a proyectos (QBO): el cierre del loop cotización → proyecto ────────
// Jala de QBO el próximo correlativo DC/DM (editable), pre-selecciona el
// cliente padre, y crea el proyecto con los campos del formulario de QBO
// (nombre, email, fechas, notas). Opcional: crear también el proyecto de
// tracking en Reportme (fotos/hitos).
function SendToQboDialog({
  quote,
  onClose,
  onSent,
}: {
  quote: QuoteRow;
  onClose: () => void;
  onSent: (patch: Partial<QuoteRow>) => void;
}) {
  const [sug, setSug] = useState<QboSendSuggestion | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [numero, setNumero] = useState("");
  const [nombre, setNombre] = useState("");
  const [parentId, setParentId] = useState("");
  const [parentMode, setParentMode] = useState<"existente" | "nuevo">("existente");
  const [newParent, setNewParent] = useState(quote.client_std_name ?? quote.client_name ?? "");
  const [email, setEmail] = useState(quote.contact_email ?? "");
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState("");
  const [notas, setNotas] = useState("");
  const [alsoTracking, setAlsoTracking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function load() {
    setLoadErr(null);
    setSug(null);
    try {
      const r = await suggestQboProjectSetup(quote.id);
      if ("error" in r) {
        setLoadErr(r.error);
        return;
      }
      setSug(r.data);
      setNumero(r.data.numero);
      setNombre(r.data.nombre);
      setParentId(r.data.matchedParentId ?? r.data.parents[0]?.id ?? "");
      // Sin match por nombre (o sin lista): probablemente el cliente no existe
      // en QBO todavía → arrancar en "cliente nuevo".
      if (!r.data.matchedParentId || r.data.parents.length === 0) setParentMode("nuevo");
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "No se pudo consultar QBO — reintenta");
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Editar el número reescribe el prefijo del nombre (si seguía sincronizado).
  function cambiarNumero(nuevo: string) {
    setNombre((n) => (numero && n.startsWith(numero) ? nuevo + n.slice(numero.length) : n));
    setNumero(nuevo);
  }

  async function crear() {
    if (busy || done) return;
    const parent = parentMode === "existente" ? sug?.parents.find((p) => p.id === parentId) : null;
    if (parentMode === "existente" && !parent) {
      setErr("Elige el cliente de QBO al que pertenece el proyecto.");
      return;
    }
    if (parentMode === "nuevo" && !newParent.trim()) {
      setErr("Escribe el nombre del cliente nuevo para crearlo en QBO.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await sendQuoteToQbo(quote.id, {
        numero: numero.trim(),
        nombre: nombre.trim(),
        parentId: parent?.id ?? null,
        parentName: parent?.name ?? newParent.trim(),
        newParentName: parentMode === "nuevo" ? newParent.trim() : null,
        email: email.trim() || null,
        startDate: startDate || null,
        endDate: endDate || null,
        notas: notas.trim() || null,
      });
      if ("error" in r) {
        setErr(r.error);
        return;
      }
      const patch: Partial<QuoteRow> = {
        status: "aprobada",
        qbo_job_id: r.data.qboJobId,
        qbo_sent_at: new Date().toISOString(),
      };
      // Tracking opcional en Reportme (mejor esfuerzo: si falla, el proyecto de
      // QBO ya quedó creado y se avisa en el panel de éxito).
      let trackingWarn: string | null = null;
      if (alsoTracking && !quote.converted_project_id) {
        const clientName = quote.client_std_name ?? quote.client_name;
        if (quote.client_id || clientName) {
          const cr = await convertQuoteToProject(quote.id, {
            clientId: quote.client_id,
            newClientName: quote.client_id ? null : clientName,
            name: nombre.trim().slice(0, 80),
            projectType: suggestType(quote.rubro),
            locationLabel: quote.location_name,
          });
          if ("error" in cr) trackingWarn = cr.error;
          else patch.converted_project_id = cr.data.projectId;
        } else {
          trackingWarn = "Sin cliente identificado — crea el tracking desde Proyectos.";
        }
      }
      onSent(patch);
      setDone(
        `${r.data.nombre}${r.data.parentCreado ? ` (cliente "${r.data.parentCreado}" creado en QBO)` : ""}${trackingWarn ? ` · Tracking: ${trackingWarn}` : ""}`,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Se cortó el envío — verifica en QBO antes de reintentar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Enviar a proyectos (QuickBooks)" onClose={onClose}>
      <p className="mb-3 text-sm text-slate-600">
        Cotización <strong>{quote.quote_number}</strong> · {formatMoneyExact(quote.amount_usd)} ·{" "}
        {quote.client_std_name ?? quote.client_name ?? "sin cliente"}
      </p>

      {done ? (
        <div className="space-y-3">
          <div className="rounded-xl bg-emerald-50 p-4 ring-1 ring-inset ring-emerald-600/20">
            <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
              <CheckCircle2 className="size-5" /> Proyecto creado en QBO
            </p>
            <p className="mt-1 text-sm text-emerald-700">{done}</p>
            <p className="mt-1 text-xs text-emerald-600">Ya aparece en la sección Proyectos; los números llegan con el próximo &ldquo;Actualizar&rdquo;.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Listo
          </button>
        </div>
      ) : sug === null && loadErr === null ? (
        <div className="space-y-2 py-4">
          <div className="h-9 animate-pulse rounded-lg bg-slate-100" />
          <div className="h-9 animate-pulse rounded-lg bg-slate-100" />
          <p className="text-xs text-slate-400">Consultando el próximo número de contrato en QuickBooks…</p>
        </div>
      ) : loadErr ? (
        <div className="space-y-3">
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{loadErr}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Reintentar
          </button>
        </div>
      ) : sug ? (
        <div className="space-y-3">
          {sug.yaEnviada ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 ring-1 ring-inset ring-amber-600/20">
              Esta cotización ya tiene un proyecto en QBO — enviar otra vez crearía un duplicado.
            </p>
          ) : null}
          {!sug.desdeQbo ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 ring-1 ring-inset ring-amber-600/20">
              QBO no respondió: el número sale de la última sincronización — verifícalo antes de crear.
            </p>
          ) : null}
          <div className="grid grid-cols-[7.5rem_1fr] gap-3">
            <Field label="Número">
              <input className={inputCls} value={numero} onChange={(e) => cambiarNumero(e.target.value.toUpperCase())} />
            </Field>
            <Field label="Nombre del proyecto (como se verá en QBO)">
              <input className={inputCls} value={nombre} onChange={(e) => setNombre(e.target.value)} />
            </Field>
          </div>
          <div>
            <div className="mb-1.5 flex items-center gap-1 text-xs">
              <span className="mr-1 font-semibold uppercase tracking-wider text-slate-500">Cliente en QBO</span>
              <button
                type="button"
                onClick={() => setParentMode("existente")}
                className={cn(
                  "rounded-md px-2.5 py-1 font-semibold",
                  parentMode === "existente" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                )}
              >
                Existente
              </button>
              <button
                type="button"
                onClick={() => setParentMode("nuevo")}
                className={cn(
                  "rounded-md px-2.5 py-1 font-semibold",
                  parentMode === "nuevo" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                )}
              >
                Cliente nuevo
              </button>
            </div>
            {parentMode === "existente" ? (
              <select className={inputCls} value={parentId} onChange={(e) => setParentId(e.target.value)}>
                {sug.parents.length === 0 ? <option value="">(no se pudo leer la lista — usa "Cliente nuevo")</option> : null}
                {sug.parents.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : (
              <div>
                <input
                  className={inputCls}
                  placeholder="Nombre del cliente nuevo en QBO"
                  value={newParent}
                  onChange={(e) => setNewParent(e.target.value)}
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Se crea primero el cliente en QuickBooks y el proyecto queda colgado de él.
                </p>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Fecha de inicio">
              <input type="date" className={inputCls} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="Fecha de entrega">
              <input type="date" className={inputCls} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Email (opcional)">
            <input type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Notas (van al proyecto en QBO)">
            <textarea rows={2} className={inputCls} value={notas} onChange={(e) => setNotas(e.target.value)} />
          </Field>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={alsoTracking} onChange={(e) => setAlsoTracking(e.target.checked)} className="size-4 rounded border-slate-300" />
            Crear también el proyecto de tracking en Reportme (fotos e hitos)
          </label>
          {err ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p> : null}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={crear}
              disabled={busy || !!sug.yaEnviada}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUpRight className="size-4" />}
              {busy ? "Creando en QBO…" : "Crear proyecto en QBO"}
            </button>
            <button type="button" onClick={onClose} disabled={busy} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50">
              Cancelar
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

// Descartar una enviada vieja del seguimiento, dejando el motivo registrado.
function DescartarSeguimientoDialog({
  quote,
  onClose,
  onDone,
}: {
  quote: QuoteRow;
  onClose: () => void;
  onDone: (at: string, motivo: string | null) => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function confirmar() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await dismissSeguimiento(quote.id, motivo);
      if ("error" in r) {
        setErr(r.error);
        return;
      }
      onDone(r.data.at, motivo.trim() || null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo descartar — reintenta");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Descartar del seguimiento" onClose={onClose}>
      <p className="mb-3 text-sm text-slate-600">
        <strong>{quote.quote_number}</strong> · {quote.client_std_name ?? quote.client_name ?? "—"} deja de aparecer en los
        action points. La cotización sigue como enviada.
      </p>
      <Field label="Motivo (queda registrado)">
        <input
          className={inputCls}
          placeholder="Ej: cliente pospuso a 2027, presupuesto congelado…"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          autoFocus
        />
      </Field>
      {err ? <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p> : null}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={confirmar}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
          Descartar
        </button>
        <button type="button" onClick={onClose} disabled={busy} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50">
          Cancelar
        </button>
      </div>
    </Modal>
  );
}

// ════════════════════════════════════ LICITACIONES ════════════════════════════

function LicitacionesTab({
  tenders,
  setTenders,
  clients,
}: {
  tenders: TenderRow[];
  setTenders: React.Dispatch<React.SetStateAction<TenderRow[]>>;
  clients: ClientOpt[];
}) {
  const [vista, setVista] = useState<"mias" | "gobierno">("mias");
  const [estatus, setEstatus] = useState<TenderStatus | "all">("all");
  const [modalidad, setModalidad] = useState<Modalidad | "all">("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortState<TSortKey>>({ key: "amount_ref_usd", dir: "desc" });
  const [editing, setEditing] = useState<TenderRow | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const arr = tenders.filter((x) => {
      if (estatus !== "all" && x.status !== estatus) return false;
      if (modalidad !== "all" && x.modalidad !== modalidad) return false;
      if (needle) {
        const hay = `${x.acto_number ?? ""} ${x.entity ?? ""} ${x.client_std_name ?? ""} ${x.objeto ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    arr.sort((a, b) => compareVals(a[sort.key], b[sort.key], sort.dir));
    return arr;
  }, [tenders, estatus, modalidad, q, sort]);

  const kpis = useMemo(() => {
    let vivas = 0;
    let ganadas = 0;
    let montoGanadas = 0;
    let montoRef = 0;
    for (const x of filtered) {
      montoRef += x.amount_ref_usd ?? 0;
      if (x.status === "ganada") {
        ganadas += 1;
        montoGanadas += x.amount_ref_usd ?? 0;
      } else if (x.status === "presentada" || x.status === "en_revision" || x.status === "por_partir") vivas += 1;
    }
    return { vivas, ganadas, montoGanadas, montoRef };
  }, [filtered]);

  // Conteo para el badge del tab gobierno (lee de la base; el board lo refresca).
  const [govBadge, setGovBadge] = useState<number | null>(null);
  useEffect(() => {
    void listGovTenders().then((r) => {
      if ("error" in r) return;
      const now = Date.now();
      setGovBadge(r.data.rows.filter((x) => x.relevante === true && (!x.fecha_cierre || +new Date(x.fecha_cierre) >= now)).length);
    });
  }, []);

  const tabs = [
    { k: "mias" as const, label: "Mis licitaciones", icon: Gavel, badge: tenders.length },
    { k: "gobierno" as const, label: "Potenciales del gobierno", icon: Landmark, badge: govBadge },
  ];
  const toggle = (
    <div className="mb-4 inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white p-1 text-sm font-semibold shadow-sm">
      {tabs.map(({ k, label, icon: Icon, badge }) => (
        <button
          key={k}
          type="button"
          onClick={() => setVista(k)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 transition-colors",
            vista === k ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100",
          )}
        >
          <Icon className="size-4" />
          {label}
          {badge !== null ? (
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                vista === k ? "bg-white/20 text-white" : k === "gobierno" && badge > 0 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500",
              )}
            >
              {badge}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );

  if (vista === "gobierno") {
    return (
      <>
        {toggle}
        <GovTendersBoard onStats={setGovBadge} />
      </>
    );
  }

  return (
    <>
      {toggle}
      <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Vivas" value={String(kpis.vivas)} sub="presentadas / en revisión" icon={Clock} accent="#2563EB" />
        <Kpi label="Ganadas" value={String(kpis.ganadas)} sub={formatMoney(kpis.montoGanadas)} icon={CheckCircle2} accent="#10B981" />
        <Kpi label="Registradas" value={String(filtered.length)} sub={`${formatMoney(kpis.montoRef)} ref.`} icon={Gavel} accent="#6366F1" />
        <Kpi label="Monto referencial" value={formatMoney(kpis.montoRef)} sub="suma filtrada" icon={DollarSign} accent="#F59E0B" />
      </section>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Dropdown
          label="Estatus"
          value={estatus}
          onChange={(v) => setEstatus(v as TenderStatus | "all")}
          options={[{ v: "all", label: "Todos" }, ...TENDER_STATUSES.map((s) => ({ v: s, label: TENDER_STATUS_LABEL[s] }))]}
        />
        <Dropdown
          label="Modalidad"
          value={modalidad}
          onChange={(v) => setModalidad(v as Modalidad | "all")}
          options={[{ v: "all", label: "Todas" }, ...MODALIDADES.map((m) => ({ v: m, label: MODALIDAD_LABEL[m] }))]}
        />
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar acto, entidad, objeto…"
            className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-sm focus:border-slate-400 focus:outline-none"
          />
        </div>
      </div>

      <p className="mb-2 text-xs text-muted-foreground">
        {filtered.length} de {tenders.length} licitaciones
      </p>

      <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                <SortTh label="Entidad" k="entity" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} />
                <th className="hidden px-3 py-2.5 font-semibold md:table-cell">Objeto</th>
                <SortTh label="Modalidad" k="modalidad" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} />
                <SortTh label="Ref. (B/.)" k="amount_ref_usd" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k, "desc"))} align="right" className="text-right" />
                <SortTh label="Estatus" k="status" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} />
                <th className="hidden px-3 py-2.5 font-semibold sm:table-cell">Rubro</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-12 text-center text-sm text-muted-foreground">
                    Sin licitaciones con estos filtros.
                  </td>
                </tr>
              ) : (
                filtered.map((x) => (
                  <tr
                    key={x.id}
                    onClick={() => setEditing(x)}
                    className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50/60"
                  >
                    <td className="max-w-[220px] px-3 py-2.5">
                      <div className="truncate font-medium text-slate-900">{x.client_std_name ?? x.entity ?? "—"}</div>
                      {!x.client_id && x.entity ? (
                        <span className="text-[10px] font-medium text-amber-600">sin estandarizar</span>
                      ) : x.client_std_name && x.entity && norm(x.client_std_name) !== norm(x.entity) ? (
                        <span className="block truncate text-[10px] text-slate-400">{x.entity}</span>
                      ) : null}
                    </td>
                    <td className="hidden max-w-[300px] truncate px-3 py-2.5 text-slate-500 md:table-cell">{x.objeto ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{x.modalidad ? MODALIDAD_LABEL[x.modalidad] : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-700">
                      {x.amount_ref_usd === null ? "—" : formatMoneyExact(x.amount_ref_usd)}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusChip color={TENDER_STATUS_COLOR[x.status]} label={TENDER_STATUS_LABEL[x.status]} />
                    </td>
                    <td className="hidden px-3 py-2.5 sm:table-cell">{x.rubro ? <RubroChip rubro={x.rubro} /> : "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing ? (
        <TenderDrawer
          tender={editing}
          clients={clients}
          onClose={() => setEditing(null)}
          onSaved={(u) => {
            setTenders((prev) => prev.map((x) => (x.id === u.id ? u : x)));
            setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}

function TenderDrawer({
  tender,
  clients,
  onClose,
  onSaved,
}: {
  tender: TenderRow;
  clients: ClientOpt[];
  onClose: () => void;
  onSaved: (t: TenderRow) => void;
}) {
  const [f, setF] = useState<TenderRow>(tender);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof TenderRow>(k: K, v: TenderRow[K]) {
    setF((prev) => ({ ...prev, [k]: v }));
  }
  const tenderLocs = clients.find((c) => c.id === f.client_id)?.locations ?? [];

  async function save() {
    setSaving(true);
    setError(null);
    const r = await updateTender(tender.id, {
      status: f.status,
      execution_status: f.execution_status,
      amount_ref_usd: f.amount_ref_usd,
      delivery_date: f.delivery_date,
      notes: f.notes,
      folder_url: f.folder_url,
      rubro: f.rubro,
      client_id: f.client_id,
      location_id: f.location_id,
    });
    setSaving(false);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    onSaved(f);
  }

  return (
    <Drawer title={f.entity ?? "Licitación"} onClose={onClose}>
      <div className="space-y-3">
        {f.objeto ? <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{f.objeto}</p> : null}
        {f.acto_number ? <p className="text-xs text-slate-400">Acto: {f.acto_number}</p> : null}
        <Field label="Cliente" hint="entidad estandarizada">
          <select
            className={inputCls}
            value={f.client_id ?? ""}
            onChange={(e) => {
              const id = e.target.value || null;
              const name = id ? clients.find((c) => c.id === id)?.name ?? null : null;
              setF((prev) => ({ ...prev, client_id: id, client_std_name: name, location_id: null, location_name: null }));
            }}
          >
            <option value="">— Sin cliente estandarizado —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        {f.client_id && tenderLocs.length > 0 ? (
          <Field label="Sucursal / lugar">
            <select
              className={inputCls}
              value={f.location_id ?? ""}
              onChange={(e) => {
                const id = e.target.value || null;
                const name = id ? tenderLocs.find((l) => l.id === id)?.name ?? null : null;
                setF((prev) => ({ ...prev, location_id: id, location_name: name }));
              }}
            >
              <option value="">— Sin sucursal —</option>
              {tenderLocs.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Estatus">
            <select className={inputCls} value={f.status} onChange={(e) => set("status", e.target.value as TenderStatus)}>
              {TENDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TENDER_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Rubro">
            <select className={inputCls} value={f.rubro ?? ""} onChange={(e) => set("rubro", (e.target.value || null) as Rubro | null)}>
              <option value="">—</option>
              {RUBRO_KEYS.map((r) => (
                <option key={r} value={r}>
                  {RUBROS[r].label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Monto referencial">
            <input
              type="number"
              step="0.01"
              className={inputCls}
              value={f.amount_ref_usd ?? ""}
              onChange={(e) => set("amount_ref_usd", e.target.value === "" ? null : Number(e.target.value))}
            />
          </Field>
          <Field label="Fecha de entrega">
            <input type="date" className={inputCls} value={f.delivery_date ?? ""} onChange={(e) => set("delivery_date", e.target.value || null)} />
          </Field>
        </div>
        <Field label="Estatus de ejecución" hint="OC en espera, Terminado, En ejecución…">
          <input className={inputCls} value={f.execution_status ?? ""} onChange={(e) => set("execution_status", e.target.value || null)} />
        </Field>
        <Field label="Carpeta (Dropbox)">
          <input className={inputCls} placeholder="https://…" value={f.folder_url ?? ""} onChange={(e) => set("folder_url", e.target.value || null)} />
        </Field>
        {f.folder_url ? (
          <a href={f.folder_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline">
            <ExternalLink className="size-3.5" /> Abrir carpeta
          </a>
        ) : null}
        <Field label="Comentarios">
          <textarea rows={2} className={inputCls} value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value || null)} />
        </Field>
        {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
        <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Guardar
          </button>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
            Cancelar
          </button>
        </div>
      </div>
    </Drawer>
  );
}

// ════════════════════════════════════ UI helpers ════════════════════════════

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-slate-400">{hint}</span> : null}
    </label>
  );
}

function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="h-full w-full max-w-md overflow-y-auto bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
          <h3 className="truncate text-base font-semibold text-slate-900">{title}</h3>
          <button type="button" onClick={onClose} className="flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100" aria-label="Cerrar">
            <X className="size-5" />
          </button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button type="button" onClick={onClose} className="flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100" aria-label="Cerrar">
            <X className="size-5" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors",
        active ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700",
      )}
    >
      <Icon className="size-4" />
      {children}
    </button>
  );
}

function Kpi({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${accent}17`, color: accent }}>
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-slate-500">{label}</p>
          <p className="mt-0.5 truncate text-xl font-bold tracking-tight text-slate-900 tabular-nums sm:text-2xl">{value}</p>
        </div>
      </div>
      <p className="mt-2 truncate text-[11px] text-slate-500">{sub}</p>
    </div>
  );
}

function StatusChip({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ backgroundColor: `${color}1f`, color }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function RubroChip({ rubro }: { rubro: Rubro }) {
  const r = RUBROS[rubro];
  return (
    <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: r.soft, color: r.color }}>
      {r.label}
    </span>
  );
}

function SegMulti({ options, value, onChange }: { options: { k: string; label: string }[]; value: string; onChange: (k: string) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
      {options.map((o) => (
        <button
          key={o.k}
          type="button"
          onClick={() => onChange(o.k)}
          className={cn(
            "rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors",
            value === o.k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Dropdown({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { v: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={label}
      className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
    >
      {options.map((o) => (
        <option key={o.v} value={o.v}>
          {label}: {o.label}
        </option>
      ))}
    </select>
  );
}
