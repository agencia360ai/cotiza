import { notFound } from "next/navigation";
import Link from "next/link";
import {
  Plus,
  Wrench,
  Calendar,
  ChevronRight,
  Clock,
  Sparkles,
  CheckCircle2,
  Hourglass,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  REPORT_TYPE_LABEL_SHORT,
  REPORT_TYPE_COLOR,
  type TechnicianPortalData,
  type TechnicianDraft,
  type TechnicianSubmitted,
} from "@/lib/maintenance/types";
import { ReportTypeIcon } from "@/components/maintenance/report-type-badge";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

async function loadPortal(token: string): Promise<TechnicianPortalData | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_technician_portal", { _token: token });
  if (error || !data) return null;
  return data as TechnicianPortalData;
}

function formatDateLong(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-PA", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function relativeFromNow(iso: string | null): string {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - +new Date(iso)) / 86400000);
  if (days < 1) {
    const hours = Math.floor((Date.now() - +new Date(iso)) / 3600000);
    if (hours < 1) return "hace un momento";
    return `hace ${hours}h`;
  }
  if (days < 7) return `hace ${days}d`;
  if (days < 30) return `hace ${Math.floor(days / 7)} sem`;
  return `hace ${Math.floor(days / 30)} mes`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default async function TechnicianDashboard({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await loadPortal(token);
  if (!data) notFound();

  const { technician, clients, drafts, submitted } = data;
  const totalEquipment = clients.reduce(
    (sum, c) => sum + c.locations.reduce((s, l) => s + l.equipment_count, 0),
    0,
  );
  const totalLocations = clients.reduce((sum, c) => sum + c.locations.length, 0);

  return (
    <>
      {/* Hero */}
      <header className="relative overflow-hidden bg-slate-950 text-white">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -top-32 size-[400px] rounded-full bg-blue-500 opacity-20 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-32 size-[400px] rounded-full bg-emerald-500 opacity-15 blur-3xl"
        />
        <div className="relative mx-auto max-w-3xl px-5 py-8 sm:py-10">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-xl bg-white/10 text-base font-bold ring-2 ring-white/15 backdrop-blur">
              {initials(technician.name)}
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-white/50">Portal técnico</p>
              <p className="text-lg font-semibold tracking-tight">{technician.name}</p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-3 text-center">
            <Stat label="Clientes" value={clients.length} />
            <Stat label="Sucursales" value={totalLocations} />
            <Stat label="Equipos" value={totalEquipment} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-6 sm:py-8">
        {/* Primary CTA */}
        <Link
          href={`/t/${token}/new`}
          className="group flex items-center gap-4 rounded-2xl bg-slate-900 p-5 text-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg"
        >
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
            <Plus className="size-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold">Crear nuevo reporte</p>
            <p className="text-sm text-white/60">
              Capturá fotos, voz y notas — la IA arma el borrador
            </p>
          </div>
          <ChevronRight className="size-5 text-white/60 transition-transform group-hover:translate-x-1" />
        </Link>

        {/* Drafts in progress */}
        {drafts.length > 0 ? (
          <section className="mt-8">
            <header className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Hourglass className="size-4 text-amber-600" />
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700">
                  En progreso
                </h2>
                <span className="text-xs text-slate-500">{drafts.length}</span>
              </div>
            </header>
            <div className="space-y-2">
              {drafts.map((d) => (
                <DraftCard key={d.id} draft={d} token={token} />
              ))}
            </div>
          </section>
        ) : null}

        {/* Recent submissions */}
        <section className="mt-8">
          <header className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-emerald-600" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700">
                Reportes enviados
              </h2>
              {submitted.length > 0 ? (
                <span className="text-xs text-slate-500">{submitted.length}</span>
              ) : null}
            </div>
          </header>
          {submitted.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-10 text-center">
              <Wrench className="mx-auto mb-2 size-6 text-slate-300" />
              <p className="text-sm text-slate-500">Aún no enviaste reportes</p>
              <p className="mt-1 text-xs text-slate-400">
                Tus reportes enviados y publicados aparecerán acá
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {submitted.map((r) => (
                <SubmittedCard key={r.id} report={r} token={token} />
              ))}
            </div>
          )}
        </section>

        {/* Clients quick access */}
        {clients.length > 0 ? (
          <section className="mt-10">
            <header className="mb-3 flex items-center gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700">
                Clientes asignados
              </h2>
              <span className="text-xs text-slate-500">{clients.length}</span>
            </header>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {clients.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3"
                >
                  <div
                    className="flex size-10 items-center justify-center rounded-lg text-sm font-bold text-white"
                    style={{ backgroundColor: c.brand_color ?? "#0EA5E9" }}
                  >
                    {initials(c.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{c.name}</p>
                    <p className="text-xs text-slate-500">
                      {c.locations.length} sucursal{c.locations.length === 1 ? "" : "es"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 backdrop-blur">
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-white/60">{label}</p>
    </div>
  );
}

function DraftCard({ draft, token }: { draft: TechnicianDraft; token: string }) {
  const accent = REPORT_TYPE_COLOR[draft.report_type];
  return (
    <Link
      href={`/t/${token}/reports/${draft.id}`}
      className="group block overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/40 transition-all hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-start gap-3 p-4">
        <div
          className="flex size-11 shrink-0 items-center justify-center rounded-xl text-white"
          style={{ backgroundColor: accent }}
        >
          <ReportTypeIcon type={draft.report_type} className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-semibold text-slate-900">{draft.client_name}</p>
            {draft.ai_draft_at ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700 ring-1 ring-inset ring-violet-600/20">
                <Sparkles className="size-2.5" />
                IA listo
              </span>
            ) : null}
          </div>
          <p className="text-xs text-slate-500">
            {draft.location_name ?? "Todas las sucursales"} ·{" "}
            {REPORT_TYPE_LABEL_SHORT[draft.report_type]}
          </p>
          <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" />
              Editado {relativeFromNow(draft.updated_at)}
            </span>
            <span>·</span>
            <span>
              {draft.capture_count} captura{draft.capture_count === 1 ? "" : "s"}
            </span>
            {draft.item_count > 0 ? (
              <>
                <span>·</span>
                <span>{draft.item_count} equipos</span>
              </>
            ) : null}
          </div>
        </div>
        <ChevronRight className="size-5 shrink-0 text-slate-300 transition-transform group-hover:translate-x-1" />
      </div>
    </Link>
  );
}

function SubmittedCard({ report, token }: { report: TechnicianSubmitted; token: string }) {
  const accent = REPORT_TYPE_COLOR[report.report_type];
  const statusLabel: Record<typeof report.status, string> = {
    draft: "En revisión",
    published: "Publicado",
    accepted: "Aceptado",
  };
  const statusTint: Record<typeof report.status, string> = {
    draft: "bg-amber-50 text-amber-700 ring-amber-600/20",
    published: "bg-blue-50 text-blue-700 ring-blue-600/20",
    accepted: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  };
  return (
    <Link
      href={`/t/${token}/reports/${report.id}`}
      className="group block overflow-hidden rounded-2xl border border-slate-200 bg-white transition-all hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-start gap-3 p-4">
        <div
          className="flex size-10 shrink-0 items-center justify-center rounded-xl text-white"
          style={{ backgroundColor: accent }}
        >
          <ReportTypeIcon type={report.report_type} className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-semibold text-slate-900">{report.client_name}</p>
            <span
              className={cn(
                "inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset",
                statusTint[report.status],
              )}
            >
              {statusLabel[report.status]}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            {report.location_name ?? "—"} ·{" "}
            {REPORT_TYPE_LABEL_SHORT[report.report_type]}
          </p>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
            <Calendar className="size-3" />
            {formatDateLong(report.performed_at_start)}
          </div>
        </div>
      </div>
    </Link>
  );
}
