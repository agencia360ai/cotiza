"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  ChevronRight,
  ChevronDown,
  MapPin,
  FileText,
  DollarSign,
  Hammer,
  Wrench,
  Settings,
  ShoppingCart,
  FileSignature,
  Box,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CATEGORY_LABEL, imageUrl, type ClientCategory } from "@/lib/maintenance/types";
import { formatMoney } from "@/lib/pipeline/types";

export type ClientRel = "contratos" | "mantenimiento" | "servicio" | "ventas";

export type ClientCard = {
  id: string;
  name: string;
  category: ClientCategory | null;
  brand_color: string | null;
  logo_path: string | null;
  quotes: number;
  enviadas: number;
  enJuego: number;
  proyectos: number;
  proyectosActivos: number;
  mantenimientos: number;
  sucursales: number;
  equipos: number;
  rels: ClientRel[];
  lastActivity: string | null;
  activo: boolean;
};

const REL: Record<ClientRel, { label: string; Icon: typeof Wrench; chip: string }> = {
  contratos: { label: "Contratos", Icon: FileSignature, chip: "bg-indigo-50 text-indigo-700 ring-indigo-600/20" },
  mantenimiento: { label: "Mantenimiento", Icon: Wrench, chip: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  servicio: { label: "Servicio", Icon: Settings, chip: "bg-amber-50 text-amber-700 ring-amber-600/20" },
  ventas: { label: "Ventas", Icon: ShoppingCart, chip: "bg-violet-50 text-violet-700 ring-violet-600/20" },
};
const REL_ORDER: ClientRel[] = ["contratos", "mantenimiento", "servicio", "ventas"];

function initials(name: string): string {
  return name.split(/\s+/).map((s) => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

export function ClientsBoard({ clients }: { clients: ClientCard[] }) {
  const [rels, setRels] = useState<Set<ClientRel>>(new Set());
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"reciente" | "monto">("reciente");
  const [showHist, setShowHist] = useState(false);

  const relCounts = useMemo(() => {
    const m: Record<ClientRel, number> = { contratos: 0, mantenimiento: 0, servicio: 0, ventas: 0 };
    for (const c of clients) for (const r of c.rels) m[r] += 1;
    return m;
  }, [clients]);

  function toggleRel(r: ClientRel) {
    setRels((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });
  }

  const { activos, historico } = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const cmp = (a: ClientCard, b: ClientCard) => {
      if (sortBy === "monto" && a.enJuego !== b.enJuego) return b.enJuego - a.enJuego;
      const la = a.lastActivity ?? "";
      const lb = b.lastActivity ?? "";
      if (la !== lb) return lb.localeCompare(la);
      return a.name.localeCompare(b.name);
    };
    const pass = (c: ClientCard) => {
      if (needle && !c.name.toLowerCase().includes(needle)) return false;
      if (rels.size > 0 && !c.rels.some((r) => rels.has(r))) return false;
      return true;
    };
    const filtered = clients.filter(pass);
    return {
      activos: filtered.filter((c) => c.activo).sort(cmp),
      historico: filtered.filter((c) => !c.activo).sort(cmp),
    };
  }, [clients, query, rels, sortBy]);

  return (
    <div className="mt-6">
      {/* Filtros */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {REL_ORDER.map((r) => {
          const on = rels.has(r);
          const { label, Icon } = REL[r];
          return (
            <button
              key={r}
              type="button"
              onClick={() => toggleRel(r)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition-colors",
                on ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50",
              )}
            >
              <Icon className="size-3.5" />
              {label}
              <span className={cn("tabular-nums", on ? "text-white/70" : "text-slate-400")}>{relCounts[r]}</span>
            </button>
          );
        })}
        <div className="relative ml-auto min-w-[180px] flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar cliente…"
            className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-sm focus:border-slate-400 focus:outline-none"
          />
        </div>
        <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 text-xs font-semibold">
          {(["reciente", "monto"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSortBy(s)}
              className={cn("px-3 py-2 transition-colors", sortBy === s ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50")}
            >
              {s === "reciente" ? "Reciente" : "Monto"}
            </button>
          ))}
        </div>
      </div>

      {/* Activos */}
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-700">
        Activos <span className="tabular-nums text-slate-400">({activos.length})</span>
      </h2>
      {activos.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          Ningún cliente activo con estos filtros.
        </p>
      ) : (
        <ul className="space-y-2">
          {activos.map((c) => (
            <Row key={c.id} c={c} />
          ))}
        </ul>
      )}

      {/* Histórico */}
      {historico.length > 0 ? (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowHist((v) => !v)}
            className="flex w-full items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-700"
          >
            <ChevronDown className={cn("size-4 transition-transform", showHist && "rotate-180")} />
            Histórico — sin actividad reciente <span className="tabular-nums text-slate-400">({historico.length})</span>
          </button>
          {showHist ? (
            <ul className="mt-3 space-y-2">
              {historico.map((c) => (
                <Row key={c.id} c={c} muted />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Metric({ Icon, children, title }: { Icon: typeof Wrench; children: React.ReactNode; title: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-slate-500" title={title}>
      <Icon className="size-3.5 text-slate-400" />
      <span className="tabular-nums">{children}</span>
    </span>
  );
}

function Row({ c, muted }: { c: ClientCard; muted?: boolean }) {
  return (
    <li>
      <Link
        href={`/maintenance/clients/${c.id}`}
        className={cn(
          "group flex cursor-pointer items-center gap-4 rounded-xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-sm",
          muted && "opacity-75",
        )}
      >
        {c.logo_path ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl(c.logo_path)} alt={c.name} className="size-12 shrink-0 rounded-xl object-cover ring-1 ring-slate-200" />
        ) : (
          <div
            className="flex size-12 shrink-0 items-center justify-center rounded-xl text-base font-bold text-white"
            style={{ backgroundColor: c.brand_color ?? "#0EA5E9" }}
          >
            {initials(c.name)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="font-semibold text-slate-900">{c.name}</p>
            {c.category ? (
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                {CATEGORY_LABEL[c.category]}
              </span>
            ) : null}
            {c.rels.map((r) => {
              const { label, Icon, chip } = REL[r];
              return (
                <span key={r} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset", chip)}>
                  <Icon className="size-2.5" />
                  {label}
                </span>
              );
            })}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            {c.quotes > 0 ? <Metric Icon={FileText} title="Cotizaciones">{c.quotes}</Metric> : null}
            {c.enJuego > 0 ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600" title="Monto enviado sin cerrar">
                <DollarSign className="size-3.5" />
                <span className="tabular-nums">{formatMoney(c.enJuego)}</span>
              </span>
            ) : null}
            {c.proyectosActivos > 0 ? <Metric Icon={Hammer} title="Proyectos activos">{c.proyectosActivos}</Metric> : null}
            {c.mantenimientos > 0 ? <Metric Icon={Wrench} title="Mantenimientos activos">{c.mantenimientos}</Metric> : null}
            {c.sucursales > 0 ? <Metric Icon={MapPin} title="Sucursales">{c.sucursales}</Metric> : null}
            {c.equipos > 0 ? <Metric Icon={Box} title="Equipos">{c.equipos}</Metric> : null}
            {c.quotes === 0 && c.proyectos === 0 && c.mantenimientos === 0 && c.sucursales === 0 ? (
              <span className="text-xs text-slate-400">Sin actividad registrada</span>
            ) : null}
          </div>
        </div>
        <ChevronRight className="size-5 text-slate-300 transition-transform group-hover:translate-x-1" />
      </Link>
    </li>
  );
}
