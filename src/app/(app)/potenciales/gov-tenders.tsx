"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  AirVent,
  AlarmClock,
  AlertTriangle,
  Building2,
  Calculator,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Droplets,
  ExternalLink,
  Fan,
  FileText,
  Landmark,
  Loader2,
  Mail,
  Phone,
  Plus,
  RefreshCw,
  ScanSearch,
  Search,
  Snowflake,
  Sparkles,
  Target,
  User,
  Wind,
  XCircle,
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
  evaluateGovTender,
  enrichGovTender,
  type GovTenderRow,
} from "./gov-actions";

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

// Detalle del pliego (renglones + contacto + entidad) para evaluar si podemos
// licitar. Se muestra en procesos de alto puntaje; se carga bajo demanda.
function DetallePliego({ r, busy, onCargar }: { r: GovTenderRow; busy: boolean; onCargar: () => void }) {
  const d = r.detalle;
  if (!d) {
    return (
      <div className="rounded-xl border border-slate-100 bg-white p-3.5">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Detalle del pliego · ¿podemos licitar?</p>
        <p className="mt-2 text-xs text-slate-500">
          Trae del pliego los renglones que hay que suministrar, el contacto de la unidad de compra y la forma de pago/entrega
          — lo que necesitás para decidir si participar y armar el precio.
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
    );
  }
  const cont = d.contacto;
  const hayContacto = cont.nombre || cont.correo || cont.telefono || cont.cargo;
  const ent = d.entidad;
  const hayEntidad = ent.dependencia || ent.unidadCompra || ent.provincia || ent.direccion;
  return (
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

function CumpleBadge({ v }: { v: "si" | "parcial" | "no" }) {
  if (v === "si")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
        <CheckCircle2 className="size-3" /> Cumplimos
      </span>
    );
  if (v === "parcial")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-inset ring-amber-600/20">
        <AlertTriangle className="size-3" /> Parcial
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 ring-1 ring-inset ring-rose-600/20">
      <XCircle className="size-3" /> No cumplimos
    </span>
  );
}

function CumpleMini({ v }: { v: "si" | "parcial" | "no" }) {
  if (v === "si") return <CheckCircle2 className="size-3.5 text-emerald-500" aria-label="Cumplimos" />;
  if (v === "parcial") return <AlertTriangle className="size-3.5 text-amber-500" aria-label="Cumplimos parcialmente" />;
  return <XCircle className="size-3.5 text-rose-400" aria-label="No cumplimos" />;
}

function TenderTr({
  r,
  tamiz,
  sweet,
  busy,
  expanded,
  evalBusy,
  enrichBusy,
  onSeguir,
  onToggleExpand,
  onEvaluar,
  onEnrich,
}: {
  r: GovTenderRow;
  tamiz: TamizResult;
  sweet: boolean;
  busy: boolean;
  expanded: boolean;
  evalBusy: boolean;
  enrichBusy: boolean;
  onSeguir: () => void;
  onToggleExpand: () => void;
  onEvaluar: () => void;
  onEnrich: () => void;
}) {
  const dias = diasParaCierre(r.fecha_cierre);
  const cerrada = dias !== null && dias < 0;
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
          urgente ? "bg-red-50/40 hover:bg-red-50/70" : "hover:bg-slate-50/60",
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
          <button type="button" onClick={onToggleExpand} className="text-left" title={`${banda.label} — click para ver el desglose`}>
            <span className="flex items-center gap-1">
              <span className={cn("text-lg font-bold leading-none tabular-nums", banda.texto)}>{tamiz.score}</span>
              {r.eval ? <CumpleMini v={r.eval.cumplimos} /> : null}
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
            <p className="mt-0.5 truncate text-xs text-slate-500">{r.entidad ?? "—"}</p>
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
                className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                title="Ver en PanamaCompra"
              >
                <ExternalLink className="size-4" />
              </a>
            ) : null}
            {siguiendo ? (
              <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg bg-emerald-50 px-2 py-1.5 text-xs font-semibold text-emerald-700">
                <CheckCircle2 className="size-3.5" /> Siguiendo
              </span>
            ) : (
              <button
                type="button"
                onClick={onSeguir}
                disabled={busy}
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg bg-slate-900 px-2 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
                title="Copiarla a tus licitaciones (pipeline propio)"
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                Seguir
              </button>
            )}
          </div>
        </td>
      </tr>

      {expanded ? (
        <tr className={cn("border-b border-slate-100", urgente ? "bg-red-50/30" : "bg-slate-50/50")}>
          <td colSpan={7} className="px-4 pb-4 pt-1">
            <div className="grid gap-3 lg:grid-cols-2">
              {/* Desglose del tamiz */}
              <div className="rounded-xl border border-slate-100 bg-white p-3.5">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Desglose del tamiz</p>
                <div className="mt-2 space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-500">Técnico (peso 0.7)</span>
                    <span className="text-sm font-bold tabular-nums text-slate-900">{tamiz.tecnico}</span>
                  </div>
                  {tamiz.matches.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {tamiz.matches.map((m) => (
                        <span key={m} className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                          {m}
                        </span>
                      ))}
                      {tamiz.penalizado ? (
                        <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                          −30 obra civil / eléctrica
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-400">sin keywords del rubro en el título{tamiz.penalizado ? " · −30 obra civil/eléctrica" : ""}</p>
                  )}
                  <div className="flex items-center justify-between gap-2 border-t border-slate-50 pt-2">
                    <span className="text-xs text-slate-500">Económico (peso 0.3) · {tamiz.economicoLabel}</span>
                    <span className="text-sm font-bold tabular-nums text-slate-900">{tamiz.economico}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-slate-50 pt-2">
                    <span className="text-[11px] tabular-nums text-slate-400">
                      0.7 × {tamiz.tecnico} + 0.3 × {tamiz.economico}
                    </span>
                    <span className={cn("inline-flex items-center gap-1.5 text-sm font-bold tabular-nums", BANDA_META[tamiz.banda].texto)}>
                      {tamiz.score}
                      <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide", BANDA_META[tamiz.banda].chip)}>
                        {BANDA_META[tamiz.banda].label}
                      </span>
                    </span>
                  </div>
                </div>
              </div>

              {/* ¿Cumplimos? */}
              <div className="rounded-xl border border-slate-100 bg-white p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">¿Cumplimos?</p>
                  {r.eval ? <CumpleBadge v={r.eval.cumplimos} /> : null}
                </div>
                {r.eval ? (
                  <div className="mt-2 space-y-2 text-sm">
                    <p className="text-xs leading-relaxed text-slate-600">{r.eval.resumen}</p>
                    {r.eval.requisitos.length > 0 ? (
                      <ul className="space-y-1">
                        {r.eval.requisitos.map((req, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-xs text-slate-600">
                            <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-slate-300" />
                            {req}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {r.eval.riesgos.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {r.eval.riesgos.map((riesgo, i) => (
                          <span key={i} className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                            {riesgo}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2 border-t border-slate-50 pt-2">
                      {r.eval.cumplimos !== "no" ? (
                        <button
                          type="button"
                          disabled
                          className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-400"
                          title="Próximamente: estimación de precio DICEC a partir del pliego"
                        >
                          <Calculator className="size-3.5" /> Estimar precio · próximamente
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={onEvaluar}
                        disabled={evalBusy}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-violet-600 transition-colors hover:bg-violet-50 disabled:opacity-50"
                        title="Volver a evaluar con IA"
                      >
                        {evalBusy ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                        Re-evaluar
                      </button>
                      <span className="ml-auto text-[10px] text-slate-400">evaluado {relTime(+new Date(r.eval.at))}</span>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2">
                    <p className="text-xs text-slate-500">
                      La IA lee los renglones del pliego y evalúa si el alcance cae dentro del rubro DICEC — con requisitos clave y señales de riesgo.
                    </p>
                    <button
                      type="button"
                      onClick={onEvaluar}
                      disabled={evalBusy}
                      className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
                    >
                      {evalBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                      {evalBusy ? "Evaluando…" : "Evaluar si cumplimos (IA)"}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Detalle del pliego para procesos de alto puntaje (>60): lo que
                necesitás para decidir si licitar. */}
            {tamiz.score > 60 || r.detalle ? (
              <div className="mt-3">
                <DetallePliego r={r} busy={enrichBusy} onCargar={onEnrich} />
              </div>
            ) : null}
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

export function GovTendersBoard({ onFollowed, onStats }: { onFollowed?: () => void; onStats?: (relevantesAbiertas: number) => void }) {
  const [rows, setRows] = useState<GovTenderRow[]>([]);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState<false | "inc" | "full">(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [soloRelevantes, setSoloRelevantes] = useState(true);
  const [tipoFiltro, setTipoFiltro] = useState<string>("all");
  const [bandaFiltro, setBandaFiltro] = useState<"all" | TamizBanda>("all");
  const [sort, setSort] = useState<SortState<GovSortKey>>({ key: "score", dir: "desc" });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [evalBusy, setEvalBusy] = useState<string | null>(null);
  const [enrichBusy, setEnrichBusy] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [truncWarn, setTruncWarn] = useState<string | null>(null);

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

  async function refresh(full = false) {
    setRefreshing(full ? "full" : "inc");
    setError(null);
    setLastRefresh(null);
    setTruncWarn(null);
    const r = await refreshGovTenders(full);
    setRefreshing(false);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    const desglose = Object.entries(r.data.porTipo)
      .map(([k, n]) => `${TIPO_SHORT[k] ?? k} ${n}`)
      .join(" · ");
    setLastRefresh(
      `${r.data.total} procesos (${desglose}) · ${r.data.nuevos} nuevos · ${r.data.relevantes} relevantes clasificados` +
        (r.data.conPrecio > 0 ? ` · ${r.data.conPrecio} montos traídos` : "") +
        (r.data.pendientesPrecio > 0 ? ` · quedan ~${r.data.pendientesPrecio} sin monto (tocá Actualizar de nuevo)` : ""),
    );
    if (r.data.truncados.length > 0) {
      setTruncWarn(
        `Hay más páginas en PanamaCompra para: ${r.data.truncados.map((k) => TIPO_SHORT[k] ?? k).join(", ")}. ` +
          `Corré "Escaneo completo" otra vez para seguir trayendo.`,
      );
    }
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

  async function evaluar(id: string) {
    setEvalBusy(id);
    const r = await evaluateGovTender(id);
    setEvalBusy(null);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    setError(null);
    setRows((prev) => prev.map((x) => (x.id === id ? { ...x, eval: r.data.eval } : x)));
  }

  async function enrich(id: string) {
    setEnrichBusy(id);
    const r = await enrichGovTender(id);
    setEnrichBusy(null);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    setError(null);
    setRows((prev) => prev.map((x) => (x.id === id ? { ...x, detalle: r.data.detalle } : x)));
  }

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
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => refresh(true)}
              disabled={!!refreshing}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50 hover:text-slate-700 disabled:opacity-50"
              title="Recorre TODAS las páginas de PanamaCompra (tarda más). Usalo si sospechás que falta algo."
            >
              {refreshing === "full" ? <Loader2 className="size-3.5 animate-spin" /> : <ScanSearch className="size-3.5" />}
              Escaneo completo
            </button>
            <button
              type="button"
              onClick={() => refresh(false)}
              disabled={!!refreshing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
              title="Trae lo nuevo de PanamaCompra y guarda — abrir la página usa lo guardado"
            >
              {refreshing === "inc" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              {refreshing ? "Consultando…" : "Actualizar"}
            </button>
          </div>
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
          {truncWarn ? (
            <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 ring-1 ring-inset ring-amber-600/20">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {truncWarn}
            </p>
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
              onClick={() => refresh(false)}
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
              {shown.length} de {rows.length} procesos · ordená por cualquier columna (las cerradas quedan al final) · click en una
              fila para el desglose y evaluar si cumplimos
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
                      busy={busy === r.id}
                      expanded={expandedId === r.id}
                      evalBusy={evalBusy === r.id}
                      enrichBusy={enrichBusy === r.id}
                      onSeguir={() => seguir(r.id)}
                      onToggleExpand={() => setExpandedId((prev) => (prev === r.id ? null : r.id))}
                      onEvaluar={() => evaluar(r.id)}
                      onEnrich={() => enrich(r.id)}
                    />
                  ))}
                  {shown.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">
                        Nada matchea ese filtro.
                        {soloRelevantes && rows.length > 0 && stats.relevantes === 0 ? (
                          <span className="mt-1 block text-xs">
                            Todavía no hay clasificadas — tocá &ldquo;Actualizar&rdquo; para clasificar con IA, o mirá &ldquo;Todas&rdquo;.
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
