"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Plus,
  Search,
  Loader2,
  X,
  MessageCircle,
  Mail,
  Clock,
  AlertTriangle,
  CalendarClock,
  DollarSign,
  Trash2,
  ArrowUpRight,
  FileText,
  GripVertical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LEAD_STATUS_ORDER,
  LEAD_STATUS_LABEL,
  LEAD_STATUS_COLOR,
  LEAD_STATUS_ACTIVAS,
  LEAD_SOURCES,
  LEAD_SOURCE_LABEL,
  type LeadRow,
  type LeadStatus,
} from "@/lib/leads/types";
import {
  listLeads,
  createLead,
  updateLead,
  setLeadStatus,
  addLeadNote,
  deleteLead,
  convertLeadToQuote,
  type LeadInput,
} from "./actions";

// ── helpers ──────────────────────────────────────────────────────────────────
const inputCls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Panama" });
function diasHasta(iso: string | null): number | null {
  if (!iso) return null;
  return Math.round((+new Date(iso + "T00:00:00") - +new Date(today() + "T00:00:00")) / 86400000);
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso.slice(0, 10) + "T00:00:00").toLocaleDateString("es-PA", { day: "2-digit", month: "short" });
}
function relFromNow(iso: string | null): string {
  if (!iso) return "";
  const d = Math.floor((Date.now() - +new Date(iso)) / 86400000);
  if (d <= 0) return "hoy";
  if (d === 1) return "ayer";
  return `hace ${d} d`;
}
function money(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}
function waLink(phone: string | null): string | null {
  if (!phone) return null;
  const t = phone.trim();
  if (/wa\.me|whatsapp/i.test(t)) return t.startsWith("http") ? t : `https://${t.replace(/^\/+/, "")}`;
  const digits = t.replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : null;
}

// Chip de próximo seguimiento: vencido (rojo) · hoy (ámbar) · futuro (slate).
function FollowUpChip({ iso }: { iso: string | null }) {
  const d = diasHasta(iso);
  if (d === null) return <span className="text-[11px] text-slate-300">sin seguimiento</span>;
  const cls =
    d < 0 ? "bg-rose-50 text-rose-700 ring-rose-600/20" : d === 0 ? "bg-amber-50 text-amber-700 ring-amber-600/20" : "bg-slate-100 text-slate-500 ring-slate-200";
  const txt = d < 0 ? `vencido ${-d} d` : d === 0 ? "hoy" : `en ${d} d`;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset", cls)}>
      <CalendarClock className="size-3" /> {txt} · {fmtDate(iso)}
    </span>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full" style={{ backgroundColor: accent }} />
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      </div>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
      <p className="text-[11px] text-slate-400">{sub}</p>
    </div>
  );
}

// ── card ─────────────────────────────────────────────────────────────────────
function LeadCard({ lead, onOpen, onDragStart }: { lead: LeadRow; onOpen: () => void; onDragStart: () => void }) {
  const wa = waLink(lead.whatsapp);
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onOpen}
      className="group cursor-pointer rounded-xl border border-slate-100 bg-white p-3 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50/60"
    >
      <div className="flex items-start gap-1.5">
        <GripVertical className="mt-0.5 size-3.5 shrink-0 text-slate-300 group-hover:text-slate-400" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{lead.company_name ?? lead.contact_name ?? "—"}</p>
          {lead.contact_name && lead.company_name ? <p className="truncate text-xs text-slate-500">{lead.contact_name}</p> : null}
          {lead.description ? <p className="mt-1 line-clamp-2 text-xs text-slate-500">{lead.description}</p> : null}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {lead.estimated_value ? (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                {money(lead.estimated_value)}
              </span>
            ) : null}
            <FollowUpChip iso={lead.next_follow_up} />
          </div>
          <div className="mt-2 flex items-center gap-1">
            {wa ? (
              <a
                href={wa}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex size-6 items-center justify-center rounded-md text-emerald-600 hover:bg-emerald-50"
                title="WhatsApp"
              >
                <MessageCircle className="size-3.5" />
              </a>
            ) : null}
            {lead.email ? (
              <a
                href={`mailto:${lead.email}`}
                onClick={(e) => e.stopPropagation()}
                className="flex size-6 items-center justify-center rounded-md text-blue-600 hover:bg-blue-50"
                title={lead.email}
              >
                <Mail className="size-3.5" />
              </a>
            ) : null}
            {lead.converted_quote_id ? (
              <span title="Ya tiene cotización" className="ml-auto">
                <FileText className="size-3.5 text-violet-500" />
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── board ────────────────────────────────────────────────────────────────────
export function LeadsBoard() {
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<LeadStatus | null>(null);

  useEffect(() => {
    void listLeads().then((r) => {
      setLoading(false);
      if ("error" in r) setError(r.error);
      else setLeads(r.data);
    });
  }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return leads;
    return leads.filter((l) =>
      `${l.company_name ?? ""} ${l.contact_name ?? ""} ${l.description ?? ""} ${l.email ?? ""}`.toLowerCase().includes(needle),
    );
  }, [leads, q]);

  const byStatus = useMemo(() => {
    const m = new Map<LeadStatus, LeadRow[]>();
    for (const s of LEAD_STATUS_ORDER) m.set(s, []);
    for (const l of shown) m.get(l.status)?.push(l);
    // Dentro de cada columna: seguimiento más urgente arriba (vencidos primero).
    for (const s of LEAD_STATUS_ORDER) {
      m.get(s)!.sort((a, b) => {
        const da = diasHasta(a.next_follow_up);
        const db = diasHasta(b.next_follow_up);
        if (da === null && db === null) return (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
        if (da === null) return 1;
        if (db === null) return -1;
        return da - db;
      });
    }
    return m;
  }, [shown]);

  const kpis = useMemo(() => {
    let activos = 0;
    let nuevos = 0;
    let vencidos = 0;
    let pipeline = 0;
    let ganados = 0;
    for (const l of leads) {
      const activo = (LEAD_STATUS_ACTIVAS as LeadStatus[]).includes(l.status);
      if (activo) {
        activos++;
        pipeline += l.estimated_value ?? 0;
        const d = diasHasta(l.next_follow_up);
        if (d !== null && d <= 0) vencidos++;
      }
      if (l.status === "nuevo") nuevos++;
      if (l.status === "ganado") ganados++;
    }
    return { activos, nuevos, vencidos, pipeline, ganados };
  }, [leads]);

  async function moverA(id: string, status: LeadStatus) {
    const prev = leads.find((l) => l.id === id);
    if (!prev || prev.status === status) return;
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, status } : l)));
    try {
      const r = await setLeadStatus(id, status);
      if ("error" in r) {
        setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, status: prev.status } : l)));
        setError(r.error);
      }
    } catch {
      setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, status: prev.status } : l)));
    }
  }

  const openLead = leads.find((l) => l.id === openId) ?? null;

  return (
    <div className="px-4 py-6 md:px-10 md:py-8">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Leads</h1>
          <p className="mt-0.5 text-sm text-slate-500">Clientes potenciales en seguimiento — antes de que sean cotización.</p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800"
        >
          <Plus className="size-4" /> Nuevo lead
        </button>
      </div>

      <section className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Activos" value={String(kpis.activos)} sub="en el pipeline" accent="#6366F1" />
        <Kpi label="Seguimiento vencido" value={String(kpis.vencidos)} sub="hoy o atrasados" accent="#EF4444" />
        <Kpi label="Valor en pipeline" value={money(kpis.pipeline)} sub="estimado activo" accent="#F59E0B" />
        <Kpi label="Ganados" value={String(kpis.ganados)} sub="convertidos" accent="#10B981" />
      </section>

      <div className="mb-4 flex items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente, contacto, proyecto…" className={cn(inputCls, "pl-8")} />
        </div>
        {kpis.vencidos > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-600/20">
            <AlertTriangle className="size-3.5" /> {kpis.vencidos} con seguimiento vencido
          </span>
        ) : null}
      </div>

      {error ? <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-inset ring-red-600/20">{error}</p> : null}

      {loading ? (
        <div className="flex h-40 items-center justify-center text-slate-400">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : (
        <div className="overflow-x-auto pb-4">
          <div className="flex min-w-max gap-3">
            {LEAD_STATUS_ORDER.map((s) => {
              const col = byStatus.get(s) ?? [];
              const color = LEAD_STATUS_COLOR[s];
              return (
                <div
                  key={s}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dragOver !== s) setDragOver(s);
                  }}
                  onDragLeave={() => setDragOver((d) => (d === s ? null : d))}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = dragId ?? e.dataTransfer.getData("text/plain");
                    setDragOver(null);
                    setDragId(null);
                    if (id) void moverA(id, s);
                  }}
                  className={cn(
                    "flex w-[280px] shrink-0 flex-col rounded-2xl border bg-slate-50/60 transition-colors",
                    dragOver === s ? "border-indigo-300 bg-indigo-50/60" : "border-slate-100",
                  )}
                >
                  <div className="flex items-center justify-between gap-2 px-3 pt-3">
                    <div className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
                      <span className="text-xs font-bold uppercase tracking-wide text-slate-600">{LEAD_STATUS_LABEL[s]}</span>
                    </div>
                    <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-slate-500 ring-1 ring-inset ring-slate-200">
                      {col.length}
                    </span>
                  </div>
                  <div className="h-0.5 w-full" />
                  <div className="flex flex-1 flex-col gap-2 p-2.5">
                    {col.map((l) => (
                      <LeadCard
                        key={l.id}
                        lead={l}
                        onOpen={() => setOpenId(l.id)}
                        onDragStart={() => setDragId(l.id)}
                      />
                    ))}
                    {col.length === 0 ? (
                      <p className="px-1 py-6 text-center text-[11px] text-slate-300">Arrastra un lead aquí</p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {creating ? (
        <NewLeadDrawer
          onClose={() => setCreating(false)}
          onCreated={(l) => {
            setLeads((ls) => [l, ...ls]);
            setCreating(false);
          }}
        />
      ) : null}

      {openLead ? (
        <LeadDrawer
          lead={openLead}
          onClose={() => setOpenId(null)}
          onChanged={(l) => setLeads((ls) => ls.map((x) => (x.id === l.id ? l : x)))}
          onDeleted={(id) => {
            setLeads((ls) => ls.filter((x) => x.id !== id));
            setOpenId(null);
          }}
        />
      ) : null}
    </div>
  );
}

// ── drawer: nuevo lead ───────────────────────────────────────────────────────
function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
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

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-slate-400">{hint}</span> : null}
    </label>
  );
}

const EMPTY: LeadInput = {
  company_name: null,
  contact_name: null,
  whatsapp: null,
  email: null,
  description: null,
  status: "nuevo",
  estimated_value: null,
  source: null,
  next_follow_up: null,
};

function NewLeadDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: (l: LeadRow) => void }) {
  const [f, setF] = useState<LeadInput>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof LeadInput>(k: K, v: LeadInput[K]) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const r = await createLead(f);
      if ("error" in r) setError(r.error);
      else onCreated(r.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer title="Nuevo lead" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Cliente / empresa" hint="con esto o el contacto basta">
          <input className={inputCls} value={f.company_name ?? ""} onChange={(e) => set("company_name", e.target.value || null)} />
        </Field>
        <Field label="Contacto (persona)">
          <input className={inputCls} value={f.contact_name ?? ""} onChange={(e) => set("contact_name", e.target.value || null)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="WhatsApp">
            <input className={inputCls} placeholder="+507…" value={f.whatsapp ?? ""} onChange={(e) => set("whatsapp", e.target.value || null)} />
          </Field>
          <Field label="Email">
            <input type="email" className={inputCls} value={f.email ?? ""} onChange={(e) => set("email", e.target.value || null)} />
          </Field>
        </div>
        <Field label="Descripción del proyecto">
          <textarea rows={3} className={inputCls} value={f.description ?? ""} onChange={(e) => set("description", e.target.value || null)} placeholder="Qué necesita…" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor estimado">
            <input
              type="number"
              step="0.01"
              className={inputCls}
              value={f.estimated_value ?? ""}
              onChange={(e) => set("estimated_value", e.target.value === "" ? null : Number(e.target.value))}
            />
          </Field>
          <Field label="Próximo seguimiento">
            <input type="date" className={inputCls} value={f.next_follow_up ?? ""} onChange={(e) => set("next_follow_up", e.target.value || null)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Origen">
            <select className={inputCls} value={f.source ?? ""} onChange={(e) => set("source", e.target.value || null)}>
              <option value="">—</option>
              {LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {LEAD_SOURCE_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Etapa">
            <select className={inputCls} value={f.status} onChange={(e) => set("status", e.target.value as LeadStatus)}>
              {LEAD_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {LEAD_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
        <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Agregar lead
          </button>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
            Cancelar
          </button>
        </div>
      </div>
    </Drawer>
  );
}

// ── drawer: detalle / edición / bitácora / convertir ─────────────────────────
function LeadDrawer({
  lead,
  onClose,
  onChanged,
  onDeleted,
}: {
  lead: LeadRow;
  onClose: () => void;
  onChanged: (l: LeadRow) => void;
  onDeleted: (id: string) => void;
}) {
  const [f, setF] = useState<LeadRow>(lead);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nota, setNota] = useState("");
  const [notaBusy, setNotaBusy] = useState(false);
  const [converting, setConverting] = useState(false);
  const [converted, setConverted] = useState<{ quoteId: string; quoteNumber: string } | null>(null);
  const firstRender = useRef(true);
  const set = <K extends keyof LeadRow>(k: K, v: LeadRow[K]) => setF((p) => ({ ...p, [k]: v }));

  // Autosave con debounce de los campos editables (excepto activity).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = setTimeout(async () => {
      setSaving(true);
      const r = await updateLead(f.id, {
        company_name: f.company_name,
        contact_name: f.contact_name,
        whatsapp: f.whatsapp,
        email: f.email,
        description: f.description,
        status: f.status,
        estimated_value: f.estimated_value,
        source: f.source,
        next_follow_up: f.next_follow_up,
        lost_reason: f.lost_reason,
      });
      setSaving(false);
      if ("error" in r) setError(r.error);
      else {
        setError(null);
        onChanged(f);
      }
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    f.company_name,
    f.contact_name,
    f.whatsapp,
    f.email,
    f.description,
    f.status,
    f.estimated_value,
    f.source,
    f.next_follow_up,
    f.lost_reason,
  ]);

  async function guardarNota() {
    const txt = nota.trim();
    if (!txt) return;
    setNotaBusy(true);
    try {
      const r = await addLeadNote(f.id, txt);
      if ("error" in r) setError(r.error);
      else {
        const upd = { ...f, activity: r.data.activity, last_contact_at: r.data.nowIso };
        setF(upd);
        onChanged(upd);
        setNota("");
      }
    } finally {
      setNotaBusy(false);
    }
  }

  async function convertir() {
    setConverting(true);
    setError(null);
    try {
      const r = await convertLeadToQuote(f.id);
      if ("error" in r) setError(r.error);
      else {
        setConverted(r.data);
        const upd = { ...f, status: "cotizado" as LeadStatus, converted_quote_id: r.data.quoteId };
        setF(upd);
        onChanged(upd);
      }
    } finally {
      setConverting(false);
    }
  }

  async function eliminar() {
    if (!confirm("¿Eliminar este lead? No se puede deshacer.")) return;
    const r = await deleteLead(f.id);
    if ("error" in r) setError(r.error);
    else onDeleted(f.id);
  }

  const wa = waLink(f.whatsapp);

  return (
    <Drawer title={f.company_name ?? f.contact_name ?? "Lead"} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
            {saving ? (
              <>
                <Loader2 className="size-3 animate-spin" /> Guardando…
              </>
            ) : (
              <>Cambios se guardan solos</>
            )}
          </span>
          <div className="flex items-center gap-1">
            {wa ? (
              <a href={wa} target="_blank" rel="noopener noreferrer" className="flex size-7 items-center justify-center rounded-md text-emerald-600 hover:bg-emerald-50" title="WhatsApp">
                <MessageCircle className="size-4" />
              </a>
            ) : null}
            {f.email ? (
              <a href={`mailto:${f.email}`} className="flex size-7 items-center justify-center rounded-md text-blue-600 hover:bg-blue-50" title={f.email}>
                <Mail className="size-4" />
              </a>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Etapa">
            <select className={inputCls} value={f.status} onChange={(e) => set("status", e.target.value as LeadStatus)}>
              {LEAD_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {LEAD_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Próximo seguimiento">
            <input type="date" className={inputCls} value={f.next_follow_up ?? ""} onChange={(e) => set("next_follow_up", e.target.value || null)} />
          </Field>
        </div>

        {f.status === "perdido" ? (
          <Field label="Motivo de pérdida">
            <input className={inputCls} value={f.lost_reason ?? ""} onChange={(e) => set("lost_reason", e.target.value || null)} />
          </Field>
        ) : null}

        <Field label="Cliente / empresa">
          <input className={inputCls} value={f.company_name ?? ""} onChange={(e) => set("company_name", e.target.value || null)} />
        </Field>
        <Field label="Contacto">
          <input className={inputCls} value={f.contact_name ?? ""} onChange={(e) => set("contact_name", e.target.value || null)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="WhatsApp">
            <input className={inputCls} value={f.whatsapp ?? ""} onChange={(e) => set("whatsapp", e.target.value || null)} />
          </Field>
          <Field label="Email">
            <input type="email" className={inputCls} value={f.email ?? ""} onChange={(e) => set("email", e.target.value || null)} />
          </Field>
        </div>
        <Field label="Descripción del proyecto">
          <textarea rows={3} className={inputCls} value={f.description ?? ""} onChange={(e) => set("description", e.target.value || null)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor estimado">
            <input
              type="number"
              step="0.01"
              className={inputCls}
              value={f.estimated_value ?? ""}
              onChange={(e) => set("estimated_value", e.target.value === "" ? null : Number(e.target.value))}
            />
          </Field>
          <Field label="Origen">
            <select className={inputCls} value={f.source ?? ""} onChange={(e) => set("source", e.target.value || null)}>
              <option value="">—</option>
              {LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {LEAD_SOURCE_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {/* Convertir a cotización */}
        <div className="rounded-xl border border-violet-100 bg-violet-50/40 p-3">
          {f.converted_quote_id || converted ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-violet-800">
                Cotización creada{converted ? ` · ${converted.quoteNumber}` : ""}
              </p>
              <Link
                href="/potenciales"
                className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-violet-700"
              >
                Ver en Cotizaciones <ArrowUpRight className="size-3.5" />
              </Link>
            </div>
          ) : (
            <>
              <p className="text-xs text-slate-600">¿Listo para cotizar? Crea la cotización con los datos del lead ya cargados.</p>
              <button
                type="button"
                onClick={convertir}
                disabled={converting}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
              >
                {converting ? <Loader2 className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
                Crear cotización
              </button>
            </>
          )}
        </div>

        {/* Bitácora de seguimiento */}
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">Bitácora de seguimiento</p>
          <div className="flex items-start gap-2">
            <textarea
              rows={2}
              className={inputCls}
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="¿Cómo vamos? (llamé, mandé propuesta, quedó de confirmar…)"
            />
            <button
              type="button"
              onClick={guardarNota}
              disabled={notaBusy || !nota.trim()}
              className="mt-0.5 shrink-0 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
            >
              {notaBusy ? <Loader2 className="size-3.5 animate-spin" /> : "Anotar"}
            </button>
          </div>
          <ul className="mt-2 space-y-1.5">
            {f.activity.length === 0 ? (
              <li className="text-[11px] text-slate-400">Sin interacciones registradas todavía.</li>
            ) : (
              f.activity.map((a, i) => (
                <li key={i} className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400">
                    <Clock className="size-3" /> {relFromNow(a.at)}
                  </div>
                  <p className="text-xs text-slate-700">{a.text}</p>
                </li>
              ))
            )}
          </ul>
        </div>

        {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}

        <div className="flex items-center justify-between border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">
            Cerrar
          </button>
          <button
            type="button"
            onClick={eliminar}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
          >
            <Trash2 className="size-4" /> Eliminar
          </button>
        </div>
      </div>
    </Drawer>
  );
}
