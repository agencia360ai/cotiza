"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
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
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  MessageCircle,
  Mail,
  FolderOpen,
  MapPin,
  Sparkles,
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
import { PROJECT_TYPE_LABEL, type ProjectType } from "@/lib/projects/types";
import {
  updateQuote,
  createQuote,
  deleteQuote,
  convertQuoteToProject,
  updateTender,
} from "./actions";
import { DropboxImportDialog } from "./dropbox-import";
import { CotizadorDialog } from "./cotizador";

const RUBRO_KEYS = Object.keys(RUBROS) as Rubro[];
type ClientOpt = { id: string; name: string; locations: { id: string; name: string }[] };

type QSortKey = "quote_number" | "client_name" | "amount_usd" | "status" | "sent_date";
type TSortKey = "entity" | "amount_ref_usd" | "status" | "modalidad";
const QUOTE_STATUSES: QuoteStatus[] = ["enviada", "aprobada", "rechazada"];
const TENDER_STATUSES: TenderStatus[] = ["presentada", "en_revision", "por_partir", "ganada", "no_ganada"];
const MODALIDADES: Modalidad[] = ["licitacion_publica", "compra_menor", "contratacion_menor", "otro"];
const PROJECT_TYPES: ProjectType[] = ["obra", "instalacion", "remodelacion", "otro"];

const today = () => new Date().toISOString().slice(0, 10);
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString("es-PA", { day: "2-digit", month: "short", year: "2-digit" });
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

// ── Revisiones: "COT DC 26-020 REV. 2" → base "COT DC 26-020" + rev 2 ─────────
// La última revisión es la vigente (cuenta en KPIs); las anteriores quedan como
// historial colapsado. Misma base + misma rev = posible duplicado real.
type QuoteGroup = { main: QuoteRow; older: QuoteRow[]; dupCount: number };

function parseRev(qn: string): { base: string; rev: number } {
  const s = qn.replace(/\s+/g, " ").trim();
  let m = s.match(/^(.*?)[\s.-]*(?:rev\.?\s*|r)(\d+(?:\.\d+)?)$/i);
  if (m && m[1].trim().length >= 4) return { base: m[1].trim().toUpperCase(), rev: parseFloat(m[2]) };
  // "R" / "REV" suelto al final (sin dígitos) = primera revisión. Requiere
  // separador antes para no comerse palabras que terminan en R (COMPRESOR).
  m = s.match(/^(.*?)[\s.-]+(?:rev\.?|r)$/i);
  if (m && m[1].trim().length >= 4) return { base: m[1].trim().toUpperCase(), rev: 1 };
  return { base: s.toUpperCase(), rev: 0 };
}

function groupRevisions(rows: QuoteRow[]): QuoteGroup[] {
  const byBase = new Map<string, QuoteRow[]>();
  for (const r of rows) {
    const { base } = parseRev(r.quote_number);
    const arr = byBase.get(base) ?? [];
    arr.push(r);
    byBase.set(base, arr);
  }
  const out: QuoteGroup[] = [];
  for (const arr of byBase.values()) {
    const sortedArr = [...arr].sort((a, b) => {
      const ra = parseRev(a.quote_number).rev;
      const rb = parseRev(b.quote_number).rev;
      if (ra !== rb) return rb - ra;
      return (b.sent_date ?? "").localeCompare(a.sent_date ?? "");
    });
    const main = sortedArr[0];
    const maxRev = parseRev(main.quote_number).rev;
    const dupCount = sortedArr.filter((r) => parseRev(r.quote_number).rev === maxRev).length - 1;
    out.push({ main, older: sortedArr.slice(1), dupCount });
  }
  return out;
}

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
  const [converting, setConverting] = useState<QuoteRow | null>(null);
  const [showDropbox, setShowDropbox] = useState(false);
  const [showCotizador, setShowCotizador] = useState(false);

  // Agrupar revisiones: solo la vigente cuenta; las anteriores van colapsadas.
  const groups = useMemo(() => groupRevisions(quotes), [quotes]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return groups.filter(({ main: x, older }) => {
      if (year !== "all" && x.year !== year) return false;
      if (estado !== "all" && x.status !== estado) return false;
      if (rubro !== "all" && x.rubro !== rubro) return false;
      if (from && (!x.sent_date || x.sent_date < from)) return false;
      if (to && (!x.sent_date || x.sent_date > to)) return false;
      if (soloSinCliente && x.client_id) return false;
      if (needle) {
        const hay = [x, ...older]
          .map((r) => `${r.quote_number} ${r.client_name ?? ""} ${r.client_std_name ?? ""} ${r.description ?? ""}`)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [groups, year, estado, rubro, q, from, to, soloSinCliente]);

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

  const sinClienteCount = useMemo(() => groups.filter((g) => !g.main.client_id).length, [groups]);
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

  return (
    <>
      <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="En juego" value={formatMoney(kpis.enviadaMonto)} sub="enviadas sin cerrar" icon={Clock} accent="#F59E0B" />
        <Kpi label="Aprobadas" value={String(kpis.aprobadaCount)} sub={formatMoney(kpis.aprobadaMonto)} icon={CheckCircle2} accent="#10B981" />
        <Kpi label="Por cobrar" value={String(kpis.porCobrar)} sub="aprobadas sin pago" icon={DollarSign} accent="#2563EB" />
        <Kpi label="Tasa de cierre" value={`${kpis.cierre}%`} sub={`${kpis.rechazadaCount} rechazadas`} icon={TrendingUp} accent="#6366F1" />
      </section>

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
          onClick={() => setShowCotizador(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700"
          title="Generar una cotización con IA a partir de una línea"
        >
          <Sparkles className="size-4" />
          <span className="hidden sm:inline">Cotizador IA</span>
        </button>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          <Plus className="size-4" />
          <span className="hidden sm:inline">Nueva</span>
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

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
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
                        {fmtDate(x.sent_date)}
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
                          {x.status === "aprobada" && !x.converted_project_id ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setConverting(x);
                              }}
                              className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
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
          onClose={() => setEditing(null)}
          onSaved={(u) => {
            applyLocal(u);
            setEditing(null);
          }}
          onDeleted={(id) => {
            setQuotes((prev) => prev.filter((x) => x.id !== id));
            setEditing(null);
          }}
          onConvert={() => {
            setConverting(editing);
            setEditing(null);
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

      {converting ? (
        <ConvertDialog
          quote={converting}
          clients={clients}
          onClose={() => setConverting(null)}
          onConverted={(projectId) => {
            setQuotes((prev) =>
              prev.map((x) => (x.id === converting.id ? { ...x, converted_project_id: projectId } : x)),
            );
            setConverting(null);
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
  onConvert,
}: {
  quote: QuoteRow;
  clients: ClientOpt[];
  onClose: () => void;
  onSaved: (q: QuoteRow) => void;
  onDeleted: (id: string) => void;
  onConvert: () => void;
}) {
  const [f, setF] = useState<QuoteRow>(quote);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof QuoteRow>(k: K, v: QuoteRow[K]) {
    setF((prev) => ({ ...prev, [k]: v }));
  }
  const clientLocs = clients.find((c) => c.id === f.client_id)?.locations ?? [];

  async function save() {
    setSaving(true);
    setError(null);
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
    setSaving(false);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    onSaved(f);
  }

  return (
    <Drawer title={`Cotización ${quote.quote_number}`} onClose={onClose}>
      <div className="space-y-3">
        <a
          href={`/carta/${quote.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <ExternalLink className="size-3.5" /> Ver carta / imprimir
        </a>
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

        {f.converted_project_id ? (
          <Link
            href={`/proyectos/${f.converted_project_id}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
          >
            <ArrowUpRight className="size-4" />
            Ver proyecto vinculado
          </Link>
        ) : f.status === "aprobada" ? (
          <button
            type="button"
            onClick={onConvert}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
          >
            <ArrowUpRight className="size-4" />
            Convertir a proyecto
          </button>
        ) : null}

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
          <button
            type="button"
            onClick={async () => {
              if (!confirm(`¿Eliminar la cotización ${quote.quote_number}?`)) return;
              const r = await deleteQuote(quote.id);
              if (!("error" in r)) onDeleted(quote.id);
            }}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50"
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
    const r = await createQuote({
      quote_number: quoteNumber.trim(),
      year: defaultYear,
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
    setSaving(false);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    onCreated({
      id: r.data.id,
      quote_number: quoteNumber.trim(),
      year: defaultYear,
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
    });
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

function ConvertDialog({
  quote,
  clients,
  onClose,
  onConverted,
}: {
  quote: QuoteRow;
  clients: ClientOpt[];
  onClose: () => void;
  onConverted: (projectId: string) => void;
}) {
  // Pre-match cliente por nombre.
  const preMatch = useMemo(() => {
    if (quote.client_id) {
      const byId = clients.find((c) => c.id === quote.client_id);
      if (byId) return byId;
    }
    const n = (quote.client_name ?? "").trim().toLowerCase();
    if (!n) return null;
    return clients.find((c) => c.name.trim().toLowerCase() === n) ?? clients.find((c) => n.includes(c.name.trim().toLowerCase())) ?? null;
  }, [quote.client_id, quote.client_name, clients]);

  const [mode, setMode] = useState<"existing" | "new">(preMatch ? "existing" : clients.length ? "existing" : "new");
  const [clientId, setClientId] = useState(preMatch?.id ?? clients[0]?.id ?? "");
  const [newClient, setNewClient] = useState(quote.client_name ?? "");
  const [name, setName] = useState(
    quote.description ? quote.description.slice(0, 60) : `Proyecto ${quote.quote_number}`,
  );
  const [projectType, setProjectType] = useState<ProjectType>(suggestType(quote.rubro));
  const [location, setLocation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function convert() {
    if (!name.trim()) {
      setError("Poné un nombre al proyecto");
      return;
    }
    setSaving(true);
    setError(null);
    const r = await convertQuoteToProject(quote.id, {
      clientId: mode === "existing" ? clientId : null,
      newClientName: mode === "new" ? newClient : null,
      name,
      projectType,
      locationLabel: location || null,
    });
    setSaving(false);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    onConverted(r.data.projectId);
  }

  return (
    <Modal title="Convertir a proyecto" onClose={onClose}>
      <p className="mb-4 text-sm text-slate-600">
        Cotización <strong>{quote.quote_number}</strong> · {formatMoneyExact(quote.amount_usd)}
      </p>
      <div className="space-y-3">
        <div>
          <div className="mb-1.5 flex gap-1 text-xs">
            <button
              type="button"
              onClick={() => setMode("existing")}
              className={cn("rounded-md px-2.5 py-1 font-semibold", mode === "existing" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600")}
            >
              Cliente existente
            </button>
            <button
              type="button"
              onClick={() => setMode("new")}
              className={cn("rounded-md px-2.5 py-1 font-semibold", mode === "new" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600")}
            >
              Cliente nuevo
            </button>
          </div>
          {mode === "existing" ? (
            <select className={inputCls} value={clientId} onChange={(e) => setClientId(e.target.value)}>
              {clients.length === 0 ? <option value="">(no hay clientes — creá uno)</option> : null}
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : (
            <input className={inputCls} placeholder="Nombre del cliente nuevo" value={newClient} onChange={(e) => setNewClient(e.target.value)} />
          )}
        </div>
        <Field label="Nombre del proyecto">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo">
            <select className={inputCls} value={projectType} onChange={(e) => setProjectType(e.target.value as ProjectType)}>
              {PROJECT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PROJECT_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sucursal / lugar">
            <input className={inputCls} placeholder="Opcional" value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
        </div>
        {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={convert}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <ArrowUpRight className="size-4" />}
            Crear proyecto
          </button>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
            Cancelar
          </button>
        </div>
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

  return (
    <>
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

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
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

type SortDir = "asc" | "desc";
type SortState<K extends string> = { key: K; dir: SortDir };

function toggleSort<K extends string>(cur: SortState<K>, key: K, defaultDir: SortDir = "asc"): SortState<K> {
  if (cur.key === key) return { key, dir: cur.dir === "asc" ? "desc" : "asc" };
  return { key, dir: defaultDir };
}

function compareVals(a: unknown, b: unknown, dir: SortDir): number {
  const an = a === null || a === undefined || a === "";
  const bn = b === null || b === undefined || b === "";
  if (an && bn) return 0;
  if (an) return 1; // nulls/vacíos siempre al final
  if (bn) return -1;
  let r: number;
  if (typeof a === "number" && typeof b === "number") r = a - b;
  else r = String(a).localeCompare(String(b), "es", { numeric: true });
  return dir === "asc" ? r : -r;
}

function SortTh<K extends string>({
  label,
  k,
  sort,
  onSort,
  align = "left",
  className,
}: {
  label: string;
  k: K;
  sort: SortState<K>;
  onSort: (k: K) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort.key === k;
  return (
    <th
      className={cn("cursor-pointer select-none px-3 py-2.5 font-semibold hover:text-slate-700", className)}
      onClick={() => onSort(k)}
    >
      <span className={cn("inline-flex items-center gap-1", align === "right" && "flex-row-reverse")}>
        {label}
        {active ? (
          sort.dir === "asc" ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />
        ) : (
          <ChevronsUpDown className="size-3.5 opacity-30" />
        )}
      </span>
    </th>
  );
}

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
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="flex size-7 items-center justify-center rounded-lg" style={{ backgroundColor: `${accent}1f`, color: accent }}>
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
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
