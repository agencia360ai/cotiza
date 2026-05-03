import Link from "next/link";
import {
  MapPin,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ArrowRight,
} from "lucide-react";
import {
  aggregateStatus,
  healthScore,
  STATUS_COLOR,
  type Equipment,
  type Location,
  type EquipmentStatus,
  type ReportSummary,
} from "@/lib/maintenance/types";
import { StackedStatusBar } from "./charts";
import { EquipmentCard } from "./equipment-card";
import { cn } from "@/lib/utils";

function formatDateShort(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-PA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function relativeFromNow(iso: string | null): string {
  if (!iso) return "Sin inspección";
  const days = Math.floor((Date.now() - +new Date(iso)) / 86400000);
  if (days < 1) return "hoy";
  if (days < 7) return `hace ${days} día${days === 1 ? "" : "s"}`;
  if (days < 30) return `hace ${Math.floor(days / 7)} sem`;
  if (days < 365) return `hace ${Math.floor(days / 30)} mes`;
  return `hace ${Math.floor(days / 365)} año`;
}

function relativeUntil(iso: string | null): string {
  if (!iso) return "—";
  const days = Math.floor((+new Date(iso) - Date.now()) / 86400000);
  if (days < 0) return "vencido";
  if (days < 1) return "hoy";
  if (days < 30) return `en ${days} día${days === 1 ? "" : "s"}`;
  if (days < 365) return `en ${Math.floor(days / 30)} mes`;
  return `en ${Math.floor(days / 365)} año`;
}

function lastInspectionForLocation(equipment: Equipment[]): string | null {
  let latest: string | null = null;
  for (const e of equipment) {
    if (e.latest_inspection_at && (!latest || e.latest_inspection_at > latest)) {
      latest = e.latest_inspection_at;
    }
  }
  return latest;
}

function colorForScore(score: number): string {
  if (score >= 85) return "#10B981";
  if (score >= 65) return "#84CC16";
  if (score >= 45) return "#F59E0B";
  if (score >= 25) return "#F97316";
  return "#EF4444";
}

export function LocationCard({
  location,
  token,
  reports,
}: {
  location: Location;
  token: string;
  reports: ReportSummary[];
}) {
  const counts = aggregateStatus(location.equipment);
  const score = healthScore(counts);
  const scoreColor = colorForScore(score);
  const lastInspection = lastInspectionForLocation(location.equipment);
  const nextService = reports
    .filter((r) => r.next_service_date)
    .map((r) => r.next_service_date as string)
    .sort()[0] ?? null;

  const locationReports = reports.filter(
    (r) => r.location_id === location.id || r.location_id === null,
  );

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      {/* Card header */}
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 bg-slate-50/50 px-6 py-5">
        <div className="flex items-start gap-3">
          <div
            className="flex size-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm"
            style={{ backgroundColor: scoreColor }}
          >
            <MapPin className="size-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold tracking-tight text-slate-900">
              {location.name}
            </h3>
            <p className="mt-0.5 text-sm text-slate-500">
              {location.address ?? "Dirección no especificada"}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-end">
          <div
            className="flex items-baseline gap-1 rounded-lg px-3 py-1.5 ring-1 ring-inset"
            style={{
              backgroundColor: `${scoreColor}15`,
              color: scoreColor,
              borderColor: scoreColor,
            }}
          >
            <span className="text-2xl font-bold tabular-nums">{score}</span>
            <span className="text-xs font-medium opacity-80">% salud</span>
          </div>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            ponderado por estado
          </p>
        </div>
      </header>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-4">
        <Stat
          label="Equipos"
          value={String(location.equipment.length)}
          hint="totales"
          accent="#0F172A"
        />
        <Stat
          label="Última inspección"
          value={relativeFromNow(lastInspection)}
          hint={lastInspection ? formatDateShort(lastInspection) : "—"}
          accent="#3B82F6"
        />
        <Stat
          label="Próximo servicio"
          value={relativeUntil(nextService)}
          hint={nextService ? formatDateShort(nextService) : "Sin programar"}
          accent="#10B981"
          icon={Calendar}
        />
        <Stat
          label="Alertas"
          value={String(counts.atencion + counts.critico)}
          hint={
            counts.critico > 0
              ? `${counts.critico} crítico${counts.critico === 1 ? "" : "s"}`
              : counts.atencion > 0
                ? `${counts.atencion} atención`
                : "Sin alertas"
          }
          accent={
            counts.critico > 0
              ? STATUS_COLOR.critico
              : counts.atencion > 0
                ? STATUS_COLOR.atencion
                : STATUS_COLOR.operativo
          }
          icon={counts.critico > 0 ? AlertTriangle : CheckCircle2}
        />
      </div>

      {/* Status distribution bar */}
      <div className="border-b border-slate-100 px-6 py-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Distribución de estados
          </p>
          <div className="flex items-center gap-3 text-xs text-slate-600">
            {(["operativo", "atencion", "critico", "fuera_de_servicio", "sin_inspeccion"] as EquipmentStatus[])
              .filter((k) => counts[k] > 0)
              .map((k) => (
                <span key={k} className="inline-flex items-center gap-1.5">
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: STATUS_COLOR[k] }}
                  />
                  <span className="font-semibold tabular-nums">{counts[k]}</span>
                </span>
              ))}
          </div>
        </div>
        <StackedStatusBar counts={counts} />
      </div>

      {/* Equipment grid */}
      <div className="px-6 py-5">
        <div className="mb-4 flex items-end justify-between">
          <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-700">
            Equipos en esta sucursal
          </h4>
          <span className="text-xs text-slate-500">
            {location.equipment.length} unidad
            {location.equipment.length === 1 ? "" : "es"}
          </span>
        </div>
        {location.equipment.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500">
            Aún no hay equipos registrados en esta sucursal
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {location.equipment.map((e) => (
              <EquipmentCard
                key={e.id}
                equipment={e}
                href={`/p/${token}/equipment/${e.id}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/50 px-6 py-3 text-xs">
        <div className="flex items-center gap-2 text-slate-500">
          <Clock className="size-3.5" />
          {locationReports.length > 0 ? (
            <span>
              {locationReports.length} reporte{locationReports.length === 1 ? "" : "s"}{" "}
              en historial
            </span>
          ) : (
            <span>Sin historial de reportes</span>
          )}
        </div>
        <Link
          href={`/p/${token}/reports?location=${location.id}`}
          className="inline-flex items-center gap-1 font-semibold text-slate-700 transition-colors hover:text-slate-900"
        >
          Ver reportes de esta sucursal
          <ArrowRight className="size-3.5" />
        </Link>
      </footer>
    </article>
  );
}

function Stat({
  label,
  value,
  hint,
  accent,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  accent: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="bg-white px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </p>
        {Icon ? (
          <span style={{ color: accent }} className="inline-flex">
            <Icon className="size-3.5 shrink-0" />
          </span>
        ) : null}
      </div>
      <p
        className="mt-1 text-lg font-bold leading-tight tabular-nums"
        style={{ color: accent }}
      >
        {value}
      </p>
      <p className="text-[11px] text-slate-500">{hint}</p>
    </div>
  );
}
