import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Wrench,
  Camera,
  ShieldCheck,
  AlertOctagon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  PRIORITY_LABEL,
  PRIORITY_TINT,
  REPORT_TYPE_COLOR,
  REPORT_TYPE_LABEL,
  SEVERITY_LABEL,
  SEVERITY_TINT,
  type ReportDetailData,
  type EquipmentStatus,
  type Recommendation,
} from "@/lib/maintenance/types";
import { imageUrl } from "@/lib/maintenance/types";
import { ClientHeader } from "@/components/maintenance/client-header";
import { StatusDonut, StackedStatusBar } from "@/components/maintenance/charts";
import { StatusBadge } from "@/components/maintenance/status-badge";
import { ReportTypeIcon } from "@/components/maintenance/report-type-badge";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

async function loadReport(token: string, reportId: string): Promise<ReportDetailData | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_public_report", {
    _token: token,
    _report_id: reportId,
  });
  if (error || !data) return null;
  return data as ReportDetailData;
}

function formatDateLong(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-PA", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function aggregateItemStatus(items: ReportDetailData["items"]): Record<EquipmentStatus, number> {
  const counts: Record<EquipmentStatus, number> = {
    operativo: 0,
    atencion: 0,
    critico: 0,
    fuera_de_servicio: 0,
    sin_inspeccion: 0,
  };
  for (const i of items) counts[i.equipment_status]++;
  return counts;
}

export default async function PublicReportPage({
  params,
}: {
  params: Promise<{ token: string; id: string }>;
}) {
  const { token, id } = await params;
  const data = await loadReport(token, id);
  if (!data) notFound();

  const { client, service_provider, report, items, acceptance } = data;
  const counts = aggregateItemStatus(items);
  const total = items.length;

  const allRecommendations: Recommendation[] = items.flatMap((i) => i.recommendations ?? []);
  const recsByPriority = {
    alta: allRecommendations.filter((r) => r.priority === "alta"),
    media: allRecommendations.filter((r) => r.priority === "media"),
    baja: allRecommendations.filter((r) => r.priority === "baja"),
  };

  // Group items by location (using equipment.location_id)
  const itemsByLocation = new Map<string, typeof items>();
  for (const it of items) {
    const key = it.equipment.location_id;
    const arr = itemsByLocation.get(key) ?? [];
    arr.push(it);
    itemsByLocation.set(key, arr);
  }

  return (
    <>
      <ClientHeader
        client={client}
        serviceProvider={service_provider?.name ?? "Reportme.ai"}
        subtitle={`Reporte ${report.report_number} · ${formatDateLong(report.performed_at_start)}`}
      />

      <main className="mx-auto max-w-7xl px-6 py-8 lg:px-8 lg:py-10">
        <Link
          href={`/p/${token}`}
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="size-4" />
          Volver al portal
        </Link>

        {/* Hero */}
        <div
          className={cn(
            "relative overflow-hidden rounded-2xl border p-6 lg:p-8",
            report.report_type === "correctivo"
              ? "border-orange-200 bg-gradient-to-br from-orange-50 via-white to-white"
              : "border-slate-200 bg-white",
          )}
        >
          <span
            aria-hidden
            className="absolute inset-x-0 top-0 h-1.5"
            style={{ backgroundColor: REPORT_TYPE_COLOR[report.report_type] }}
          />
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset"
                  style={{
                    backgroundColor: `${REPORT_TYPE_COLOR[report.report_type]}1A`,
                    color: REPORT_TYPE_COLOR[report.report_type],
                  }}
                >
                  <ReportTypeIcon type={report.report_type} className="size-3.5" />
                  {REPORT_TYPE_LABEL[report.report_type]}
                </span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-slate-700">
                  {report.report_number}
                </span>
                {report.severity ? (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset",
                      SEVERITY_TINT[report.severity],
                    )}
                  >
                    <AlertOctagon className="size-3.5" />
                    Severidad {SEVERITY_LABEL[report.severity]}
                  </span>
                ) : null}
                {acceptance ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                    <ShieldCheck className="size-3.5" />
                    Recibido conforme
                  </span>
                ) : null}
              </div>
              <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900">
                {REPORT_TYPE_LABEL[report.report_type]}
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                {formatDateLong(report.performed_at_start)}
                {report.performed_at_end
                  ? ` — ${formatDateLong(report.performed_at_end)}`
                  : ""}
              </p>
              {report.trigger_event_es ? (
                <div className="mt-4 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wider text-orange-700">
                    Evento que originó el reporte
                  </p>
                  <p className="mt-1 text-sm text-orange-900">{report.trigger_event_es}</p>
                </div>
              ) : null}
              {report.summary_es ? (
                <p className="mt-4 text-sm leading-relaxed text-slate-700">{report.summary_es}</p>
              ) : null}

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {report.performed_by_name ? (
                  <div>
                    <p className="text-xs uppercase tracking-wider text-slate-500">Técnico</p>
                    <p className="mt-1 font-medium text-slate-900">{report.performed_by_name}</p>
                    {report.performed_by_phone ? (
                      <p className="text-sm text-slate-600">{report.performed_by_phone}</p>
                    ) : null}
                  </div>
                ) : null}
                {report.engineer_name ? (
                  <div>
                    <p className="text-xs uppercase tracking-wider text-slate-500">Ingeniero</p>
                    <p className="mt-1 font-medium text-slate-900">{report.engineer_name}</p>
                    {report.engineer_email ? (
                      <p className="text-sm text-slate-600">{report.engineer_email}</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col items-center justify-center gap-3 rounded-xl bg-slate-50 p-4">
              <StatusDonut counts={counts} size={180} />
              <div className="grid w-full grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-lg font-semibold tabular-nums text-emerald-600">
                    {counts.operativo}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">Óptimo</p>
                </div>
                <div>
                  <p className="text-lg font-semibold tabular-nums text-amber-600">{counts.atencion}</p>
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">Atención</p>
                </div>
                <div>
                  <p className="text-lg font-semibold tabular-nums text-red-600">{counts.critico}</p>
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">Crítico</p>
                </div>
              </div>
              <div className="w-full">
                <StackedStatusBar counts={counts} />
              </div>
              <p className="text-xs text-slate-500">{total} equipos inspeccionados</p>
            </div>
          </div>
        </div>

        {/* Recommendations by priority */}
        {allRecommendations.length > 0 ? (
          <section className="mt-8">
            <h2 className="mb-3 text-lg font-semibold tracking-tight text-slate-900">
              Acciones recomendadas
            </h2>
            <div className="grid gap-4 lg:grid-cols-3">
              {(["alta", "media", "baja"] as const).map((p) =>
                recsByPriority[p].length > 0 ? (
                  <div
                    key={p}
                    className="rounded-xl border border-slate-200 bg-white p-5"
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${PRIORITY_TINT[p]}`}
                      >
                        {PRIORITY_LABEL[p]}
                      </span>
                      <span className="text-xs text-slate-500">{recsByPriority[p].length}</span>
                    </div>
                    <ul className="mt-3 space-y-2">
                      {recsByPriority[p].map((r, idx) => (
                        <li
                          key={idx}
                          className="border-l-2 border-slate-200 pl-3 text-sm text-slate-700"
                        >
                          {r.description}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null,
              )}
            </div>
          </section>
        ) : null}

        {/* Items by location */}
        <section className="mt-10">
          <h2 className="mb-4 text-lg font-semibold tracking-tight text-slate-900">
            Detalle por equipo
          </h2>

          <div className="space-y-8">
            {Array.from(itemsByLocation.entries()).map(([locId, locItems]) => {
              const locName = locItems[0]?.equipment.location_label ?? "Equipos";
              return (
                <div key={locId}>
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-600">
                    {locName === "Equipos" ? "Equipos inspeccionados" : `Sección: ${locName}`}
                  </h3>
                  <div className="space-y-4">
                    {locItems.map((item) => (
                      <ItemCard key={item.id} item={item} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Acceptance */}
        <section className="mt-10 rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">Recibido conforme</h2>
          {acceptance ? (
            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-slate-700">
              <ShieldCheck className="size-5 text-emerald-600" />
              <span>
                Aceptado por{" "}
                <strong className="text-slate-900">{acceptance.signed_by_name}</strong>
                {" · "}
                {formatDateLong(acceptance.signed_at)}
              </span>
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-600">
                Confirme la recepción del reporte firmando digitalmente.
              </p>
              <button
                disabled
                className="inline-flex items-center gap-2 rounded-lg bg-slate-200 px-4 py-2 text-sm font-medium text-slate-500"
                title="Disponible próximamente"
              >
                <ClipboardCheck className="size-4" />
                Firmar y aceptar
              </button>
            </div>
          )}
        </section>

        <div className="mt-6 text-center">
          <Calendar className="mx-auto mb-1 size-4 text-slate-400" />
          {report.next_service_date ? (
            <p className="text-sm text-slate-600">
              Próximo servicio programado:{" "}
              <strong className="text-slate-900">{formatDateLong(report.next_service_date)}</strong>
            </p>
          ) : null}
        </div>
      </main>
    </>
  );
}

function ItemCard({ item }: { item: ReportDetailData["items"][number] }) {
  const eq = item.equipment;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-slate-50/50 px-5 py-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            {eq.brand ?? ""}
            {eq.model ? ` · ${eq.model}` : ""}
          </p>
          <p className="mt-0.5 font-semibold text-slate-900">{eq.custom_name}</p>
          {eq.location_label ? (
            <p className="mt-0.5 text-xs text-slate-500">{eq.location_label}</p>
          ) : null}
        </div>
        <StatusBadge status={item.equipment_status} />
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-3">
        {/* Photos */}
        <div className="lg:col-span-1">
          {item.photo_paths.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {item.photo_paths.map((p, idx) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={idx}
                  src={imageUrl(p)}
                  alt={`Foto ${idx + 1} de ${eq.custom_name}`}
                  className="aspect-square w-full rounded-lg object-cover ring-1 ring-slate-200"
                />
              ))}
            </div>
          ) : (
            <div className="flex aspect-square flex-col items-center justify-center rounded-lg bg-slate-50 text-slate-400">
              <Camera className="mb-1 size-6" />
              <span className="text-xs">Sin fotos</span>
            </div>
          )}
        </div>

        {/* Details */}
        <div className="lg:col-span-2">
          {item.observations_es ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Observaciones
              </p>
              <p className="mt-1 text-sm leading-relaxed text-slate-700">{item.observations_es}</p>
            </div>
          ) : null}

          {item.recommendations.length > 0 ? (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Recomendaciones
              </p>
              <ul className="mt-2 space-y-1.5">
                {item.recommendations.map((r, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm text-slate-700">
                    <span
                      className={`mt-0.5 inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ${PRIORITY_TINT[r.priority]}`}
                    >
                      {r.priority}
                    </span>
                    <span>{r.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {item.checklist_items.length > 0 ? (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Elementos revisados
              </p>
              <ul className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {item.checklist_items.map((c, idx) => (
                  <li key={idx} className="flex items-center gap-1.5 text-xs text-slate-700">
                    <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" />
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {item.parts_replaced.length > 0 ? (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Partes reemplazadas
              </p>
              <ul className="mt-2 space-y-1">
                {item.parts_replaced.map((p, idx) => (
                  <li key={idx} className="flex items-center gap-2 text-sm text-slate-700">
                    <Wrench className="size-3.5 text-slate-400" />
                    {p.name}
                    {p.quantity ? <span className="text-slate-500">×{p.quantity}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

