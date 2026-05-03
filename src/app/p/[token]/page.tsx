import { notFound } from "next/navigation";
import Link from "next/link";
import {
  CheckCircle2,
  AlertTriangle,
  XOctagon,
  Boxes,
  Calendar,
  ChevronRight,
  Phone,
  Mail,
  MessageCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  aggregateStatus,
  STATUS_COLOR,
  type DashboardData,
  type EquipmentStatus,
} from "@/lib/maintenance/types";
import { ClientHeader } from "@/components/maintenance/client-header";
import { KpiCard } from "@/components/maintenance/kpi-card";
import { StatusDonut, StackedStatusBar, ReportTrendLine } from "@/components/maintenance/charts";
import { EquipmentCard } from "@/components/maintenance/equipment-card";
import { StatusBadge, StatusDot } from "@/components/maintenance/status-badge";

export const dynamic = "force-dynamic";

async function loadDashboard(token: string): Promise<DashboardData | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_public_dashboard", { _token: token });
  if (error || !data) return null;
  return data as DashboardData;
}

function formatDateLong(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-PA", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatDateShort(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-PA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default async function PublicDashboardPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await loadDashboard(token);
  if (!data) notFound();

  const { client, locations, reports } = data;
  const allEquipment = locations.flatMap((l) => l.equipment);
  const counts = aggregateStatus(allEquipment);
  const total = allEquipment.length;

  const lastReport = reports[0];
  const nextService = lastReport?.next_service_date ?? null;

  const reportsForTrend = reports
    .filter((r) => r.item_counts)
    .map((r) => ({
      performed_at_start: r.performed_at_start,
      counts: {
        operativo: r.item_counts?.operativo ?? 0,
        atencion: r.item_counts?.atencion ?? 0,
        critico: r.item_counts?.critico ?? 0,
        fuera_de_servicio: r.item_counts?.fuera_de_servicio ?? 0,
        sin_inspeccion: r.item_counts?.sin_inspeccion ?? 0,
      } as Record<EquipmentStatus, number>,
    }));

  return (
    <>
      <ClientHeader
        client={client}
        serviceProvider="DICEC, INC"
        subtitle={
          lastReport
            ? `Última actualización: ${formatDateLong(lastReport.performed_at_start)}`
            : "Reportes de Mantenimiento"
        }
      />

      <main className="mx-auto max-w-7xl px-6 py-8 lg:px-8 lg:py-10">
        {/* KPI cards */}
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard
            label="Equipos totales"
            value={total}
            accent="#0F172A"
            icon={Boxes}
            hint={`${locations.length} sucursal${locations.length === 1 ? "" : "es"}`}
          />
          <KpiCard
            label="Operativos"
            value={counts.operativo}
            total={total}
            accent={STATUS_COLOR.operativo}
            icon={CheckCircle2}
          />
          <KpiCard
            label="Requieren atención"
            value={counts.atencion}
            total={total}
            accent={STATUS_COLOR.atencion}
            icon={AlertTriangle}
          />
          <KpiCard
            label="Críticos"
            value={counts.critico}
            total={total}
            accent={STATUS_COLOR.critico}
            icon={XOctagon}
          />
        </section>

        {/* Distribution */}
        <section className="mt-6 grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-1">
            <h2 className="text-sm font-semibold text-slate-700">Distribución de estado</h2>
            <p className="mt-0.5 text-xs text-slate-500">Vista global de todos los equipos</p>
            <div className="mt-4 flex items-center justify-center">
              <StatusDonut counts={counts} />
            </div>
            <ul className="mt-4 space-y-1.5">
              {(
                [
                  ["operativo", "Operativo"],
                  ["atencion", "Requiere atención"],
                  ["critico", "Crítico"],
                  ["fuera_de_servicio", "Fuera de servicio"],
                  ["sin_inspeccion", "Sin inspección"],
                ] as [EquipmentStatus, string][]
              )
                .filter(([k]) => counts[k] > 0)
                .map(([k, label]) => (
                  <li key={k} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 text-slate-600">
                      <StatusDot status={k} />
                      {label}
                    </span>
                    <span className="font-semibold tabular-nums text-slate-900">{counts[k]}</span>
                  </li>
                ))}
            </ul>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-2">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-700">Tendencia histórica</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  % de equipos operativos por reporte
                </p>
              </div>
              {reportsForTrend.length > 0 ? (
                <span className="text-2xl font-semibold tabular-nums text-emerald-600">
                  {Math.round(
                    (counts.operativo / Math.max(total, 1)) * 100,
                  )}
                  %
                </span>
              ) : null}
            </div>
            <div className="mt-4">
              <ReportTrendLine reports={reportsForTrend} height={140} />
            </div>
            <div className="mt-2">
              <StackedStatusBar counts={counts} />
            </div>
          </div>
        </section>

        {/* Equipment by location */}
        <section className="mt-10">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-slate-900">
                Equipos por sucursal
              </h2>
              <p className="mt-0.5 text-sm text-slate-500">
                Estado actual basado en el último reporte de cada equipo
              </p>
            </div>
          </div>

          <div className="space-y-8">
            {locations.map((loc) => {
              const locCounts = aggregateStatus(loc.equipment);
              return (
                <div key={loc.id}>
                  <div className="mb-3 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <h3 className="text-base font-semibold text-slate-900">{loc.name}</h3>
                      <span className="text-xs text-slate-500">
                        {loc.equipment.length} equipo{loc.equipment.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      {locCounts.operativo > 0 ? (
                        <span className="flex items-center gap-1 text-emerald-700">
                          <StatusDot status="operativo" />
                          {locCounts.operativo}
                        </span>
                      ) : null}
                      {locCounts.atencion > 0 ? (
                        <span className="flex items-center gap-1 text-amber-700">
                          <StatusDot status="atencion" />
                          {locCounts.atencion}
                        </span>
                      ) : null}
                      {locCounts.critico > 0 ? (
                        <span className="flex items-center gap-1 text-red-700">
                          <StatusDot status="critico" />
                          {locCounts.critico}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {loc.equipment.map((e) => (
                      <EquipmentCard key={e.id} equipment={e} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Reports timeline */}
        <section className="mt-12">
          <div className="mb-4">
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">
              Historial de reportes
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">Últimos {reports.length} reportes publicados</p>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <ol className="divide-y divide-slate-200">
              {reports.map((r) => {
                const totals = r.item_counts ?? {};
                return (
                  <li key={r.id}>
                    <Link
                      href={`/p/${token}/reports/${r.id}`}
                      className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-slate-50"
                    >
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                        <Calendar className="size-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-slate-900">{r.report_number}</p>
                          {r.status === "accepted" ? (
                            <StatusBadge status="operativo" size="sm" short />
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-sm text-slate-600">
                          {formatDateLong(r.performed_at_start)}
                          {r.performed_by_name ? ` · ${r.performed_by_name}` : ""}
                        </p>
                        {r.summary_es ? (
                          <p className="mt-1 line-clamp-1 text-xs text-slate-500">{r.summary_es}</p>
                        ) : null}
                      </div>
                      <div className="hidden items-center gap-2 text-xs sm:flex">
                        {(totals.operativo ?? 0) > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                            <CheckCircle2 className="size-3" />
                            {totals.operativo}
                          </span>
                        ) : null}
                        {(totals.atencion ?? 0) > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20">
                            <AlertTriangle className="size-3" />
                            {totals.atencion}
                          </span>
                        ) : null}
                        {(totals.critico ?? 0) > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 font-semibold text-red-700 ring-1 ring-inset ring-red-600/20">
                            <XOctagon className="size-3" />
                            {totals.critico}
                          </span>
                        ) : null}
                      </div>
                      <ChevronRight className="size-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-1 group-hover:text-slate-600" />
                    </Link>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        {/* Contact + next service */}
        {lastReport ? (
          <section className="mt-12 grid gap-4 lg:grid-cols-3">
            {lastReport.performed_by_name ? (
              <ContactCard
                title="Técnico de mantenimiento"
                name={lastReport.performed_by_name}
                role="Técnico Supervisor"
                phone={(lastReport as { performed_by_phone?: string | null }).performed_by_phone ?? null}
                email={null}
              />
            ) : null}
            {lastReport.engineer_name ? (
              <ContactCard
                title="Ingeniero encargado"
                name={lastReport.engineer_name}
                role="Ingeniero Supervisor"
                phone={(lastReport as { engineer_phone?: string | null }).engineer_phone ?? null}
                email={(lastReport as { engineer_email?: string | null }).engineer_email ?? null}
              />
            ) : null}
            {nextService ? (
              <div className="flex flex-col rounded-xl border border-emerald-200 bg-emerald-50 p-5">
                <div className="flex items-center gap-2 text-emerald-800">
                  <Calendar className="size-5" />
                  <p className="text-sm font-semibold">Próximo mantenimiento</p>
                </div>
                <p className="mt-2 text-2xl font-semibold tabular-nums text-emerald-900">
                  {formatDateShort(nextService)}
                </p>
                <p className="mt-1 text-xs text-emerald-700">
                  Programado según cronograma preventivo bimensual
                </p>
              </div>
            ) : null}
          </section>
        ) : null}

        <footer className="mt-12 border-t border-slate-200 pt-6 text-center">
          <p className="text-sm font-medium text-slate-700">¡Gracias por confiar en nuestro servicio!</p>
          <p className="mt-1 text-xs text-slate-500">
            Este portal se actualiza automáticamente con cada nuevo reporte de mantenimiento.
          </p>
        </footer>
      </main>
    </>
  );
}

function ContactCard({
  title,
  name,
  role,
  phone,
  email,
}: {
  title: string;
  name: string;
  role: string;
  phone: string | null;
  email: string | null;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</p>
      <p className="mt-2 text-lg font-semibold text-slate-900">{name}</p>
      <p className="text-sm text-slate-500">{role}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {phone ? (
          <a
            href={`https://wa.me/${phone.replace(/\D/g, "")}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700"
          >
            <MessageCircle className="size-3.5" />
            WhatsApp
          </a>
        ) : null}
        {phone ? (
          <a
            href={`tel:${phone.replace(/\s/g, "")}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-200"
          >
            <Phone className="size-3.5" />
            {phone}
          </a>
        ) : null}
        {email ? (
          <a
            href={`mailto:${email}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-200"
          >
            <Mail className="size-3.5" />
            Email
          </a>
        ) : null}
      </div>
    </div>
  );
}

