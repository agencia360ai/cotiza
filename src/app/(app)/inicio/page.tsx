import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgContext } from "@/lib/org-context";
import { seccionesVisibles } from "@/lib/secciones";
import { pipelineDerived } from "@/lib/pipeline/types";
import { getPipelineData } from "@/lib/pipeline/queries";
import { getMaintenanceSummary } from "@/lib/maintenance/summary";
import { getQboProjects } from "@/app/(app)/proyectos/qbo-actions";
import { overviewProject, type OverviewExtras } from "@/lib/inicio/overview";
import { BusinessOverview } from "@/components/inicio/business-overview";

export const dynamic = "force-dynamic";

export default async function InicioDashboard() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const ctx = await getActiveOrgContext();
  if (!ctx) redirect("/onboarding");
  const sections = seccionesVisibles(ctx.role, ctx.secciones);
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Panama",
  });
  const year = Number(today.slice(0, 4));
  const orgId = ctx.orgId;
  const can = (section: (typeof sections)[number]) =>
    sections.includes(section);

  const [qbo, pipeline, maint, leads, tenders] = await Promise.all([
    getQboProjects({ allYears: true }).catch(() => ({
      ok: false as const,
      error: "No se pudieron cargar los proyectos.",
    })),
    can("cotizaciones") ? getPipelineData(orgId, year, { throwOnError: true }).catch(() => null) : null,
    can("mantenimiento")
      ? getMaintenanceSummary(orgId).catch(() => null)
      : null,
    can("leads")
      ? Promise.all([
          supabase
            .from("leads")
            .select("id", { count: "exact", head: true })
            .eq("org_id", orgId)
            .not("status", "in", "(perdido,ganado)"),
          supabase
            .from("leads")
            .select("id", { count: "exact", head: true })
            .eq("org_id", orgId)
            .eq("status", "nuevo"),
          supabase
            .from("leads")
            .select("id", { count: "exact", head: true })
            .eq("org_id", orgId)
            .eq("status", "en_seguimiento"),
        ]).catch(() => null)
      : null,
    can("licitaciones")
      ? supabase
          .from("tenders")
          .select("status, amount_ref_usd")
          .eq("org_id", orgId)
          .in("status", ["ganada", "orden_proceder"])
          .is("archived_at", null)
          .is("qbo_job_id", null)
          .is("converted_project_id", null)
          .then((result) => result, () => null)
      : null,
  ]);
  const d = pipeline ? pipelineDerived(pipeline) : null;
  const extras: OverviewExtras = {
    tender:
      tenders && !tenders.error
        ? {
            amount: (tenders.data ?? []).reduce(
              (sum, t) => sum + Number(t.amount_ref_usd ?? 0),
              0,
            ),
            won: (tenders.data ?? []).filter((t) => t.status === "ganada")
              .length,
            proceed: (tenders.data ?? []).filter(
              (t) => t.status === "orden_proceder",
            ).length,
          }
        : null,
    leads:
      leads && leads.every((r) => !r.error)
        ? {
            total: leads[0].count ?? 0,
            fresh: leads[1].count ?? 0,
            following: leads[2].count ?? 0,
          }
        : null,
    quotes: d
      ? {
          sent: d.enviadaCount,
          amount: d.enviadaMonto,
          approved: d.aprobadoCount,
        }
      : null,
    maintenance: maint
      ? {
          equipment: maint.totalEquipment,
          overdue: maint.overdueSchedules.length,
          attention:
            maint.globalCounts.atencion +
            maint.globalCounts.critico +
            maint.globalCounts.fuera_de_servicio,
          week: maint.thisWeekSchedules.length,
        }
      : null,
  };

  return (
    <BusinessOverview
      projects={qbo.ok ? qbo.projects.map(overviewProject) : []}
      syncedAt={qbo.ok ? qbo.syncedAt : null}
      unavailable={!qbo.ok}
      today={today}
      extras={extras}
      sections={sections}
    />
  );
}
