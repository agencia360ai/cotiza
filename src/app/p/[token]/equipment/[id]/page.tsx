import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar,
  MapPin,
  Snowflake,
  Wind,
  Refrigerator,
  Container,
  IceCream,
  Fan,
  ChefHat,
  Box,
  ClipboardCheck,
  Wrench,
  Activity,
  AlertOctagon,
  TrendingUp,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  STATUS_COLOR,
  REPORT_TYPE_COLOR,
  REPORT_TYPE_LABEL_SHORT,
  PRIORITY_TINT,
  SEVERITY_LABEL,
  SEVERITY_TINT,
  imageUrl,
  type EquipmentHistoryData,
  type EquipmentStatus,
  type EquipmentHistoryEntry,
} from "@/lib/maintenance/types";
import { StatusBadge } from "@/components/maintenance/status-badge";
import { ReportTypeIcon } from "@/components/maintenance/report-type-badge";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const CATEGORY_ICON: Record<string, typeof Snowflake> = {
  nevera: Refrigerator,
  congelador: Snowflake,
  cuarto_frio: Container,
  mesa_fria: Refrigerator,
  vitrina_refrigerada: Refrigerator,
  ice_maker: IceCream,
  botellero: Refrigerator,
  mini_split_cassette: Wind,
  central_ac: Wind,
  paquete_rooftop: Wind,
  chiller: Snowflake,
  manejadora: Fan,
  piso_techo: Wind,
  fan_coil: Fan,
  evaporadora: Wind,
  campana_extractora: ChefHat,
};

async function loadEquipment(token: string, equipmentId: string): Promise<EquipmentHistoryData | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_public_equipment_history", {
    _token: token,
    _equipment_id: equipmentId,
  });
  if (error || !data) return null;
  return data as EquipmentHistoryData;
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

export default async function PublicEquipmentPage({
  params,
}: {
  params: Promise<{ token: string; id: string }>;
}) {
  const { token, id } = await params;
  const data = await loadEquipment(token, id);
  if (!data) notFound();

  const { client, location, equipment, history } = data;
  const Icon = (equipment.category && CATEGORY_ICON[equipment.category]) || Box;
  const currentStatus: EquipmentStatus = history[0]?.status ?? "sin_inspeccion";
  const accent = STATUS_COLOR[currentStatus];

  const counts: Record<EquipmentStatus, number> = {
    operativo: 0,
    atencion: 0,
    critico: 0,
    fuera_de_servicio: 0,
    sin_inspeccion: 0,
  };
  history.forEach((h) => counts[h.status]++);

  const criticalEvents = history.filter((h) => h.status === "critico").length;
  const lastInspection = history[0]?.performed_at_start ?? null;
  const daysSince = lastInspection
    ? Math.floor((Date.now() - +new Date(lastInspection)) / 86400000)
    : null;

  const allRecs = history.flatMap((h) =>
    h.recommendations.map((r) => ({ ...r, date: h.performed_at_start, report: h.report_number })),
  );

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 lg:px-8 lg:py-12">
      <Link
        href={`/p/${token}`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
      >
        <ArrowLeft className="size-4" />
        Volver al portal de {client.name}
      </Link>

      {/* Equipment hero */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 lg:p-8">
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-1.5"
          style={{ backgroundColor: accent }}
        />
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <div
              className="flex size-16 shrink-0 items-center justify-center rounded-2xl"
              style={{ backgroundColor: `${accent}1A`, color: accent }}
            >
              <Icon className="size-8" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                {equipment.brand ?? ""}
                {equipment.model ? ` · ${equipment.model}` : ""}
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                {equipment.custom_name}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5 text-slate-400" />
                  {location.name}
                  {equipment.location_label ? ` · ${equipment.location_label}` : ""}
                </span>
                {equipment.capacity_btu ? (
                  <span className="text-slate-400">·</span>
                ) : null}
                {equipment.capacity_btu ? (
                  <span>{equipment.capacity_btu.toLocaleString("en-US")} BTU</span>
                ) : null}
                {equipment.voltage ? (
                  <>
                    <span className="text-slate-400">·</span>
                    <span>{equipment.voltage}</span>
                  </>
                ) : null}
              </div>
            </div>
          </div>
          <StatusBadge status={currentStatus} />
        </div>

        {/* Stats row */}
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label="Inspecciones"
            value={history.length}
            hint="totales"
            icon={ClipboardCheck}
          />
          <Stat
            label="Última inspección"
            valueText={daysSince != null ? `${daysSince}d` : "—"}
            hint={lastInspection ? formatDateShort(lastInspection) : "Sin inspección"}
            icon={Calendar}
          />
          <Stat
            label="Eventos críticos"
            value={criticalEvents}
            hint={`de ${history.length} inspecciones`}
            icon={AlertOctagon}
            color={criticalEvents > 0 ? STATUS_COLOR.critico : "#0F172A"}
          />
          <Stat
            label="Operativo"
            value={counts.operativo}
            hint={`${history.length > 0 ? Math.round((counts.operativo / history.length) * 100) : 0}% del tiempo`}
            icon={TrendingUp}
            color={STATUS_COLOR.operativo}
          />
        </div>
      </div>

      {/* Open recommendations across all reports */}
      {allRecs.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-bold tracking-tight text-slate-900">
            Recomendaciones acumuladas
          </h2>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <ul className="space-y-2.5">
              {allRecs.map((r, idx) => (
                <li key={idx} className="flex items-start gap-3 text-sm">
                  <span
                    className={cn(
                      "mt-0.5 inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset",
                      PRIORITY_TINT[r.priority],
                    )}
                  >
                    {r.priority}
                  </span>
                  <span className="flex-1 text-slate-700">{r.description}</span>
                  <span className="text-xs text-slate-400">
                    {formatDateShort(r.date)} · {r.report}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {/* Timeline of inspections */}
      <section className="mt-10">
        <header className="mb-5 flex items-center gap-3">
          <Activity className="size-5 text-slate-700" />
          <h2 className="text-lg font-bold tracking-tight text-slate-900">
            Historial de inspecciones
          </h2>
          <span className="text-sm text-slate-500">{history.length} eventos</span>
        </header>

        {history.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-14 text-center">
            <p className="text-sm text-slate-500">Este equipo aún no tiene inspecciones</p>
          </div>
        ) : (
          <ol className="relative space-y-6 border-l-2 border-slate-200 pl-6">
            {history.map((h) => (
              <TimelineEntry key={h.item_id} entry={h} token={token} />
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  valueText,
  hint,
  icon: Icon,
  color = "#0F172A",
}: {
  label: string;
  value?: number;
  valueText?: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
      <div className="flex items-start justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
        <div
          className="flex size-7 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${color}15`, color }}
        >
          <Icon className="size-4" />
        </div>
      </div>
      <p
        className="mt-2 text-2xl font-bold tabular-nums"
        style={{ color }}
      >
        {valueText ?? value}
      </p>
      <p className="mt-0.5 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

function TimelineEntry({
  entry,
  token,
}: {
  entry: EquipmentHistoryEntry;
  token: string;
}) {
  const dotColor = STATUS_COLOR[entry.status];
  const typeColor = REPORT_TYPE_COLOR[entry.report_type];

  return (
    <li className="relative">
      <span
        aria-hidden
        className="absolute -left-[33px] top-1 flex size-5 items-center justify-center rounded-full ring-4 ring-white"
        style={{ backgroundColor: dotColor }}
      >
        <span className="size-1.5 rounded-full bg-white" />
      </span>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
          <div className="flex items-center gap-2">
            <div
              className="flex size-7 items-center justify-center rounded-lg text-white"
              style={{ backgroundColor: typeColor }}
            >
              <ReportTypeIcon type={entry.report_type} className="size-3.5" />
            </div>
            <Link
              href={`/p/${token}/reports/${entry.report_id}`}
              className="text-sm font-semibold text-slate-900 hover:underline"
            >
              {entry.report_number}
            </Link>
            <span className="text-xs text-slate-500">
              · {REPORT_TYPE_LABEL_SHORT[entry.report_type]}
            </span>
            {entry.severity ? (
              <span
                className={cn(
                  "ml-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset",
                  SEVERITY_TINT[entry.severity],
                )}
              >
                {SEVERITY_LABEL[entry.severity]}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span>{formatDateLong(entry.performed_at_start)}</span>
            <StatusBadge status={entry.status} size="sm" short />
          </div>
        </div>

        <div className="px-5 py-4">
          {entry.observations_es ? (
            <p className="text-sm leading-relaxed text-slate-700">{entry.observations_es}</p>
          ) : (
            <p className="text-sm italic text-slate-400">Sin observaciones registradas</p>
          )}

          {entry.photo_paths.length > 0 ? (
            <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {entry.photo_paths.map((p, idx) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={idx}
                  src={imageUrl(p)}
                  alt={`Inspección ${entry.report_number} foto ${idx + 1}`}
                  className="aspect-square w-full rounded-lg object-cover ring-1 ring-slate-200"
                />
              ))}
            </div>
          ) : null}

          {(entry.recommendations.length > 0 || entry.parts_replaced.length > 0) ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {entry.recommendations.length > 0 ? (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Recomendaciones
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {entry.recommendations.map((r, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-xs text-slate-700">
                        <span
                          className={cn(
                            "mt-0.5 inline-flex shrink-0 rounded-full px-1.5 py-0 text-[9px] font-bold uppercase ring-1 ring-inset",
                            PRIORITY_TINT[r.priority],
                          )}
                        >
                          {r.priority}
                        </span>
                        <span>{r.description}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {entry.parts_replaced.length > 0 ? (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Partes reemplazadas
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {entry.parts_replaced.map((p, idx) => (
                      <li key={idx} className="flex items-center gap-1.5 text-xs text-slate-700">
                        <Wrench className="size-3 text-slate-400" />
                        {p.name}
                        {p.quantity ? <span className="text-slate-500">×{p.quantity}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {entry.performed_by_name ? (
            <p className="mt-3 text-xs text-slate-500">
              Inspeccionado por <span className="font-medium text-slate-700">{entry.performed_by_name}</span>
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

