import { notFound } from "next/navigation";
import Link from "next/link";
import {
  CheckCircle2,
  AlertTriangle,
  XOctagon,
  Boxes,
  Calendar,
  Phone,
  Mail,
  MessageCircle,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowRight,
  ShieldCheck,
  MapPin,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  aggregateStatus,
  healthScore,
  trendDelta,
  STATUS_COLOR,
  type DashboardData,
  type EquipmentStatus,
} from "@/lib/maintenance/types";
import { HealthRing } from "@/components/maintenance/health-ring";
import { StackedStatusBar } from "@/components/maintenance/charts";
import { EquipmentCard } from "@/components/maintenance/equipment-card";
import { StatusDot } from "@/components/maintenance/status-badge";
import { ReportCard } from "@/components/maintenance/report-card";
import { HistoryHeatmap } from "@/components/maintenance/history-heatmap";
import { imageUrl } from "@/lib/maintenance/types";

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

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
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
  const score = healthScore(counts);
  const trend = trendDelta(reports);

  const lastReport = reports[0];
  const nextService = reports.find((r) => r.next_service_date)?.next_service_date ?? null;
  const accent = client.brand_color ?? "#0EA5E9";

  return (
    <>
      {/* HERO — dark gradient with brand accent */}
      <section className="relative overflow-hidden bg-slate-950 text-white">
        {/* Decorative gradient blobs */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-40 -top-40 size-[500px] rounded-full opacity-30 blur-3xl"
          style={{ backgroundColor: accent }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -left-40 size-[400px] rounded-full bg-blue-500 opacity-20 blur-3xl"
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.04),transparent_60%)]"
        />

        <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
          {/* Top bar */}
          <div className="flex items-center justify-between py-6">
            <div className="flex items-center gap-3">
              {client.logo_path ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageUrl(client.logo_path)}
                  alt={client.name}
                  className="size-11 rounded-xl object-cover ring-2 ring-white/10"
                />
              ) : (
                <div
                  className="flex size-11 items-center justify-center rounded-xl text-base font-bold text-white shadow-lg ring-2 ring-white/10"
                  style={{ backgroundColor: accent }}
                >
                  {initials(client.name)}
                </div>
              )}
              <div>
                <p className="text-sm font-semibold tracking-tight text-white">{client.name}</p>
                <p className="text-xs text-white/50">Portal de mantenimiento</p>
              </div>
            </div>
            <div className="hidden items-center gap-2 rounded-full bg-white/5 px-3 py-1.5 text-xs text-white/70 ring-1 ring-white/10 backdrop-blur sm:inline-flex">
              <ShieldCheck className="size-3.5 text-emerald-400" />
              Servicio prestado por <span className="font-semibold text-white">DICEC, INC</span>
            </div>
          </div>

          {/* Main hero content */}
          <div className="grid gap-10 pb-16 pt-8 lg:grid-cols-12 lg:gap-12 lg:pb-20 lg:pt-10">
            {/* Left: title + ring */}
            <div className="lg:col-span-5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/50">
                Estado actual
              </p>
              <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
                Estado de tus equipos
              </h1>
              <p className="mt-3 max-w-md text-sm text-white/60">
                {lastReport
                  ? `Última actualización: ${formatDateLong(lastReport.performed_at_start)}`
                  : "Sin reportes publicados aún"}
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-6">
                <HealthRing score={score} size={180} />
                <div className="flex flex-col gap-2">
                  {trend ? (
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
                          trend.delta > 0
                            ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30"
                            : trend.delta < 0
                              ? "bg-red-500/15 text-red-300 ring-1 ring-red-400/30"
                              : "bg-white/10 text-white/70 ring-1 ring-white/20"
                        }`}
                      >
                        {trend.delta > 0 ? (
                          <TrendingUp className="size-3" />
                        ) : trend.delta < 0 ? (
                          <TrendingDown className="size-3" />
                        ) : (
                          <Minus className="size-3" />
                        )}
                        {trend.delta > 0 ? "+" : ""}
                        {trend.delta} pts
                      </span>
                      <span className="text-xs text-white/60">vs reporte anterior</span>
                    </div>
                  ) : null}
                  <p className="max-w-[10rem] text-xs leading-relaxed text-white/60">
                    Calculado a partir del último estado de cada equipo
                  </p>
                </div>
              </div>
            </div>

            {/* Right: stat cards */}
            <div className="lg:col-span-7">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <HeroStat
                  label="Equipos"
                  value={total}
                  hint={`${locations.length} sucursal${locations.length === 1 ? "" : "es"}`}
                  icon={Boxes}
                  iconColor="rgba(255,255,255,0.7)"
                />
                <HeroStat
                  label="Operativos"
                  value={counts.operativo}
                  hint={`${total > 0 ? Math.round((counts.operativo / total) * 100) : 0}%`}
                  icon={CheckCircle2}
                  iconColor={STATUS_COLOR.operativo}
                />
                <HeroStat
                  label="Atención"
                  value={counts.atencion}
                  hint={`${total > 0 ? Math.round((counts.atencion / total) * 100) : 0}%`}
                  icon={AlertTriangle}
                  iconColor={STATUS_COLOR.atencion}
                />
                <HeroStat
                  label="Críticos"
                  value={counts.critico}
                  hint={`${total > 0 ? Math.round((counts.critico / total) * 100) : 0}%`}
                  icon={XOctagon}
                  iconColor={STATUS_COLOR.critico}
                  pulse={counts.critico > 0}
                />
              </div>

              {/* Distribution bar */}
              <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-white/60">
                    Distribución global
                  </p>
                  <p className="text-xs text-white/50">{total} equipos en total</p>
                </div>
                <StackedStatusBar counts={counts} />
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-white/70">
                  {(["operativo", "atencion", "critico", "fuera_de_servicio", "sin_inspeccion"] as EquipmentStatus[])
                    .filter((k) => counts[k] > 0)
                    .map((k) => (
                      <span key={k} className="inline-flex items-center gap-1.5">
                        <StatusDot status={k} />
                        <span className="font-semibold tabular-nums">{counts[k]}</span>
                        <span className="capitalize text-white/50">
                          {k.replace("_", " ")}
                        </span>
                      </span>
                    ))}
                </div>
              </div>

              {/* Quick action chips */}
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={`/p/${token}/reports`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-100"
                >
                  Ver todos los reportes
                  <ArrowRight className="size-4" />
                </Link>
                {nextService ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-sm text-white/80 ring-1 ring-white/20">
                    <Calendar className="size-4 text-emerald-300" />
                    Próximo servicio: {formatDateShort(nextService)}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* BODY */}
      <main className="mx-auto max-w-7xl px-6 py-10 lg:px-8 lg:py-14">
        {/* Equipment by location */}
        <section>
          <header className="mb-6 flex items-end justify-between">
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                Equipos por sucursal
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Estado actual de cada equipo basado en su última inspección
              </p>
            </div>
            <p className="hidden text-sm font-medium text-slate-500 sm:block">
              {locations.length} sucursal{locations.length === 1 ? "" : "es"} · {total} equipos
            </p>
          </header>

          <div className="space-y-10">
            {locations.map((loc) => {
              const locCounts = aggregateStatus(loc.equipment);
              const locScore = healthScore(locCounts);
              return (
                <div key={loc.id}>
                  <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-3">
                    <div className="flex items-start gap-3">
                      <div className="mt-1 flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                        <MapPin className="size-4" />
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold tracking-tight text-slate-900">
                          {loc.name}
                        </h3>
                        <p className="text-xs text-slate-500">
                          {loc.equipment.length} equipo{loc.equipment.length === 1 ? "" : "s"}
                          {loc.address ? ` · ${loc.address}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-3 text-xs">
                        {locCounts.operativo > 0 ? (
                          <span className="flex items-center gap-1 font-medium text-emerald-700">
                            <StatusDot status="operativo" />
                            {locCounts.operativo}
                          </span>
                        ) : null}
                        {locCounts.atencion > 0 ? (
                          <span className="flex items-center gap-1 font-medium text-amber-700">
                            <StatusDot status="atencion" />
                            {locCounts.atencion}
                          </span>
                        ) : null}
                        {locCounts.critico > 0 ? (
                          <span className="flex items-center gap-1 font-medium text-red-700">
                            <StatusDot status="critico" />
                            {locCounts.critico}
                          </span>
                        ) : null}
                      </div>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold tabular-nums text-slate-700">
                        {locScore}% salud
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {loc.equipment.map((e) => (
                      <EquipmentCard key={e.id} equipment={e} href={`/p/${token}/equipment/${e.id}`} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Heatmap of equipment history */}
        <section className="mt-12">
          <header className="mb-5">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">
              Mapa histórico
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Ve de un vistazo cómo evolucionó el estado de cada equipo a lo largo del tiempo
            </p>
          </header>
          <HistoryHeatmap locations={locations} token={token} />
        </section>

        {/* Reports timeline */}
        <section className="mt-16">
          <header className="mb-6 flex items-end justify-between">
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                Reportes recientes
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Últimos {Math.min(reports.length, 4)} reportes publicados
              </p>
            </div>
            {reports.length > 4 ? (
              <Link
                href={`/p/${token}/reports`}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700 hover:text-slate-900"
              >
                Ver todos
                <ArrowRight className="size-4" />
              </Link>
            ) : null}
          </header>

          <div className="space-y-3">
            {reports.slice(0, 4).map((r) => (
              <ReportCard key={r.id} report={r} href={`/p/${token}/reports/${r.id}`} />
            ))}
          </div>
        </section>

        {/* Contact + next service */}
        {lastReport ? (
          <section className="mt-16 grid gap-4 lg:grid-cols-3">
            {lastReport.performed_by_name ? (
              <ContactCard
                title="Técnico de mantenimiento"
                name={lastReport.performed_by_name}
                role="Técnico Supervisor"
                phone={
                  (lastReport as { performed_by_phone?: string | null }).performed_by_phone ?? null
                }
                email={null}
              />
            ) : null}
            {lastReport.engineer_name ? (
              <ContactCard
                title="Ingeniero encargado"
                name={lastReport.engineer_name}
                role="Ingeniero Supervisor"
                phone={
                  (lastReport as { engineer_phone?: string | null }).engineer_phone ?? null
                }
                email={
                  (lastReport as { engineer_email?: string | null }).engineer_email ?? null
                }
              />
            ) : null}
            {nextService ? (
              <div
                className="relative flex flex-col overflow-hidden rounded-2xl p-6 text-white"
                style={{
                  background: `linear-gradient(135deg, ${accent} 0%, ${accent}cc 100%)`,
                }}
              >
                <div className="flex items-center gap-2 text-white/90">
                  <Calendar className="size-5" />
                  <p className="text-sm font-semibold">Próximo mantenimiento</p>
                </div>
                <p className="mt-3 text-3xl font-bold tabular-nums">
                  {formatDateShort(nextService)}
                </p>
                <p className="mt-1 text-sm text-white/80">
                  Programado según cronograma preventivo
                </p>
                <div
                  aria-hidden
                  className="absolute -right-6 -bottom-6 size-32 rounded-full bg-white/10"
                />
              </div>
            ) : null}
          </section>
        ) : null}

        <footer className="mt-14 border-t border-slate-200 pt-6 text-center">
          <p className="text-sm font-medium text-slate-700">
            ¡Gracias por confiar en nuestro servicio!
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Este portal se actualiza automáticamente con cada nuevo reporte de mantenimiento.
          </p>
        </footer>
      </main>
    </>
  );
}

function HeroStat({
  label,
  value,
  hint,
  icon: Icon,
  iconColor,
  pulse = false,
}: {
  label: string;
  value: number;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  pulse?: boolean;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur transition-colors hover:bg-white/10">
      <div className="flex items-start justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-white/60">{label}</p>
        <div
          className="flex size-7 items-center justify-center rounded-lg ring-1 ring-white/10"
          style={{ backgroundColor: `${iconColor}20`, color: iconColor }}
        >
          <Icon className="size-4" />
          {pulse ? (
            <span
              aria-hidden
              className="absolute right-2 top-2 inline-flex size-3 animate-ping rounded-full"
              style={{ backgroundColor: iconColor, opacity: 0.4 }}
            />
          ) : null}
        </div>
      </div>
      <p
        className="mt-3 text-3xl font-bold tabular-nums"
        style={{ color: pulse ? iconColor : "white" }}
      >
        {value}
      </p>
      <p className="mt-0.5 text-xs text-white/50">{hint}</p>
    </div>
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
  const initials = name
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</p>
      <div className="mt-3 flex items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
          {initials}
        </div>
        <div>
          <p className="text-base font-semibold text-slate-900">{name}</p>
          <p className="text-sm text-slate-500">{role}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {phone ? (
          <a
            href={`https://wa.me/${phone.replace(/\D/g, "")}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700"
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
