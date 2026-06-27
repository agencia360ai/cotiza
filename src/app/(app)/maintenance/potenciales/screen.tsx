"use client";

import { useState } from "react";
import Link from "next/link";
import { FileText, Gavel, Info, TrendingUp, CheckCircle2, XCircle, Clock, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  pipelineDerived,
  formatMoney,
  QUOTE_STATUS_LABEL,
  QUOTE_STATUS_COLOR,
  TENDER_STATUS_LABEL,
  TENDER_STATUS_COLOR,
  type PipelineData,
  type QuoteStatus,
  type TenderStatus,
} from "@/lib/pipeline/types";

type Tab = "cotizaciones" | "licitaciones";

export function PotencialesScreen({ data }: { data: PipelineData }) {
  const [tab, setTab] = useState<Tab>("cotizaciones");
  const d = pipelineDerived(data);
  const c = data.cotizaciones;
  const l = data.licitaciones;

  return (
    <div className="px-4 py-6 md:px-10 md:py-8 max-w-7xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Potenciales</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cotizaciones y licitaciones — lo que puede convertirse en negocio.
        </p>
      </header>

      {/* Source banner — live vs snapshot */}
      {data.live ? (
        <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <Info className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          <p className="text-xs leading-relaxed text-emerald-800">
            <strong>Datos en vivo</strong> ({data.year}). Próximo paso: tabla editable con seguimiento de enviadas,
            motivo de rechazo, conversión a proyecto e import desde Dropbox.
          </p>
        </div>
      ) : (
        <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <Info className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <p className="text-xs leading-relaxed text-amber-800">
            <strong>Vista previa con tus números reales</strong> (snapshot del Excel de control · {data.year}).
            Apenas se importe la data a la base, esta vista pasa a vivo automáticamente.
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-6 flex gap-1 border-b border-slate-200">
        <TabButton active={tab === "cotizaciones"} onClick={() => setTab("cotizaciones")} icon={FileText}>
          Cotizaciones
        </TabButton>
        <TabButton active={tab === "licitaciones"} onClick={() => setTab("licitaciones")} icon={Gavel}>
          Licitaciones
        </TabButton>
      </div>

      {tab === "cotizaciones" ? (
        <>
          <section className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              label="En juego"
              value={formatMoney(c.porEstado.enviada.monto)}
              sub={`${c.porEstado.enviada.count} enviadas sin cerrar`}
              icon={Clock}
              accent="#F59E0B"
            />
            <Kpi
              label="Aprobadas"
              value={String(c.porEstado.aprobada.count)}
              sub={formatMoney(c.porEstado.aprobada.monto)}
              icon={CheckCircle2}
              accent="#10B981"
            />
            <Kpi
              label="Por cobrar"
              value={String(c.facturacion.porCobrar)}
              sub="aprobadas sin pago"
              icon={DollarSign}
              accent="#2563EB"
            />
            <Kpi
              label="Tasa de cierre"
              value={`${Math.round(d.tasaCierre * 100)}%`}
              sub={`${c.porEstado.rechazada.count} rechazadas`}
              icon={TrendingUp}
              accent="#6366F1"
            />
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Por estado" subtitle={`${c.total.count} cotizaciones · ${formatMoney(c.total.monto)} cotizado`}>
              <div className="space-y-3">
                {(Object.keys(c.porEstado) as QuoteStatus[]).map((s) => (
                  <BreakdownRow
                    key={s}
                    label={QUOTE_STATUS_LABEL[s]}
                    color={QUOTE_STATUS_COLOR[s]}
                    count={c.porEstado[s].count}
                    total={c.total.count}
                    money={c.porEstado[s].monto}
                  />
                ))}
              </div>
            </Panel>

            <Panel title="Facturación de aprobadas" subtitle="Seguimiento de cobro">
              <div className="space-y-3">
                <BreakdownRow label="Cobradas" color="#10B981" count={c.facturacion.cobrada} total={c.porEstado.aprobada.count} />
                <BreakdownRow label="Por cobrar" color="#F59E0B" count={c.facturacion.porCobrar} total={c.porEstado.aprobada.count} />
                <BreakdownRow label="Sin estado" color="#94A3B8" count={c.facturacion.sinEstado} total={c.porEstado.aprobada.count} />
              </div>
            </Panel>
          </div>
        </>
      ) : (
        <>
          <section className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              label="Vivas"
              value={String(d.licitacionesVivas)}
              sub="presentadas / en revisión"
              icon={Clock}
              accent="#2563EB"
            />
            <Kpi
              label="Ganadas"
              value={String(l.porEstatus.ganada.count)}
              sub={formatMoney(l.porEstatus.ganada.monto)}
              icon={CheckCircle2}
              accent="#10B981"
            />
            <Kpi
              label="No ganadas"
              value={String(l.porEstatus.no_ganada.count)}
              sub="cerradas sin éxito"
              icon={XCircle}
              accent="#94A3B8"
            />
            <Kpi
              label="Registradas"
              value={String(l.total.count)}
              sub={`${formatMoney(l.total.monto)} referencial`}
              icon={Gavel}
              accent="#6366F1"
            />
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Por estatus" subtitle={`${l.total.count} licitaciones registradas`}>
              <div className="space-y-3">
                {(Object.keys(l.porEstatus) as TenderStatus[]).map((s) => (
                  <BreakdownRow
                    key={s}
                    label={TENDER_STATUS_LABEL[s]}
                    color={TENDER_STATUS_COLOR[s]}
                    count={l.porEstatus[s].count}
                    total={l.total.count}
                    money={l.porEstatus[s].monto}
                  />
                ))}
              </div>
            </Panel>

            <Panel title="Por modalidad" subtitle="PanamaCompra">
              <div className="space-y-3">
                {Object.values(l.porModalidad).map((m) => (
                  <BreakdownRow
                    key={m.label}
                    label={m.label}
                    color="#6366F1"
                    count={m.count}
                    total={l.porModalidad.publica.count + l.porModalidad.compraMenor.count + l.porModalidad.contratacionMenor.count}
                  />
                ))}
              </div>
            </Panel>
          </div>
        </>
      )}
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
        active
          ? "border-slate-900 text-slate-900"
          : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700",
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

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <header className="mb-4">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
      </header>
      {children}
    </section>
  );
}

function BreakdownRow({
  label,
  color,
  count,
  total,
  money,
}: {
  label: string;
  color: string;
  count: number;
  total: number;
  money?: number;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="inline-flex items-center gap-2 font-medium text-slate-700">
          <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} />
          {label}
        </span>
        <span className="tabular-nums text-slate-600">
          {count}
          {money !== undefined ? <span className="ml-2 text-xs text-muted-foreground">{formatMoney(money)}</span> : null}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}
