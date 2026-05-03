import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  User,
  AlertOctagon,
  CheckCircle2,
  XOctagon,
  AlertTriangle,
  PowerOff,
  HelpCircle,
  Camera,
  Sparkles,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  REPORT_TYPE_COLOR,
  REPORT_TYPE_LABEL,
  SEVERITY_LABEL,
  SEVERITY_TINT,
  STATUS_COLOR,
  STATUS_LABEL,
  PRIORITY_TINT,
  imageUrl,
  type EquipmentStatus,
  type ReportType,
  type ReportSeverity,
  type CaptureItem,
  type Recommendation,
} from "@/lib/maintenance/types";
import { ReportTypeIcon } from "@/components/maintenance/report-type-badge";
import { cn } from "@/lib/utils";
import { PublishControls, SummaryEditor } from "./controls";

export const dynamic = "force-dynamic";

const STATUS_ICON: Record<EquipmentStatus, typeof CheckCircle2> = {
  operativo: CheckCircle2,
  atencion: AlertTriangle,
  critico: XOctagon,
  fuera_de_servicio: PowerOff,
  sin_inspeccion: HelpCircle,
};

type ReportRow = {
  id: string;
  client_id: string;
  location_id: string | null;
  report_number: string;
  report_type: ReportType;
  severity: ReportSeverity | null;
  trigger_event_es: string | null;
  performed_at_start: string;
  performed_at_end: string | null;
  performed_by_name: string | null;
  performed_by_phone: string | null;
  engineer_name: string | null;
  engineer_email: string | null;
  summary_es: string | null;
  status: "draft" | "published" | "accepted";
  ai_generated: boolean;
  ai_draft_at: string | null;
  published_at: string | null;
  capture_data: CaptureItem[];
  next_service_date: string | null;
  client: { name: string; brand_color: string | null } | null;
  location: { name: string; address: string | null } | null;
  technician: { name: string; phone: string | null } | null;
};

type Item = {
  id: string;
  equipment_id: string;
  equipment_status: EquipmentStatus;
  observations_es: string | null;
  recommendations: Recommendation[];
  parts_replaced: { name: string; quantity?: number }[];
  checklist_items: string[];
  photo_paths: string[];
  position: number;
  equipment: { brand: string | null; model: string | null; custom_name: string; location_label: string | null } | null;
};

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) redirect("/login");

  const { data: report } = (await supabase
    .from("maintenance_reports")
    .select(
      "*, client:clients(name, brand_color), location:client_locations(name, address), technician:technicians(name, phone)",
    )
    .eq("id", id)
    .single()) as { data: ReportRow | null };

  if (!report) notFound();

  const { data: items } = (await supabase
    .from("report_items")
    .select("*, equipment:client_equipment(brand, model, custom_name, location_label)")
    .eq("report_id", id)
    .order("position", { ascending: true })) as { data: Item[] | null };

  const allItems = items ?? [];

  return (
    <div className="px-10 py-8 max-w-5xl">
      <Link
        href="/maintenance/reports"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="size-4" />
        Volver a reportes
      </Link>

      {/* Header */}
      <div className="mb-6 rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div
              className="flex size-12 shrink-0 items-center justify-center rounded-xl text-white"
              style={{ backgroundColor: REPORT_TYPE_COLOR[report.report_type] }}
            >
              <ReportTypeIcon type={report.report_type} className="size-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-mono text-xs text-slate-500">{report.report_number}</p>
                {report.ai_generated ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700 ring-1 ring-inset ring-violet-600/20">
                    <Sparkles className="size-2.5" />
                    Generado por IA
                  </span>
                ) : null}
                {report.severity ? (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset",
                      SEVERITY_TINT[report.severity],
                    )}
                  >
                    <AlertOctagon className="size-2.5" />
                    {SEVERITY_LABEL[report.severity]}
                  </span>
                ) : null}
              </div>
              <h1 className="mt-1 text-2xl font-bold tracking-tight">
                {REPORT_TYPE_LABEL[report.report_type]}
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                <strong>{report.client?.name ?? "—"}</strong>
                {report.location?.name ? ` · ${report.location.name}` : ""}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <Calendar className="size-3" />
                  {new Date(report.performed_at_start).toLocaleDateString("es-PA", { day: "numeric", month: "long", year: "numeric" })}
                </span>
                {report.performed_by_name ? (
                  <span className="inline-flex items-center gap-1">
                    <User className="size-3" />
                    {report.performed_by_name}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <PublishControls reportId={report.id} status={report.status} />
        </div>

        {report.trigger_event_es ? (
          <div className="mt-4 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-orange-700">
              Evento que originó el reporte
            </p>
            <p className="mt-1 text-orange-900">{report.trigger_event_es}</p>
          </div>
        ) : null}

        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Resumen general
          </p>
          <SummaryEditor reportId={report.id} initialSummary={report.summary_es ?? ""} />
        </div>
      </div>

      {/* Capture data */}
      {report.capture_data.length > 0 ? (
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-700">
            Capturas del técnico ({report.capture_data.length})
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {report.capture_data.map((c) => (
              <div key={c.id} className="rounded-lg border border-border bg-card p-2">
                {c.kind === "photo" && c.photo_path ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imageUrl(c.photo_path)}
                    alt="Captura"
                    className="aspect-square w-full rounded object-cover"
                  />
                ) : (
                  <div className="flex aspect-square w-full flex-col items-center justify-center rounded bg-slate-50 p-2 text-center">
                    <p className="text-[10px] font-bold uppercase text-slate-500">
                      {c.kind === "voice" ? "🎤 Voz" : "📝 Texto"}
                    </p>
                    <p className="mt-1 line-clamp-4 text-[11px] text-slate-700">{c.text}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Items */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-700">
          Equipos inspeccionados ({allItems.length})
        </h2>
        <div className="space-y-3">
          {allItems.map((it) => {
            const Icon = STATUS_ICON[it.equipment_status];
            const color = STATUS_COLOR[it.equipment_status];
            return (
              <div key={it.id} className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="flex items-start gap-3 border-b border-border bg-slate-50/50 px-4 py-3">
                  <div
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg"
                    style={{ backgroundColor: `${color}15`, color }}
                  >
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">
                      {it.equipment?.brand ?? ""} {it.equipment?.model ?? ""}
                    </p>
                    <p className="text-xs text-slate-500">
                      {it.equipment?.location_label ?? it.equipment?.custom_name ?? ""}
                    </p>
                  </div>
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset"
                    style={{
                      backgroundColor: `${color}15`,
                      color,
                      borderColor: color,
                    }}
                  >
                    {STATUS_LABEL[it.equipment_status]}
                  </span>
                </div>
                <div className="space-y-3 p-4">
                  {it.observations_es ? (
                    <p className="text-sm text-slate-700">{it.observations_es}</p>
                  ) : null}
                  {it.recommendations.length > 0 ? (
                    <ul className="space-y-1">
                      {it.recommendations.map((r, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs">
                          <span
                            className={cn(
                              "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ring-1 ring-inset",
                              PRIORITY_TINT[r.priority],
                            )}
                          >
                            {r.priority}
                          </span>
                          <span className="text-slate-700">{r.description}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {it.checklist_items.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {it.checklist_items.map((c, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700"
                        >
                          ✓ {c}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {it.photo_paths.length > 0 ? (
                    <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                      {it.photo_paths.map((p, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={i}
                          src={imageUrl(p)}
                          alt={`foto ${i + 1}`}
                          className="aspect-square w-full rounded object-cover ring-1 ring-slate-200"
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Suppress unused */}
      <span hidden>
        <Camera />
      </span>
    </div>
  );
}
