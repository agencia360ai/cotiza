"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  AirVent,
  AlarmClock,
  AlertTriangle,
  Building2,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Droplets,
  Flag,
  ExternalLink,
  Fan,
  FileText,
  FolderOpen,
  Landmark,
  Loader2,
  Mail,
  Phone,
  RefreshCw,
  Search,
  Snowflake,
  Sparkles,
  Target,
  User,
  Wind,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney, formatMoneyExact } from "@/lib/pipeline/types";
import { norm } from "@/lib/clients/normalize";
import { tamizScore, BANDA_META, BANDAS_ORDEN, type TamizBanda, type TamizResult } from "@/lib/panamacompra/tamiz";
import { SortTh, toggleSort, compareVals, type SortState } from "@/components/ui/sortable";
import {
  listGovTenders,
  refreshGovTenders,
  followGovTender,
  enrichGovTender,
  createGovTenderFolder,
  listGovTenderDocs,
  uploadGovTenderDocToDropbox,
  analyzeGovTenderDocs,
  analyzeSubmissionDocs,
  resolveSubmissionDoc,
  saveSubmissionPlan,
  type GovTenderRow,
} from "./gov-actions";
import type { SubmissionDoc } from "@/lib/panamacompra/submit-docs";

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
const TIPO_SHORT: Record<string, string> = {
  licitacion_publica: "LP",
  compra_menor_50k: "CM 10–50k",
  compra_menor_10k: "CM ≤10k",
  programada: "Prog.",
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

// Días desde que ENTRÓ a la lista (created_at). Nueva = agregada en las últimas
// 48 h, para distinguir lo que acaba de aparecer de lo arrastrado.
function diasDesdeAgregada(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - +new Date(iso)) / 86400000);
}
const FECHA_AGREGADA = new Intl.DateTimeFormat("es-PA", { day: "numeric", month: "short" });

function estaAbierta(r: GovTenderRow): boolean {
  return !r.fecha_cierre || +new Date(r.fecha_cierre) >= Date.now();
}

// Ordenamiento por columnas. El score no vive en la fila (lo calcula el tamiz),
// así que se pasa aparte. Las cerradas se mantienen siempre al final vía `rank`.
type GovSortKey = "score" | "titulo" | "tipo" | "cierre" | "precio";
const TIPO_ORDEN: Record<string, number> = { licitacion_publica: 0, compra_menor_50k: 1, compra_menor_10k: 2, programada: 3 };

function govSortValue(r: GovTenderRow, key: GovSortKey, score: number): string | number | null {
  switch (key) {
    case "score":
      return score;
    case "titulo":
      return r.titulo;
    case "tipo":
      return r.tipo ? (TIPO_ORDEN[r.tipo] ?? 9) : null;
    case "cierre":
      return r.fecha_cierre ? +new Date(r.fecha_cierre) : null;
    case "precio":
      return r.precio_ref;
  }
}

const FECHA_DIA = new Intl.DateTimeFormat("es-PA", { weekday: "short", day: "numeric", month: "short" });
const FECHA_HORA = new Intl.DateTimeFormat("es-PA", { hour: "numeric", minute: "2-digit", hour12: true });

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

// Paso del proceso: círculo con número o check.
type PartPaso = "carpeta" | "docs" | "checklist" | "migrar" | "listo";
type ParticiparProgress = { paso: PartPaso; sub: string; pct: number; error: string | null; corriendo: boolean };

const PART_PASOS: { key: PartPaso; label: string; hint: string }[] = [
  { key: "carpeta", label: "Carpeta en Dropbox", hint: "Crea la carpeta de la licitación (si no existe)." },
  { key: "docs", label: "Documentos del pliego", hint: "Baja los archivos del pliego y los analiza con IA." },
  { key: "checklist", label: "Checklist de documentos a someter", hint: "Arma la lista y copia lo reutilizable de licitaciones pasadas." },
  { key: "migrar", label: "En Mis Licitaciones", hint: "La mueve a Mis Licitaciones para el seguimiento." },
];

function StepDot({ done, n }: { done: boolean; n: number }) {
  return (
    <span
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
        done ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-500",
      )}
    >
      {done ? <Check className="size-3.5" /> : n}
    </span>
  );
}

// Flujo UNIFICADO "Participar": un botón que corre los 4 pasos (carpeta → bajar
// + analizar documentos → checklist de documentos a someter → migrar a Mis
// Licitaciones), con checkmarks por paso y % en vivo. Es reanudable: cada paso
// persiste en la base, así que si se interrumpe, volver a tocar continúa donde
// quedó (los pasos ya hechos salen con check).
function ParticiparUnificado({
  r,
  prog,
  onParticipar,
  onVerMisLicitaciones,
}: {
  r: GovTenderRow;
  prog: ParticiparProgress | undefined;
  onParticipar: () => void;
  onVerMisLicitaciones: () => void;
}) {
  // Estado de cada paso derivado de la data persistida (fuente de verdad).
  const done: Record<PartPaso, boolean> = {
    carpeta: !!r.dropbox_folder_path,
    docs: !!r.doc_analisis,
    checklist: !!r.docs_someter,
    migrar: !!r.converted_tender_id,
    listo: !!r.converted_tender_id,
  };
  const hechos = PART_PASOS.filter((p) => done[p.key]).length;
  const todoListo = hechos === PART_PASOS.length;
  const corriendo = !!prog?.corriendo;
  // % en vivo mientras corre; si no, el derivado de los pasos completados.
  const pct = corriendo ? prog!.pct : Math.round((hechos / PART_PASOS.length) * 100);
  const empezado = hechos > 0;

  return (
    <div className={cn("rounded-xl border p-3.5", todoListo ? "border-emerald-200 bg-emerald-50/40" : "border-slate-100 bg-white")}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Participar en la licitación</p>
        <span className="text-[11px] font-semibold tabular-nums text-slate-500">{pct}%</span>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={cn("h-full rounded-full transition-all duration-500", todoListo ? "bg-emerald-500" : "bg-indigo-500")} style={{ width: `${pct}%` }} />
      </div>

      <ol className="mt-3 space-y-2">
        {PART_PASOS.map((p, i) => {
          const activo = corriendo && prog!.paso === p.key;
          return (
            <li key={p.key} className="flex items-center gap-2.5">
              {activo ? (
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-indigo-100">
                  <Loader2 className="size-3.5 animate-spin text-indigo-600" />
                </span>
              ) : (
                <StepDot done={done[p.key]} n={i + 1} />
              )}
              <div className="min-w-0 flex-1">
                <p className={cn("text-xs font-semibold", done[p.key] ? "text-slate-800" : "text-slate-600")}>{p.label}</p>
                <p className="text-[11px] text-slate-500">{activo && prog!.sub ? prog!.sub : p.hint}</p>
              </div>
              {p.key === "carpeta" && r.dropbox_folder_url ? (
                <a
                  href={r.dropbox_folder_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-700 ring-1 ring-inset ring-sky-600/20 hover:bg-sky-100"
                >
                  <FolderOpen className="size-3" /> Abrir
                </a>
              ) : null}
            </li>
          );
        })}
      </ol>

      {prog?.error ? (
        <p className="mt-2.5 flex items-start gap-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700 ring-1 ring-inset ring-red-600/20">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {prog.error}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* Reanudar/Participar mientras falte algún paso. */}
        {!todoListo ? (
          <button
            type="button"
            onClick={onParticipar}
            disabled={corriendo}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-60"
          >
            {corriendo ? <Loader2 className="size-3.5 animate-spin" /> : <Flag className="size-3.5" />}
            {corriendo ? "Participando…" : empezado ? "Reanudar" : "Participar"}
          </button>
        ) : null}
        {/* Ver en Mis Licitaciones en cuanto ya migró (aunque falten documentos). */}
        {done.migrar ? (
          <button
            type="button"
            onClick={onVerMisLicitaciones}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            Ver en Mis Licitaciones <ArrowRight className="size-3.5" />
          </button>
        ) : null}
        {!empezado && !corriendo ? (
          <span className="text-[11px] text-slate-400">Carpeta · documentos · checklist · Mis Licitaciones — en un solo paso.</span>
        ) : null}
      </div>
    </div>
  );
}

function DetallePliego({
  r,
  busy,
  onCargar,
  prog,
  onParticipar,
  onVerMisLicitaciones,
}: {
  r: GovTenderRow;
  busy: boolean;
  onCargar: () => void;
  prog: ParticiparProgress | undefined;
  onParticipar: () => void;
  onVerMisLicitaciones: () => void;
}) {
  const d = r.detalle;
  // Título COMPLETO al expandir (en la fila va recortado a 2 líneas).
  const encabezado = (
    <div className="rounded-xl border border-slate-100 bg-white p-3.5">
      <p className="text-sm font-semibold leading-snug text-slate-900">{r.titulo ?? "—"}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
        <span className="tabular-nums">{r.num_proceso}</span>
        {r.entidad ? <span>· {r.entidad}</span> : null}
        {r.created_at ? <span>· agregada {FECHA_AGREGADA.format(new Date(r.created_at))}</span> : null}
      </div>
    </div>
  );
  const proceso = (
    <ParticiparUnificado r={r} prog={prog} onParticipar={onParticipar} onVerMisLicitaciones={onVerMisLicitaciones} />
  );
  if (!d) {
    return (
      <div className="space-y-3">
        {proceso}
        <div className="rounded-xl border border-slate-100 bg-white p-3.5">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Detalle del pliego · ¿podemos licitar?</p>
          <p className="mt-2 text-xs text-slate-500">
            Trae del pliego los renglones que hay que suministrar, el contacto de la unidad de compra y la forma de pago/entrega
            — lo que necesitas para decidir si participar y armar el precio.
          </p>
          <button
            type="button"
            onClick={onCargar}
            disabled={busy}
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
            {busy ? "Trayendo del pliego…" : "Cargar detalle del pliego"}
          </button>
        </div>
      </div>
    );
  }
  const cont = d.contacto;
  const hayContacto = cont.nombre || cont.correo || cont.telefono || cont.cargo;
  const ent = d.entidad;
  const hayEntidad = ent.dependencia || ent.unidadCompra || ent.provincia || ent.direccion;
  return (
    <div className="space-y-3">
      {encabezado}
      {proceso}
      <div className="space-y-3 rounded-xl border border-slate-100 bg-white p-3.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Detalle del pliego</p>
        <button
          type="button"
          onClick={onCargar}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-500 transition-colors hover:bg-slate-100 disabled:opacity-50"
          title="Volver a traer del pliego"
        >
          {busy ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
          Refrescar
        </button>
      </div>

      {(d.objeto || d.formaPago || d.formaEntrega) ? (
        <div className="grid gap-2 sm:grid-cols-3">
          {d.objeto ? <Campo label="Objeto">{d.objeto}</Campo> : null}
          {d.formaPago ? <Campo label="Forma de pago">{d.formaPago}</Campo> : null}
          {d.formaEntrega ? <Campo label="Forma de entrega">{d.formaEntrega}</Campo> : null}
        </div>
      ) : null}

      {hayContacto ? (
        <div className="rounded-lg bg-slate-50 p-2.5">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Contacto de la unidad de compra</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-700">
            {cont.nombre ? (
              <span className="inline-flex items-center gap-1 font-medium">
                <User className="size-3.5 text-slate-400" /> {cont.nombre}
                {cont.cargo ? <span className="font-normal text-slate-400">· {cont.cargo}</span> : null}
              </span>
            ) : null}
            {cont.telefono ? (
              <a href={`tel:${cont.telefono}`} className="inline-flex items-center gap-1 hover:text-slate-900">
                <Phone className="size-3.5 text-slate-400" /> {cont.telefono}
              </a>
            ) : null}
            {cont.correo ? (
              <a href={`mailto:${cont.correo}`} className="inline-flex items-center gap-1 hover:text-slate-900">
                <Mail className="size-3.5 text-slate-400" /> {cont.correo}
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      {hayEntidad ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {ent.dependencia ? <Campo label="Dependencia">{ent.dependencia}</Campo> : null}
          {ent.unidadCompra ? <Campo label="Unidad de compra">{ent.unidadCompra}</Campo> : null}
          {ent.provincia ? <Campo label="Provincia">{ent.provincia}</Campo> : null}
          {ent.direccion ? <Campo label="Dirección">{ent.direccion}</Campo> : null}
        </div>
      ) : null}

      {d.items.length > 0 ? (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Renglones a suministrar · {d.items.length}
          </p>
          <div className="overflow-x-auto rounded-lg ring-1 ring-slate-100">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-400">
                  <th className="px-2 py-1.5 font-semibold">Descripción</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Cant.</th>
                  <th className="px-2 py-1.5 font-semibold">Unidad</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Precio ref.</th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((it, i) => (
                  <tr key={i} className="border-b border-slate-50 last:border-0">
                    <td className="px-2 py-1.5 text-slate-700">{it.descripcion}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{it.cantidad ?? "—"}</td>
                    <td className="px-2 py-1.5 text-slate-500">{it.unidad ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">
                      {it.precioRef !== null ? formatMoneyExact(it.precioRef) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="text-[11px] italic text-slate-400">El pliego no trajo renglones detallados.</p>
      )}
      </div>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-xs text-slate-700">{children}</p>
    </div>
  );
}

function TenderTr({
  r,
  tamiz,
  sweet,
  expanded,
  enrichBusy,
  prog,
  onParticipar,
  onToggleExpand,
  onEnrich,
  onVerMisLicitaciones,
}: {
  r: GovTenderRow;
  tamiz: TamizResult;
  sweet: boolean;
  expanded: boolean;
  enrichBusy: boolean;
  prog: ParticiparProgress | undefined;
  onParticipar: () => void;
  onToggleExpand: () => void;
  onEnrich: () => void;
  onVerMisLicitaciones: () => void;
}) {
  const dias = diasParaCierre(r.fecha_cierre);
  const diasAgregada = diasDesdeAgregada(r.created_at);
  const esNueva = diasAgregada !== null && diasAgregada <= 2;
  // "Cerrada" por hora exacta (no por día redondeado): una que cerró hace 3h
  // tiene dias=0 pero ya NO está abierta — no debe decir "cierra hoy".
  const cerrada = !estaAbierta(r) && !!r.fecha_cierre;
  const urgente = !cerrada && r.relevante === true && dias !== null && dias < 5;
  const siguiendo = !!r.converted_tender_id;
  const cat = categoriaVisual(r);
  const CatIcon = cat.icon;
  const banda = BANDA_META[tamiz.banda];
  return (
    <Fragment>
      <tr
        className={cn(
          "border-b border-slate-50 transition-colors",
          // Participando: tinte verde + borde izquierdo, denota que ya es de Mis Licitaciones.
          siguiendo
            ? "bg-emerald-50/40 shadow-[inset_3px_0_0_0_#10B981] hover:bg-emerald-50/70"
            : urgente
              ? "bg-red-50/40 hover:bg-red-50/70"
              : "hover:bg-slate-50/60",
          cerrada && "opacity-60",
          expanded && "!border-b-0",
        )}
      >
        <td className="py-3 pl-3 pr-1 align-top">
          <span className={cn("flex size-8 items-center justify-center rounded-lg", cat.cls)} title={cat.label}>
            <CatIcon className="size-4" />
          </span>
        </td>
        <td className="px-2 py-3 align-top">
          <button type="button" onClick={onToggleExpand} className="text-left" title={`${banda.label} — click para ver el detalle`}>
            <span className="flex items-center gap-1">
              <span className={cn("text-lg font-bold leading-none tabular-nums", banda.texto)}>{tamiz.score}</span>
            </span>
            <span className={cn("mt-1 inline-block whitespace-nowrap rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide", banda.chip)}>
              {banda.corto}
            </span>
          </button>
        </td>
        <td className="cursor-pointer px-2 py-3 align-top" onClick={onToggleExpand}>
          <div className="min-w-[240px] max-w-xl">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold tabular-nums text-slate-500">{r.num_proceso}</span>
              {esNueva ? (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-blue-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white" title={`Agregada ${r.created_at ? FECHA_AGREGADA.format(new Date(r.created_at)) : ""}`}>
                  <Sparkles className="size-2.5" /> Nueva
                </span>
              ) : null}
              {siguiendo ? (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700" title="Ya está en Mis Licitaciones">
                  <CheckCircle2 className="size-2.5" /> En Mis Licit.
                </span>
              ) : null}
              <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-600/20 md:hidden">
                {(r.tipo && TIPO_SHORT[r.tipo]) ?? r.tipo ?? "—"}
              </span>
              {r.relevante === true && r.relevancia_motivo ? (
                <span className="max-w-52 truncate rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                  {r.relevancia_motivo}
                </span>
              ) : null}
              {r.relevante === false && r.relevancia_motivo ? (
                <span className="hidden max-w-52 truncate rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 lg:inline-block">
                  {r.relevancia_motivo}
                </span>
              ) : null}
              {r.relevante === null ? (
                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">sin clasificar</span>
              ) : null}
            </div>
            <p className="mt-1 text-sm font-medium leading-snug text-slate-900 line-clamp-2">{r.titulo ?? "—"}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
              <span className="truncate">{r.entidad ?? "—"}</span>
              {r.created_at ? (
                <span className="shrink-0 whitespace-nowrap text-[10px] text-slate-400">
                  · agregada {diasAgregada === 0 ? "hoy" : diasAgregada === 1 ? "ayer" : FECHA_AGREGADA.format(new Date(r.created_at))}
                </span>
              ) : null}
            </p>
          </div>
        </td>
        <td className="hidden px-2 py-3 align-top md:table-cell">
          {r.tipo ? (
            <span className="whitespace-nowrap rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-600/20">
              {TIPO_LABEL[r.tipo] ?? r.tipo}
            </span>
          ) : (
            <span className="text-xs text-slate-300">—</span>
          )}
        </td>
        <td className="px-2 py-3 align-top">
          {r.fecha_cierre ? (
            <div className="whitespace-nowrap">
              <p className="text-xs font-semibold text-slate-800">{FECHA_DIA.format(new Date(r.fecha_cierre))}</p>
              <p className="text-[11px] text-slate-500">{FECHA_HORA.format(new Date(r.fecha_cierre))}</p>
              {dias !== null ? (
                <span
                  className={cn(
                    "mt-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset",
                    cerrada
                      ? "bg-slate-100 text-slate-400 ring-slate-200"
                      : dias <= 2
                        ? "bg-red-50 text-red-700 ring-red-600/20"
                        : dias < 5
                          ? "bg-amber-50 text-amber-700 ring-amber-600/20"
                          : "bg-slate-100 text-slate-500 ring-slate-200",
                  )}
                >
                  {cerrada ? "cerrada" : dias === 0 ? "cierra hoy" : `en ${dias} d`}
                </span>
              ) : null}
            </div>
          ) : (
            <span className="text-xs text-slate-300">—</span>
          )}
        </td>
        <td className="px-2 py-3 text-right align-top">
          {r.precio_ref !== null ? (
            <div className="whitespace-nowrap">
              <p className={cn("text-sm font-bold tabular-nums", sweet ? "text-amber-600" : "text-slate-900")}>
                {formatMoneyExact(r.precio_ref)}
              </p>
              {sweet ? (
                <span className="mt-0.5 inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20">
                  <Target className="size-3" /> sweet spot
                </span>
              ) : null}
            </div>
          ) : r.tipo && TIPO_RANGO[r.tipo] ? (
            <p className="whitespace-nowrap text-xs tabular-nums text-slate-500">{TIPO_RANGO[r.tipo]}</p>
          ) : (
            <span className="text-xs text-slate-300">—</span>
          )}
        </td>
        <td className="py-3 pl-2 pr-3 text-right align-top">
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={onToggleExpand}
              className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              title={expanded ? "Cerrar detalle" : "Ver detalle (desglose + ¿cumplimos?)"}
              aria-expanded={expanded}
            >
              <ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} />
            </button>
            {r.url ? (
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                title="Ver en PanamaCompra"
              >
                <ExternalLink className="size-4" />
              </a>
            ) : null}
          </div>
        </td>
      </tr>

      {expanded ? (
        <tr className={cn("border-b border-slate-100", urgente ? "bg-red-50/30" : "bg-slate-50/50")}>
          <td colSpan={7} className="px-4 pb-4 pt-2">
            {/* Flujo unificado Participar + detalle del pliego. */}
            <DetallePliego
              r={r}
              busy={enrichBusy}
              onCargar={onEnrich}
              prog={prog}
              onParticipar={onParticipar}
              onVerMisLicitaciones={onVerMisLicitaciones}
            />
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

export function GovTendersBoard({
  onFollowed,
  onStats,
  onParticipated,
}: {
  onFollowed?: () => void;
  onStats?: (relevantesAbiertas: number) => void;
  onParticipated?: () => void; // migró a Mis Licitaciones → cambiar de sub-tab
}) {
  const [rows, setRows] = useState<GovTenderRow[]>([]);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState<false | "inc" | "full">(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [soloRelevantes, setSoloRelevantes] = useState(true);
  const [tipoFiltro, setTipoFiltro] = useState<string>("all");
  const [bandaFiltro, setBandaFiltro] = useState<"all" | TamizBanda>("all");
  const [sort, setSort] = useState<SortState<GovSortKey>>({ key: "score", dir: "desc" });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [enrichBusy, setEnrichBusy] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  // Progreso del flujo unificado "Participar" por licitación (reanudable).
  const [partProg, setPartProg] = useState<Map<string, ParticiparProgress>>(new Map());
  // Progreso del escaneo (loop reanudable): pct 0-100 + mensaje de corrida.
  const [scanPct, setScanPct] = useState<number | null>(null);
  const [scanMsg, setScanMsg] = useState<string>("");

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

  // Tamiz DICEC: score por fila (técnico 0.7 + económico 0.3, bandas P1→Desc).
  const tamizDe = useMemo(() => {
    const m = new Map<string, TamizResult>();
    for (const r of rows) m.set(r.id, tamizScore(r.titulo, r.precio_ref, { min: ssMin, max: ssMax }));
    return m;
  }, [rows, ssMin, ssMax]);

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

  // Escaneo con LOOP automático: repite el escaneo completo (paginación
  // reanudable por cursor) hasta agotar todas las páginas — así "lo hace todo"
  // aunque tome varias corridas, sin el viejo aviso de "corre otra vez". La
  // barra de progreso avanza a medida que cada tipo de proceso se completa.
  const TIPOS_TOTAL = 4;
  async function refresh() {
    setRefreshing("full");
    setError(null);
    setLastRefresh(null);
    setScanPct(2);
    setScanMsg("Escaneando PanamaCompra…");
    let ultima: Awaited<ReturnType<typeof refreshGovTenders>> | null = null;
    let cortada = false;
    try {
      for (let pasada = 1; pasada <= 8; pasada++) {
        const r = await refreshGovTenders(true);
        ultima = r;
        if ("error" in r) {
          setError(r.error);
          break;
        }
        const listos = TIPOS_TOTAL - r.data.truncados.length;
        setScanPct(Math.max(5, Math.round((listos / TIPOS_TOTAL) * 100)));
        setScanMsg(
          `Corrida ${pasada} · ${r.data.relevantes} relevantes${r.data.conPrecio > 0 ? ` · ${r.data.conPrecio} montos` : ""}` +
            (r.data.truncados.length > 0 ? ` · siguiendo con ${r.data.truncados.map((k) => TIPO_SHORT[k] ?? k).join(", ")}…` : " · completo"),
        );
        await load();
        if (r.data.truncados.length === 0) {
          setScanPct(100);
          break;
        }
      }
    } catch (e) {
      // "An unexpected response…" = Vercel cortó la función; lo bajado quedó
      // guardado. El loop continúa donde quedó al reintentar.
      cortada = e instanceof Error && /unexpected response/i.test(e.message);
      setError(
        cortada
          ? "Una corrida tardó más de lo permitido; lo que alcanzó a traer ya quedó guardado. Vuelve a tocar Actualizar para seguir."
          : e instanceof Error
            ? e.message
            : "Se cortó la actualización — reintenta",
      );
      await load().catch(() => {});
    } finally {
      if (ultima && "data" in ultima && !cortada) {
        const d = ultima.data;
        setLastRefresh(
          `${d.nuevos} nuevos · ${d.relevantes} relevantes clasificados` +
            (d.conPrecio > 0 ? ` · ${d.conPrecio} montos traídos` : "") +
            (d.truncados.length === 0 ? " · escaneo completo ✓" : ""),
        );
      }
      setRefreshing(false);
      // Dejar la barra llena un momento antes de esconderla.
      window.setTimeout(() => setScanPct(null), 1600);
    }
  }

  // Flujo UNIFICADO "Participar": un botón que orquesta carpeta → bajar +
  // analizar documentos → checklist de documentos a someter → migrar a Mis
  // Licitaciones. Cada paso persiste en la base, así que si se interrumpe,
  // volver a tocar Participar CONTINÚA donde quedó (salta lo ya hecho).
  async function participarUnificado(id: string) {
    const setP = (patch: Partial<ParticiparProgress>) =>
      setPartProg((prev) => {
        const m = new Map(prev);
        const base = m.get(id) ?? { paso: "carpeta" as PartPaso, sub: "", pct: 0, error: null, corriendo: false };
        m.set(id, { ...base, ...patch });
        return m;
      });
    // Snapshot inicial para decidir qué saltar (reanudar).
    const ini = rows.find((r) => r.id === id);
    let folderPath = ini?.dropbox_folder_path ?? null;
    const yaAnalisis = !!ini?.doc_analisis;
    const yaChecklist = !!ini?.docs_someter;
    const yaMigrado = !!ini?.converted_tender_id;
    setP({ corriendo: true, error: null, paso: "carpeta", sub: "", pct: 3 });
    const msg = (e: unknown) => (e instanceof Error ? e.message : "error");
    // Los documentos y el checklist son BEST-EFFORT: el gobierno a veces no
    // sirve bien los archivos. Un fallo ahí NO bloquea participar (el objetivo)
    // — se anota como aviso suave y se puede reintentar con "Reanudar".
    let softError: string | null = null;
    try {
      // 1) Carpeta en Dropbox (si no existe). Este paso SÍ es requisito.
      if (!folderPath) {
        setP({ paso: "carpeta", sub: "creando carpeta…", pct: 6 });
        const r = await createGovTenderFolder(id);
        if ("error" in r) throw new Error(r.error);
        folderPath = r.data.path;
        setRows((prev) => prev.map((x) => (x.id === id ? { ...x, dropbox_folder_path: r.data.path, dropbox_folder_url: r.data.url } : x)));
      }

      // 2) Documentos del pliego: bajar los que falten + analizar con IA.
      if (!yaAnalisis) {
        try {
          setP({ paso: "docs", sub: "leyendo el pliego…", pct: 12 });
          const docsRes = await listGovTenderDocs(id);
          if ("error" in docsRes) throw new Error(docsRes.error);
          setRows((prev) =>
            prev.map((x) => (x.id === id ? { ...x, dropbox_folder_path: docsRes.data.folderPath, dropbox_folder_url: docsRes.data.folderUrl } : x)),
          );
          const pend = docsRes.data.docs.filter((d) => !d.existe);
          for (let i = 0; i < pend.length; i++) {
            setP({ paso: "docs", sub: `bajando documentos ${i + 1}/${pend.length}`, pct: 12 + Math.round(((i + 1) / Math.max(1, pend.length)) * 26) });
            await uploadGovTenderDocToDropbox(id, pend[i].nombre, pend[i].url).catch(() => null);
          }
          setP({ paso: "docs", sub: "analizando requisitos con IA…", pct: 44 });
          const an = await analyzeGovTenderDocs(id);
          if ("error" in an) throw new Error(an.error);
          setRows((prev) => prev.map((x) => (x.id === id ? { ...x, doc_analisis: an.data.analisis } : x)));
        } catch (e) {
          softError = `Documentos: ${msg(e)} — reintenta con Reanudar.`;
        }
      }

      // 3) Checklist de documentos a someter (busca/copia reutilizables).
      if (!yaChecklist && !softError) {
        try {
          setP({ paso: "checklist", sub: "extrayendo documentos a someter…", pct: 56 });
          const plan = await analyzeSubmissionDocs(id);
          if ("error" in plan) throw new Error(plan.error);
          const resueltos: SubmissionDoc[] = [];
          for (let i = 0; i < plan.data.documentos.length; i++) {
            setP({
              paso: "checklist",
              sub: `buscando en licitaciones pasadas ${i + 1}/${plan.data.documentos.length}`,
              pct: 58 + Math.round(((i + 1) / Math.max(1, plan.data.documentos.length)) * 22),
            });
            const rr = await resolveSubmissionDoc(id, plan.data.documentos[i]);
            resueltos.push("error" in rr ? plan.data.documentos[i] : rr.data);
          }
          const saved = await saveSubmissionPlan(id, plan.data.resumen, resueltos);
          if ("error" in saved) throw new Error(saved.error);
          setRows((prev) => prev.map((x) => (x.id === id ? { ...x, docs_someter: saved.data.plan } : x)));
        } catch (e) {
          softError = `Checklist: ${msg(e)} — reintenta con Reanudar.`;
        }
      }

      // 4) Migrar a Mis Licitaciones (crea el tender del pipeline propio).
      // SIEMPRE se intenta: es el objetivo de "Participar" y no depende de los
      // documentos (que son valor agregado).
      if (!yaMigrado) {
        setP({ paso: "migrar", sub: "moviendo a Mis Licitaciones…", pct: 88 });
        const f = await followGovTender(id);
        if ("error" in f) throw new Error(f.error);
        setRows((prev) => prev.map((x) => (x.id === id ? { ...x, converted_tender_id: f.data.tenderId } : x)));
        onFollowed?.();
      }
      setP({ paso: "listo", sub: "", pct: 100, corriendo: false, error: softError });
    } catch (e) {
      setP({
        corriendo: false,
        error: e instanceof Error ? e.message : "Se interrumpió — vuelve a tocar Participar para continuar donde quedó.",
      });
    }
  }

  async function enrich(id: string) {
    setEnrichBusy(id);
    try {
      const r = await enrichGovTender(id);
      if ("error" in r) {
        setError(r.error);
        return;
      }
      setError(null);
      setRows((prev) => prev.map((x) => (x.id === id ? { ...x, detalle: r.data.detalle } : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Se cortó la carga del pliego — reintenta");
    } finally {
      setEnrichBusy(null);
    }
  }



  // ¿Ya se actualizó HOY (hora Panamá)? Si sí, el botón queda discreto; si no,
  // resalta — el sync corre solo a diario y este botón es el respaldo manual.
  const hoyPa = new Date().toLocaleDateString("en-CA", { timeZone: "America/Panama" });
  const actualizadoHoy =
    syncedAt !== null && new Date(syncedAt).toLocaleDateString("en-CA", { timeZone: "America/Panama" }) === hoyPa;

  // Resumen global (sobre todo lo abierto y relevante, sin filtros de vista).
  const stats = useMemo(() => {
    let urgentes = 0;
    let sweet = 0;
    let sweetSum = 0;
    let relevantes = 0;
    let p1p2 = 0;
    for (const r of rows) {
      if (r.relevante !== true || !estaAbierta(r)) continue;
      relevantes++;
      const d = diasParaCierre(r.fecha_cierre);
      if (d !== null && d >= 0 && d < 5) urgentes++;
      if (inSweet(r.precio_ref)) {
        sweet++;
        sweetSum += r.precio_ref ?? 0;
      }
      const b = tamizDe.get(r.id)?.banda;
      if (b === "p1" || b === "p2") p1p2++;
    }
    return { urgentes, sweet, sweetSum, relevantes, p1p2 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, ssMin, ssMax, tamizDe]);

  // Alcance actual (Relevantes = solo abiertas): base para conteos de chips.
  const scopeRows = useMemo(
    () => rows.filter((r) => !soloRelevantes || (r.relevante === true && estaAbierta(r))),
    [rows, soloRelevantes],
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = scopeRows.filter((r) => {
      if (tipoFiltro !== "all" && r.tipo !== tipoFiltro) return false;
      if (bandaFiltro !== "all" && tamizDe.get(r.id)?.banda !== bandaFiltro) return false;
      if (soloSweet && !inSweet(r.precio_ref)) return false;
      if (needle && !`${r.num_proceso} ${r.titulo ?? ""} ${r.entidad ?? ""}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    // Abiertas primero; cerradas al final. Dentro de cada grupo, por la columna
    // elegida (default: score desc). Desempate por cierre más próximo.
    const rank = (r: GovTenderRow) => (!r.fecha_cierre ? 1 : estaAbierta(r) ? 0 : 2);
    const scoreOf = (r: GovTenderRow) => tamizDe.get(r.id)?.score ?? 0;
    return list.sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      const cmp = compareVals(govSortValue(a, sort.key, scoreOf(a)), govSortValue(b, sort.key, scoreOf(b)), sort.dir);
      if (cmp !== 0) return cmp;
      const ta = a.fecha_cierre ? +new Date(a.fecha_cierre) : Infinity;
      const tb = b.fecha_cierre ? +new Date(b.fecha_cierre) : Infinity;
      return ta - tb;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeRows, q, tipoFiltro, bandaFiltro, soloSweet, ssMin, ssMax, sort, tamizDe]);

  return (
    <div className="space-y-4">
      {!loading && rows.length > 0 ? (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MiniKpi label="Prioridad 1 y 2" value={String(stats.p1p2)} sub="score ≥85 del tamiz" icon={Target} accent="#7C3AED" />
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
            icon={Snowflake}
            accent="#F59E0B"
          />
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
          {/* Un solo botón: escanea PanamaCompra en loop hasta completar. El
              sync corre automático a diario; este botón es el disparo manual —
              resalta cuando NO se actualizó hoy. */}
          <button
            type="button"
            onClick={() => refresh()}
            disabled={!!refreshing}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60",
              actualizadoHoy
                ? "border border-slate-200 text-slate-600 hover:bg-slate-50"
                : "bg-indigo-600 text-white shadow-sm hover:bg-indigo-700",
            )}
            title="Escanea PanamaCompra hasta traer todas las páginas. Corre solo a diario; este botón lo dispara a mano."
          >
            {refreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            {refreshing ? "Escaneando…" : actualizadoHoy ? "Actualizar" : "Actualizar ahora"}
          </button>
        </header>

        {scanPct !== null ? (
          <div className="border-b border-slate-100 px-4 py-2.5">
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className="font-semibold text-slate-600">{scanMsg}</span>
              <span className="tabular-nums text-slate-400">{scanPct}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-indigo-500 transition-all duration-500" style={{ width: `${scanPct}%` }} />
            </div>
          </div>
        ) : null}

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
            {[{ k: "all", label: "Todos los tipos" }, ...Object.entries(TIPO_LABEL).map(([k, label]) => ({ k, label }))].map((t) => {
              const n = t.k === "all" ? scopeRows.length : scopeRows.filter((r) => r.tipo === t.k).length;
              return (
                <button
                  key={t.k}
                  type="button"
                  onClick={() => setTipoFiltro(t.k)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                    tipoFiltro === t.k ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                  )}
                >
                  {t.label} <span className={cn("tabular-nums", tipoFiltro === t.k ? "text-white/70" : "text-slate-400")}>{n}</span>
                </button>
              );
            })}
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

          {/* Bandas del tamiz (el orden se controla desde los headers de la tabla) */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Tamiz</span>
            <button
              type="button"
              onClick={() => setBandaFiltro("all")}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-semibold transition-colors",
                bandaFiltro === "all" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
              )}
            >
              Todas las bandas
            </button>
            {BANDAS_ORDEN.map((b) => {
              const n = scopeRows.filter((r) => tamizDe.get(r.id)?.banda === b).length;
              const meta = BANDA_META[b];
              return (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBandaFiltro(bandaFiltro === b ? "all" : b)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-semibold transition-colors",
                    bandaFiltro === b ? meta.chip : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                  )}
                  title={meta.label}
                >
                  {meta.corto} <span className={cn("tabular-nums", bandaFiltro === b ? "opacity-70" : "text-slate-400")}>{n}</span>
                </button>
              );
            })}
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
                <div className="size-8 rounded-lg bg-slate-100" />
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
              onClick={() => refresh()}
              disabled={!!refreshing}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
            >
              {refreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Traer de PanamaCompra
            </button>
          </div>
        ) : (
          <>
            <p className="px-4 pb-1 text-xs text-slate-400">
              {shown.length} de {rows.length} procesos · ordena por cualquier columna (las cerradas quedan al final) · haz clic en
              una fila para ver el detalle del pliego
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                    <th className="w-12 py-2.5 pl-3 pr-1 font-semibold" aria-label="Rubro" />
                    <SortTh label="Score" k="score" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k, "desc"))} className="w-16 px-2" />
                    <SortTh label="Proceso" k="titulo" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} className="px-2" />
                    <SortTh label="Tipo" k="tipo" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} className="hidden px-2 md:table-cell" />
                    <SortTh label="Presentar antes" k="cierre" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} className="px-2" />
                    <SortTh
                      label="Precio ref."
                      k="precio"
                      sort={sort}
                      onSort={(k) => setSort((s) => toggleSort(s, k, "desc"))}
                      align="right"
                      className="px-2 text-right"
                    />
                    <th className="w-32 py-2.5 pl-2 pr-3 font-semibold" aria-label="Acciones" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <TenderTr
                      key={r.id}
                      r={r}
                      tamiz={tamizDe.get(r.id) ?? tamizScore(r.titulo, r.precio_ref, { min: ssMin, max: ssMax })}
                      sweet={inSweet(r.precio_ref)}
                      expanded={expandedId === r.id}
                      enrichBusy={enrichBusy === r.id}
                      prog={partProg.get(r.id)}
                      onParticipar={() => participarUnificado(r.id)}
                      onToggleExpand={() => setExpandedId((prev) => (prev === r.id ? null : r.id))}
                      onEnrich={() => enrich(r.id)}
                      onVerMisLicitaciones={() => onParticipated?.()}
                    />
                  ))}
                  {shown.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">
                        Nada matchea ese filtro.
                        {soloRelevantes && rows.length > 0 && stats.relevantes === 0 ? (
                          <span className="mt-1 block text-xs">
                            Todavía no hay clasificadas — toca &ldquo;Actualizar&rdquo; para clasificar con IA, o mira &ldquo;Todas&rdquo;.
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
