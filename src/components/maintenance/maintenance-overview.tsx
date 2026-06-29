import Link from "next/link";
import {
  Building2,
  Boxes,
  CheckCircle2,
  AlertTriangle,
  XOctagon,
  AlertOctagon,
  Calendar,
  ChevronRight,
  TrendingUp,
  ClipboardCheck,
  Tag,
  Clock,
  ArrowRight,
} from "lucide-react";
import {
  STATUS_COLOR,
  CATEGORY_LABEL,
  REPORT_TYPE_COLOR,
  REPORT_TYPE_LABEL_SHORT,
  imageUrl,
  type EquipmentStatus,
} from "@/lib/maintenance/types";
import { ReportTypeIcon } from "@/components/maintenance/report-type-badge";
import { StackedStatusBar } from "@/components/maintenance/charts";
import { getMaintenanceSummary, colorForScore, one } from "@/lib/maintenance/summary";
import { cn } from "@/lib/utils";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-PA", { day: "2-digit", month: "short", year: "numeric" });
}
function initials(name: string): string {
  return name.split(/\s+/).map((s) => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

export async function MaintenanceOverview({ orgId }: { orgId: string }) {
  const m = await getMaintenanceSummary(orgId);
  const { globalCounts, totalEquipment, globalHealth, clientSummaries, reports, schedules } = m;

  return (
    <div className="mt-8 space-y-8">
      {/* KPI Strip */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        <KpiCard label="Clientes" value={m.clients.length} icon={Building2} accent="#0F172A" href="/clientes" />
        <KpiCard label="Equipos" value={totalEquipment} icon={Boxes} accent="#0F172A" hint={`${m.totalLocations} sucursales`} />
        <KpiCard label="Salud global" value={`${globalHealth}%`} icon={TrendingUp} accent={colorForScore(globalHealth)} hint={`${globalCounts.operativo} operativos`} />
        <KpiCard
          label="Alertas"
          value={globalCounts.atencion + globalCounts.critico}
          icon={AlertTriangle}
          accent={globalCounts.critico > 0 ? STATUS_COLOR.critico : globalCounts.atencion > 0 ? STATUS_COLOR.atencion : "#10B981"}
          hint={globalCounts.critico > 0 ? `${globalCounts.critico} crítico${globalCounts.critico === 1 ? "" : "s"}` : globalCounts.atencion > 0 ? `${globalCounts.atencion} atención` : "Todo operativo"}
        />
        <KpiCard label="Vencidos" value={m.overdueSchedules.length} icon={AlertOctagon} accent={m.overdueSchedules.length > 0 ? "#EF4444" : "#10B981"} hint={`${m.thisWeekSchedules.length} esta semana`} href="/cronograma" />
      </section>

      {/* Distribution + urgent actions */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Distribución de estados</h2>
            <p className="text-xs text-slate-500">{totalEquipment} equipos en total</p>
          </div>
          {totalEquipment === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">Sin equipos cargados todavía</p>
          ) : (
            <>
              <StackedStatusBar counts={globalCounts} />
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                {(
                  [
                    ["operativo", "Operativo", CheckCircle2],
                    ["atencion", "Atención", AlertTriangle],
                    ["critico", "Crítico", XOctagon],
                    ["fuera_de_servicio", "Fuera servicio", AlertOctagon],
                    ["sin_inspeccion", "Sin inspección", Clock],
                  ] as [EquipmentStatus, string, typeof CheckCircle2][]
                ).map(([k, label, Icon]) => (
                  <div key={k} className="rounded-lg bg-slate-50 p-3">
                    <div className="flex items-center gap-1.5">
                      <Icon className="size-3.5" style={{ color: STATUS_COLOR[k] }} />
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
                    </div>
                    <p className="mt-1 text-xl font-bold tabular-nums" style={{ color: STATUS_COLOR[k] }}>
                      {globalCounts[k]}
                    </p>
                    <p className="text-[11px] text-slate-500 tabular-nums">
                      {totalEquipment > 0 ? Math.round((globalCounts[k] / totalEquipment) * 100) : 0}%
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center gap-2">
            <AlertOctagon className="size-4 text-red-600" />
            <h2 className="text-sm font-semibold text-slate-700">Acciones urgentes</h2>
          </div>
          <ul className="space-y-2">
            <ActionRow count={m.overdueSchedules.length} label="Mantenimientos vencidos" href="/cronograma" tint={m.overdueSchedules.length > 0 ? "red" : "neutral"} />
            <ActionRow count={globalCounts.critico} label="Equipos críticos" href="/clientes" tint={globalCounts.critico > 0 ? "red" : "neutral"} />
            <ActionRow count={m.draftReportsCount} label="Reportes en revisión" href="/reportes?status=draft" tint={m.draftReportsCount > 0 ? "amber" : "neutral"} />
            <ActionRow count={m.thisWeekSchedules.length} label="Próximos esta semana" href="/cronograma" tint="blue" />
          </ul>
        </div>
      </section>

      {/* Clients health table */}
      <section>
        <header className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-slate-900">Salud por cliente ({clientSummaries.length})</h2>
            <p className="text-xs text-slate-500">Ordenados por urgencia (críticos primero)</p>
          </div>
          <Link href="/clientes" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-700 hover:text-slate-900">
            Ver todos
            <ArrowRight className="size-3.5" />
          </Link>
        </header>

        {clientSummaries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center">
            <Building2 className="mx-auto mb-2 size-6 text-slate-400" />
            <p className="text-sm font-medium">Sin clientes aún</p>
            <Link href="/clientes/new" className="mt-3 inline-flex items-center gap-1 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
              Crear cliente
              <ChevronRight className="size-4" />
            </Link>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-slate-50/50 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3">Cliente</th>
                    <th className="px-3 py-3 text-center">Sucursales</th>
                    <th className="px-3 py-3 text-center">Equipos</th>
                    <th className="px-3 py-3">Distribución</th>
                    <th className="px-3 py-3 text-center">Salud</th>
                    <th className="px-3 py-3">Próximo</th>
                    <th className="px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {clientSummaries.map((c) => (
                    <tr key={c.id} className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50/50">
                      <td className="px-4 py-3">
                        <Link href={`/clientes/${c.id}`} className="flex items-center gap-3">
                          {c.logo_path ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={imageUrl(c.logo_path)} alt={c.name} className="size-9 shrink-0 rounded-lg object-cover ring-1 ring-slate-200" />
                          ) : (
                            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ backgroundColor: c.brand_color ?? "#0EA5E9" }}>
                              {initials(c.name)}
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900">{c.name}</p>
                            {c.category ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-1.5 py-0 text-[10px] font-medium text-blue-700">
                                <Tag className="size-2.5" />
                                {CATEGORY_LABEL[c.category]}
                              </span>
                            ) : null}
                          </div>
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-center tabular-nums text-slate-700">{c.locationsCount}</td>
                      <td className="px-3 py-3 text-center tabular-nums text-slate-700">{c.equipmentCount}</td>
                      <td className="px-3 py-3">
                        {c.equipmentCount > 0 ? <div className="w-32"><StackedStatusBar counts={c.counts} /></div> : <span className="text-xs text-slate-400">—</span>}
                      </td>
                      <td className="px-3 py-3 text-center">
                        {c.equipmentCount > 0 ? (
                          <span className="inline-flex items-baseline gap-0.5 rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ring-1 ring-inset" style={{ backgroundColor: `${colorForScore(c.health)}15`, color: colorForScore(c.health), borderColor: colorForScore(c.health) }}>
                            {c.health}
                            <span className="text-[10px] opacity-70">%</span>
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-slate-600">{formatDate(c.nextSchedule)}</td>
                      <td className="px-3 py-3 text-right">
                        <Link href={`/clientes/${c.id}`} className="text-slate-400 hover:text-slate-700">
                          <ChevronRight className="size-4" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Recent reports + upcoming */}
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card">
          <header className="flex items-center justify-between border-b border-border px-5 py-3">
            <div className="flex items-center gap-2">
              <ClipboardCheck className="size-4 text-slate-700" />
              <h2 className="text-sm font-semibold">Reportes recientes</h2>
            </div>
            <Link href="/reportes" className="text-xs font-semibold text-slate-600 hover:text-slate-900">Ver todos →</Link>
          </header>
          {reports.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">Sin reportes aún</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {reports.slice(0, 5).map((r) => (
                <li key={r.id}>
                  <Link href={`/reportes/${r.id}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-slate-50">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white" style={{ backgroundColor: REPORT_TYPE_COLOR[r.report_type] }}>
                      <ReportTypeIcon type={r.report_type} className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">{one(r.client)?.name ?? "—"}</p>
                      <p className="text-xs text-slate-500">
                        {REPORT_TYPE_LABEL_SHORT[r.report_type]}
                        {one(r.location) ? ` · ${one(r.location)!.name}` : ""} · {formatDate(r.performed_at_start)}
                      </p>
                    </div>
                    <span className={cn("inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset", r.status === "draft" ? "bg-amber-50 text-amber-700 ring-amber-600/20" : r.status === "published" ? "bg-blue-50 text-blue-700 ring-blue-600/20" : "bg-emerald-50 text-emerald-700 ring-emerald-600/20")}>
                      {r.status === "draft" ? "En revisión" : r.status === "published" ? "Publicado" : "Aceptado"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card">
          <header className="flex items-center justify-between border-b border-border px-5 py-3">
            <div className="flex items-center gap-2">
              <Calendar className="size-4 text-slate-700" />
              <h2 className="text-sm font-semibold">Próximos servicios</h2>
            </div>
            <Link href="/cronograma" className="text-xs font-semibold text-slate-600 hover:text-slate-900">Ver cronograma →</Link>
          </header>
          {schedules.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">Sin mantenimientos programados</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {schedules.slice(0, 5).map((s) => {
                const overdue = new Date(s.next_due_date) < new Date();
                return (
                  <li key={s.id}>
                    <Link href={`/clientes/${s.client_id}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-slate-50">
                      <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", overdue ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700")}>
                        <Calendar className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">{one(s.client)?.name ?? "—"}</p>
                        <p className="text-xs text-slate-500">
                          {one(s.location)?.name ?? "—"} · {REPORT_TYPE_LABEL_SHORT[s.report_type]}
                          {one(s.technician)?.name ? ` · ${one(s.technician)!.name}` : ""}
                        </p>
                      </div>
                      <span className={cn("text-xs", overdue ? "font-semibold text-red-600" : "text-slate-600")}>{formatDate(s.next_due_date)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {m.techsCount > 0 ? (
        <section className="rounded-2xl border border-border bg-card px-5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <p className="text-slate-700">
              <strong>{m.techsCount}</strong> miembro{m.techsCount === 1 ? "" : "s"} de personal activo
            </p>
            <Link href="/personal" className="text-xs font-semibold text-slate-600 hover:text-slate-900">Gestionar equipo →</Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  accent,
  href,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  href?: string;
}) {
  const inner = (
    <div className={cn("rounded-2xl border border-border bg-card p-4", href && "transition-colors hover:border-slate-300 hover:bg-slate-50/50")}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="flex size-7 items-center justify-center rounded-lg" style={{ backgroundColor: `${accent}1f`, color: accent }}>
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900 tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function ActionRow({ count, label, href, tint }: { count: number; label: string; href: string; tint: "red" | "amber" | "blue" | "neutral" }) {
  const tintCls =
    tint === "red" && count > 0
      ? "bg-red-50 text-red-700"
      : tint === "amber" && count > 0
        ? "bg-amber-50 text-amber-700"
        : tint === "blue" && count > 0
          ? "bg-blue-50 text-blue-700"
          : "bg-slate-50 text-slate-500";
  return (
    <li>
      <Link href={href} className="flex items-center justify-between rounded-lg px-3 py-2 transition-colors hover:bg-slate-50">
        <span className="text-sm text-slate-700">{label}</span>
        <span className={cn("flex min-w-7 items-center justify-center rounded-full px-2 py-0.5 text-xs font-bold tabular-nums", tintCls)}>{count}</span>
      </Link>
    </li>
  );
}
