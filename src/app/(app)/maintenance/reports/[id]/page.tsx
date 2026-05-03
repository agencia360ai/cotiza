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
import { ReportHeaderEditor, EditableItemsList } from "./editor";

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
  equipment: { id: string; brand: string | null; model: string | null; custom_name: string; location_label: string | null } | null;
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
    .select("*, equipment:client_equipment(id, brand, model, custom_name, location_label)")
    .eq("report_id", id)
    .order("position", { ascending: true })) as { data: Item[] | null };

  const allItems = items ?? [];

  // Equipment options: equipment from this report's location (or all if no location)
  let equipmentQuery = supabase
    .from("client_equipment")
    .select("id, brand, model, custom_name, location_label, location_id");
  if (report.location_id) {
    equipmentQuery = equipmentQuery.eq("location_id", report.location_id);
  } else {
    // pull all equipment for this client across locations
    const { data: locs } = await supabase
      .from("client_locations")
      .select("id")
      .eq("client_id", report.client_id);
    const locIds = (locs ?? []).map((l) => l.id);
    if (locIds.length > 0) equipmentQuery = equipmentQuery.in("location_id", locIds);
  }
  const { data: availableEquipment } = await equipmentQuery;

  const { data: technicians } = await supabase
    .from("technicians")
    .select("id, name")
    .eq("active", true)
    .order("name", { ascending: true });

  return (
    <div className="px-4 py-6 md:px-10 md:py-8 max-w-5xl">
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
            </div>
          </div>
          <PublishControls reportId={report.id} status={report.status} />
        </div>

        <ReportHeaderEditor
          reportId={report.id}
          performedByName={report.performed_by_name}
          performedAtStart={report.performed_at_start}
          technicianId={(report as ReportRow & { technician_id?: string | null }).technician_id ?? null}
          technicians={technicians ?? []}
          status={report.status}
        />

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

      <EditableItemsList
        reportId={report.id}
        items={allItems}
        availableEquipment={availableEquipment ?? []}
        status={report.status}
      />

      {/* Suppress unused */}
      <span hidden>
        <Camera />
      </span>
    </div>
  );
}
