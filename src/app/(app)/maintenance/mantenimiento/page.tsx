import Link from "next/link";
import { ClipboardCheck, Calendar, Boxes, AlertOctagon, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { MaintenanceOverview } from "@/components/maintenance/maintenance-overview";

export const dynamic = "force-dynamic";

export default async function MantenimientoHubPage() {
  const supabase = await createClient();
  const orgId = await getActiveOrgId();

  let reportCount = 0;
  let upcomingCount = 0;
  let equipmentCount = 0;
  let attentionCount = 0;

  if (orgId) {
    const today = new Date().toISOString().slice(0, 10);
    const horizon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const [reports, schedules, equipment, attention] = await Promise.all([
      supabase.from("maintenance_reports").select("id", { count: "exact", head: true }).eq("org_id", orgId),
      supabase
        .from("maintenance_schedules")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .gte("next_due_date", today)
        .lte("next_due_date", horizon),
      supabase
        .from("client_equipment")
        .select("id, location:client_locations!inner(client:clients!inner(org_id))", { count: "exact", head: true })
        .eq("location.client.org_id", orgId),
      supabase
        .from("report_items")
        .select("equipment_id, report:maintenance_reports!inner(org_id)", { count: "exact", head: true })
        .eq("report.org_id", orgId)
        .in("equipment_status", ["atencion", "critico", "fuera_de_servicio"]),
    ]);
    reportCount = reports.count ?? 0;
    upcomingCount = schedules.count ?? 0;
    equipmentCount = equipment.count ?? 0;
    attentionCount = attention.count ?? 0;
  }

  const cards = [
    {
      href: "/maintenance/reports",
      label: "Reportes",
      desc: "Reportes de mantenimiento e inspección, con export PDF.",
      icon: ClipboardCheck,
      accent: "#2563EB",
      stat: `${reportCount} reporte${reportCount === 1 ? "" : "s"}`,
    },
    {
      href: "/maintenance/schedule",
      label: "Cronograma",
      desc: "Servicios programados por cliente, sucursal y técnico.",
      icon: Calendar,
      accent: "#F97316",
      stat: `${upcomingCount} en los próximos 30 días`,
    },
    {
      href: "/maintenance/clients",
      label: "Equipos",
      desc: "Inventario de equipos HVAC y su estado actual.",
      icon: Boxes,
      accent: "#10B981",
      stat: `${equipmentCount} equipo${equipmentCount === 1 ? "" : "s"}`,
    },
    {
      href: "/maintenance/reports",
      label: "Casos / Atención",
      desc: "Equipos que requieren atención, crítico o fuera de servicio.",
      icon: AlertOctagon,
      accent: "#EF4444",
      stat: `${attentionCount} requiere${attentionCount === 1 ? "" : "n"} acción`,
    },
  ];

  return (
    <div className="px-4 py-6 md:px-10 md:py-8 max-w-7xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Mantenimiento</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Todo lo recurrente: reportes, cronograma, estado de equipos y casos.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <Link
              key={c.label}
              href={c.href}
              className="group flex items-start gap-4 rounded-2xl border border-border bg-card p-5 transition-colors hover:border-slate-300 hover:bg-slate-50/50"
            >
              <span
                className="flex size-11 shrink-0 items-center justify-center rounded-xl"
                style={{ backgroundColor: `${c.accent}1f`, color: c.accent }}
              >
                <Icon className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-slate-900">{c.label}</h2>
                  <ChevronRight className="size-4 text-slate-300 transition-colors group-hover:text-slate-500" />
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">{c.desc}</p>
                <p className="mt-2 text-xs font-semibold" style={{ color: c.accent }}>
                  {c.stat}
                </p>
              </div>
            </Link>
          );
        })}
      </div>

      {orgId ? <MaintenanceOverview orgId={orgId} /> : null}
    </div>
  );
}
