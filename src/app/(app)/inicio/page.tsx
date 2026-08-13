import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Hammer,
  HeartPulse,
  Landmark,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgContext } from "@/lib/org-context";
import { pipelineDerived, formatMoney, type PipelineData } from "@/lib/pipeline/types";
import { getPipelineData } from "@/lib/pipeline/queries";
import { getMaintenanceSummary, colorForScore, type Maybe } from "@/lib/maintenance/summary";
import { STATUS_COLOR, STATUS_LABEL_SHORT as STATUS_LABEL } from "@/lib/maintenance/types";
import { LEAD_STATUS_LABEL, LEAD_STATUS_COLOR, type LeadStatus } from "@/lib/leads/types";
import { getQboProjects } from "@/app/(app)/proyectos/qbo-actions";
import type { QboProject } from "@/lib/quickbooks/projects";
import { CobroGastoChart, type MesCobroGasto } from "@/components/inicio/charts";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Paleta categórica del donut, validada (CVD-safe) sobre superficie clara:
// DC índigo · DM sky · DS emerald · DV amber. La identidad nunca es solo color
// (leyenda con etiquetas y %).
const DONUT_COLORS: Record<string, string> = { DC: "#6366F1", DM: "#0EA5E9", DS: "#10B981", DV: "#F59E0B" };
const RUBRO_LABEL: Record<string, string> = { DC: "Contratos", DM: "Mantenimiento", DS: "Servicio", DV: "Ventas" };

// Sweet spot por defecto del tamiz (el de la página de licitaciones es
// parametrizable por navegador; acá usamos el estándar DICEC).





export default async function InicioDashboard() {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) redirect("/login");

  const ctx = await getActiveOrgContext();
  const orgId = ctx?.orgId ?? "";
  const { data: org } = (await supabase
    .from("organizations")
    .select("focus")
    .eq("id", orgId)
    .maybeSingle()) as { data: { focus: "maintenance" | "projects" | "mixed" } | null };
  const focus = org?.focus ?? "mixed";
  const isProjects = focus === "projects";
  const year = new Date().getFullYear();

  const [pipeline, maint, qbo, { data: leadsData }, { data: adjudicadas }] = await Promise.all([
    isProjects ? Promise.resolve<PipelineData | null>(null) : getPipelineData(orgId, year),
    isProjects ? Promise.resolve(null) : getMaintenanceSummary(orgId),
    // Finanzas QBO desde la base (cero llamadas a QuickBooks al abrir).
    getQboProjects().catch(() => ({ ok: false as const, error: "" })),
    supabase.from("leads").select("status").eq("org_id", orgId) as unknown as Promise<{
      data: { status: LeadStatus }[] | null;
    }>,
    // Adjudicado: ganadas + orden de proceder. Backlog firmado que todavía NO
    // entró como cobro, por eso va aparte de los KPIs de QuickBooks.
    supabase
      .from("tenders")
      .select("status, amount_ref_usd")
      .eq("org_id", orgId)
      .in("status", ["ganada", "orden_proceder"])
      // Archivadas fuera: son procesos que el equipo ocultó, no backlog por entrar.
      .is("archived_at", null) as unknown as Promise<{
      data: { status: string; amount_ref_usd: number | null }[] | null;
    }>,
  ]);

  // Finanzas QBO del año (los números ya persistidos por "Actualizar" en
  // Proyectos: abrir Inicio no llama a QuickBooks).
  const qboProjects: QboProject[] = qbo.ok ? qbo.projects : [];
  const qboSyncedAt = qbo.ok ? qbo.syncedAt : null;
  const conNumeros = qboProjects.filter((p) => p.income !== null || p.cost !== null);
  const ingresos = conNumeros.reduce((a, p) => a + (p.income ?? 0), 0);
  const costos = conNumeros.reduce((a, p) => a + (p.cost ?? 0), 0);
  const margenGlobal = ingresos > 0 ? (ingresos - costos) / ingresos : null;
  const porCobrar = qboProjects.filter((p) => p.status === "por_cobrar");
  const porCobrarMonto = porCobrar.reduce((a, p) => a + (p.income ?? 0), 0);
  const topProyectos = [...conNumeros].sort((a, b) => (b.income ?? 0) - (a.income ?? 0)).slice(0, 6);
  const qboOpen = qboProjects.filter((p) => !p.closed).length;

  // Serie mensual del año: se suma el desglose que QuickBooks ya reportó por
  // proyecto. Los cerrados con números congelados no aportan meses, así que la
  // serie puede quedar por debajo del total — la tarjeta dice cuántos aportan.
  const serie: MesCobroGasto[] = Array.from({ length: 12 }, (_, m) => ({ mes: m, cobro: 0, gasto: 0 }));
  let conDesglose = 0;
  for (const p of qboProjects) {
    if (p.meses.length > 0) conDesglose += 1;
    for (const m of p.meses) {
      if (Number(m.month.slice(0, 4)) !== year) continue;
      const i = Number(m.month.slice(5, 7)) - 1;
      if (i < 0 || i > 11) continue;
      serie[i].cobro += m.income;
      serie[i].gasto += m.cost;
    }
  }
  const mesActual = Number(new Date().toLocaleDateString("en-CA", { timeZone: "America/Panama" }).slice(5, 7)) - 1;

  // Margen por rubro: dónde se factura vs. dónde efectivamente se gana.
  const porRubro = (["DC", "DM", "DS", "DV"] as const).map((k) => {
    const ps = qboProjects.filter((p) => p.rubro === k);
    const cobro = ps.reduce((a, p) => a + (p.income ?? 0), 0);
    const gasto = ps.reduce((a, p) => a + (p.cost ?? 0), 0);
    return {
      key: k,
      label: RUBRO_LABEL[k],
      color: DONUT_COLORS[k],
      count: ps.length,
      cobro,
      margen: cobro > 0 ? (cobro - gasto) / cobro : null,
    };
  });

  const maxRubro = Math.max(1, ...porRubro.map((r) => r.cobro));

  // Embudo de leads por etapa. El orden es el del recorrido comercial, no el
  // alfabético: se lee como un embudo o no se lee.
  const ETAPAS: LeadStatus[] = ["nuevo", "contactado", "en_seguimiento", "cotizado", "ganado"];
  const leadsVivos = (leadsData ?? []).filter((l) => l.status !== "perdido");
  const leadsTotal = leadsVivos.length;
  const embudo = ETAPAS.map((k) => ({
    key: k,
    label: LEAD_STATUS_LABEL[k],
    color: LEAD_STATUS_COLOR[k],
    n: leadsVivos.filter((l) => l.status === k).length,
  }));

  const adjudicado = (adjudicadas ?? []).reduce((a, t) => a + (t.amount_ref_usd ?? 0), 0);
  const nGanadas = (adjudicadas ?? []).filter((t) => t.status === "ganada").length;
  const nOrden = (adjudicadas ?? []).filter((t) => t.status === "orden_proceder").length;

  const d = pipeline ? pipelineDerived(pipeline) : null;

  return (
    <div className="min-h-full bg-canvas">
      {/* Header sticky del handoff: el título viaja con el scroll porque estas
          pantallas son largas y uno pierde de vista dónde está. */}
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/90 px-4 py-4 backdrop-blur md:px-8">
        <h1 className="text-[21px] font-bold tracking-[-0.03em] text-slate-900">Resumen del negocio</h1>
        <p className="text-xs text-slate-500">
          Proyectos primero
          {qboSyncedAt ? ` · QuickBooks actualizado ${haceCuanto(qboSyncedAt)}` : " · QuickBooks todavía sin sincronizar"}
        </p>
      </header>

      <div className="max-w-[1400px] px-4 py-6 md:px-8">
        <section className="mb-4 grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          {/* Tarjeta héroe: el negocio del año en una sola lectura. */}
          <div className="rounded-card border border-line bg-surface shadow-[0_1px_2px_rgba(15,23,42,.04)]">
            <div className="flex flex-wrap items-center gap-3 border-b border-line-soft px-5 py-4">
              <span className="flex size-[30px] shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
                <Hammer className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-[13px] font-bold text-slate-900">Proyectos · {year}</h2>
                <p className="text-[11px] text-slate-500">
                  {qboProjects.length} proyectos en el año · {qboOpen} abiertos · {conDesglose} con desglose mensual
                </p>
              </div>
              <Link
                href="/proyectos"
                className="shrink-0 whitespace-nowrap text-xs font-semibold text-blue-600 hover:text-blue-700"
              >
                Ver proyectos →
              </Link>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4">
              <HeroKpi label="Cobro" value={formatMoney(ingresos)} sub="facturado del año" />
              <HeroKpi label="Gasto" value={formatMoney(costos)} sub="costo registrado" />
              <HeroKpi
                label="Margen"
                value={margenGlobal !== null ? `${Math.round(margenGlobal * 100)}%` : "s/d"}
                sub={`${formatMoney(ingresos - costos)} utilidad`}
                tint="bg-[#F8FDFB]"
                color="#059669"
              />
              <HeroKpi
                label="Por cobrar"
                value={formatMoney(porCobrarMonto)}
                sub={`${porCobrar.length} pendiente${porCobrar.length === 1 ? "" : "s"}`}
                color="#B45309"
                sinBorde
              />
            </div>

            <div className="border-t border-line-soft px-5 py-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.09em] text-slate-500">Cobro vs. gasto por mes</h3>
                <div className="flex shrink-0 items-center gap-3 text-[11px] text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <span className="size-2 rounded-full bg-[#1E293B]" /> Cobro
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="size-2 rounded-full bg-[#F43F5E]" /> Gasto
                  </span>
                </div>
              </div>
              <CobroGastoChart data={serie} hastaMes={mesActual} />
            </div>
          </div>

          <div className="flex flex-col gap-4">
            {/* Margen por rubro: dónde se factura vs. dónde se gana. */}
            <div className="rounded-card border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,.04)]">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-[13px] font-bold text-slate-900">Margen por rubro</h2>
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.09em] text-slate-500">
                  Cobro · Margen
                </span>
              </div>
              <div className="space-y-2.5">
                {porRubro.map((r) => (
                  <div key={r.key}>
                    <div className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="inline-flex min-w-0 items-center gap-1.5">
                        <span className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: r.color }} />
                        <span className="truncate font-semibold text-slate-800">{r.label}</span>
                        <span className="shrink-0 text-slate-400">· {r.count}</span>
                      </span>
                      <span className="shrink-0 whitespace-nowrap tabular-nums">
                        <span className="font-bold text-slate-900">{formatMoney(r.cobro)}</span>
                        <span className={cn("ml-1 font-semibold", r.margen !== null && r.margen < 0.2 ? "text-amber-600" : "text-emerald-600")}>
                          · {r.margen !== null ? `${Math.round(r.margen * 100)}%` : "s/d"}
                        </span>
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.round((r.cobro / maxRubro) * 100)}%`, backgroundColor: r.color }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Adjudicado: firmado pero todavía sin facturar. Va aparte de los
                KPIs de arriba a propósito — sumarlo al cobro sería mentir. */}
            <div className="rounded-card border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,.04)]">
              <div className="mb-3 flex items-center gap-2.5">
                <span className="flex size-[30px] shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-700">
                  <Landmark className="size-4" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-[13px] font-bold text-slate-900">Adjudicado por entrar</h2>
                  <p className="text-[11px] text-slate-500">Licitaciones ganadas + orden de proceder</p>
                </div>
              </div>
              <p className="text-[26px] font-bold tracking-[-0.03em] tabular-nums text-slate-900">{formatMoney(adjudicado)}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-surface-muted px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.09em] text-slate-500">Ganadas</p>
                  <p className="text-lg font-bold tabular-nums text-emerald-600">{nGanadas}</p>
                </div>
                <div className="rounded-lg bg-surface-muted px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.09em] text-slate-500">Orden proceder</p>
                  <p className="text-lg font-bold tabular-nums text-blue-600">{nOrden}</p>
                </div>
              </div>
              <p className="mt-3 text-[11px] text-slate-500">
                Backlog listo para convertirse en proyecto — no cuenta como cobro todavía.
              </p>
            </div>
          </div>
        </section>

        {/* Los proyectos que explican el año. */}
        <section className="mb-4 rounded-card border border-line bg-surface shadow-[0_1px_2px_rgba(15,23,42,.04)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-[13px] font-bold text-slate-900">Proyectos que mueven el año</h2>
              <p className="text-[11px] text-slate-500">Ordenados por cobro · margen calculado con el gasto de QuickBooks</p>
            </div>
            <Link href="/proyectos" className="shrink-0 whitespace-nowrap text-xs font-semibold text-blue-600 hover:text-blue-700">
              Ver los {qboProjects.length} →
            </Link>
          </div>
          {topProyectos.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">
              Todavía no hay números de QuickBooks. Entrá a Proyectos y tocá Actualizar.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead>
                  <tr className="border-b border-line-soft text-left text-[10px] uppercase tracking-[0.09em] text-slate-500">
                    <th className="px-5 py-2.5 font-bold">Proyecto</th>
                    <th className="px-3 py-2.5 font-bold">Cliente</th>
                    <th className="px-3 py-2.5 text-right font-bold">Cobro</th>
                    <th className="px-3 py-2.5 text-right font-bold">Gasto</th>
                    <th className="px-3 py-2.5 font-bold">Margen</th>
                    <th className="px-5 py-2.5 font-bold">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {topProyectos.map((p) => {
                    const m = p.margin;
                    const sinGasto = (p.cost ?? 0) === 0 && (p.income ?? 0) > 0 && p.status !== "cerrado";
                    return (
                      <tr key={p.id} className="border-b border-row last:border-0 hover:bg-row-hover">
                        <td className="max-w-[260px] px-5 py-3">
                          <span className="block truncate font-semibold text-slate-900" title={p.name}>
                            {p.name}
                          </span>
                        </td>
                        <td className="max-w-[160px] px-3 py-3">
                          <span className="block truncate text-slate-600">{p.clientName || "—"}</span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right font-bold tabular-nums text-slate-900">
                          {formatMoney(p.income ?? 0)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-slate-600">
                          {formatMoney(p.cost ?? 0)}
                        </td>
                        <td className="px-3 py-3">
                          {/* Gasto en cero en un proyecto vivo no es 100% de margen:
                              es gasto sin cargar. Decirlo evita leer una ganancia
                              que no existe. */}
                          {sinGasto ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="h-1.5 w-16 rounded-full bg-slate-200" />
                              <span className="text-[11px] font-semibold text-orange-600">s/d</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                                <span
                                  className="block h-full rounded-full"
                                  style={{
                                    width: `${Math.max(0, Math.min(100, Math.round((m ?? 0) * 100)))}%`,
                                    backgroundColor: (m ?? 0) >= 0.3 ? "#10B981" : (m ?? 0) >= 0.15 ? "#F59E0B" : "#EF4444",
                                  }}
                                />
                              </span>
                              <span className="text-[11px] font-bold tabular-nums text-slate-700">
                                {m !== null ? `${Math.round(m * 100)}%` : "s/d"}
                              </span>
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3">
                          <EstadoChip status={p.status} sinGasto={sinGasto} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Mantenimiento: tira compacta. Es un pilar del negocio pero no el
            titular de esta pantalla, así que ocupa una fila y no una sección. */}
        {maint ? (
          <section className="mb-4 rounded-card border border-line bg-surface shadow-[0_1px_2px_rgba(15,23,42,.04)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-5 py-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex size-[30px] shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <HeartPulse className="size-4" />
                </span>
                <h2 className="text-[13px] font-bold text-slate-900">
                  Mantenimiento
                  <span className="ml-1 font-normal text-slate-500">
                    · {maint.totalEquipment} equipos en {maint.totalLocations} sucursales
                  </span>
                </h2>
              </div>
              <Link href="/mantenimiento" className="shrink-0 whitespace-nowrap text-xs font-semibold text-blue-600 hover:text-blue-700">
                Ir a mantenimiento →
              </Link>
            </div>
            <div className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.09em] text-slate-500">Distribución de estados</p>
                  <p className="shrink-0 text-[12px] font-bold tabular-nums" style={{ color: colorForScore(maint.globalHealth) }}>
                    {maint.globalHealth}% salud global
                  </p>
                </div>
                <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
                  {(Object.keys(maint.globalCounts) as (keyof typeof maint.globalCounts)[]).map((k) => {
                    const n = maint.globalCounts[k];
                    if (!n) return null;
                    return (
                      <span
                        key={k}
                        className="h-full"
                        style={{ width: `${(n / Math.max(1, maint.totalEquipment)) * 100}%`, backgroundColor: STATUS_COLOR[k] }}
                        title={`${STATUS_LABEL[k]}: ${n}`}
                      />
                    );
                  })}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                  {(Object.keys(maint.globalCounts) as (keyof typeof maint.globalCounts)[]).map((k) =>
                    maint.globalCounts[k] ? (
                      <span key={k} className="inline-flex items-center gap-1">
                        <span className="size-2 rounded-sm" style={{ backgroundColor: STATUS_COLOR[k] }} />
                        {STATUS_LABEL[k]} <span className="font-bold tabular-nums text-slate-700">{maint.globalCounts[k]}</span>
                      </span>
                    ) : null,
                  )}
                </div>
              </div>
              <MiniStat label="Vencidos" value={maint.overdueSchedules.length} tono={maint.overdueSchedules.length > 0 ? "rojo" : undefined} sub={`${maint.thisWeekSchedules.length} esta semana`} />
              <MiniStat label="Requieren acción" value={maint.globalCounts.atencion + maint.globalCounts.critico} tono="ambar" sub="equipos en aviso" />
              <MiniStat label="Reportes" value={maint.reports.length} sub={`${maint.draftReportsCount} en borrador`} />
            </div>
          </section>
        ) : null}

        {/* Potencial: explícitamente en segundo plano. Es plata que TODAVÍA no
            es plata, y mezclarla con lo facturado es como se infla un año. */}
        {d ? (
          <section>
            <h2 className="mb-2 text-[10px] font-bold uppercase tracking-[0.09em] text-slate-500">
              Potencial · todavía no es negocio
            </h2>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-card border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,.04)]">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-[13px] font-bold text-slate-900">
                    Leads <span className="font-normal text-slate-500">· {leadsTotal} activos</span>
                  </h3>
                  <Link href="/leads" className="shrink-0 whitespace-nowrap text-xs font-semibold text-blue-600 hover:text-blue-700">
                    Ver leads →
                  </Link>
                </div>
                {leadsTotal === 0 ? (
                  <p className="py-4 text-center text-[12px] text-slate-500">Sin leads activos.</p>
                ) : (
                  <div className="space-y-2">
                    {embudo.map((e) => (
                      <div key={e.key} className="flex items-center gap-2">
                        <span className="w-28 shrink-0 truncate text-[12px] text-slate-600">{e.label}</span>
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <span
                            className="block h-full rounded-full"
                            style={{ width: `${Math.round((e.n / Math.max(1, leadsTotal)) * 100)}%`, backgroundColor: e.color }}
                          />
                        </span>
                        <span className="w-8 shrink-0 text-right text-[12px] font-bold tabular-nums text-slate-800">{e.n}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-card border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,.04)]">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-[13px] font-bold text-slate-900">
                    Cotizaciones <span className="font-normal text-slate-500">· {year}</span>
                  </h3>
                  <Link href="/potenciales" className="shrink-0 whitespace-nowrap text-xs font-semibold text-blue-600 hover:text-blue-700">
                    Ver cotizaciones →
                  </Link>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <MiniStat label="En juego" value={formatMoney(d.enviadaMonto)} sub={`${d.enviadaCount} enviadas`} tono="ambar" />
                  <MiniStat label="Aprobadas" value={formatMoney(d.aprobadoMonto)} sub={`${d.aprobadoCount} vigentes`} tono="verde" />
                  <MiniStat
                    label="Tasa de cierre"
                    value={d.tasaCierre !== null ? `${Math.round(d.tasaCierre * 100)}%` : "s/d"}
                    sub="aprobadas / decididas"
                  />
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

// ── Finanzas de proyectos (QBO) ───────────────────────────────────────────────

// ── Licitaciones que cierran esta semana ──────────────────────────────────────
// ── Seguimientos de cotizaciones enviadas ─────────────────────────────────────
// Cuánto hace que se sincronizó QBO, en palabras. El dato importa: un número
// de hace tres días se lee distinto que uno de hace tres minutos.
function haceCuanto(ts: number): string {
  const min = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} día${d === 1 ? "" : "s"}`;
}

// KPI de la tarjeta héroe. El valor usa clamp + nowrap por el checklist del
// handoff: cuatro montos en fila no se pueden pisar entre sí.
function HeroKpi({
  label,
  value,
  sub,
  tint,
  color,
  sinBorde,
}: {
  label: string;
  value: string;
  sub: string;
  tint?: string;
  color?: string;
  sinBorde?: boolean;
}) {
  return (
    <div className={cn("px-5 py-4", !sinBorde && "sm:border-r sm:border-line-soft", tint)}>
      <p className="text-[10px] font-bold uppercase tracking-[0.09em] text-slate-500">{label}</p>
      <p
        className="mt-0.5 whitespace-nowrap font-bold tracking-[-0.03em] tabular-nums text-slate-900"
        style={{ fontSize: "clamp(20px, 2vw, 28px)", ...(color ? { color } : {}) }}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>
    </div>
  );
}

const ESTADO_CHIP: Record<string, { label: string; cls: string }> = {
  activo: { label: "En ejecución", cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  por_cobrar: { label: "Por cobrar", cls: "bg-amber-50 text-amber-700 ring-amber-600/20" },
  cerrado: { label: "Cerrado", cls: "bg-slate-100 text-slate-600 ring-slate-200" },
};

function EstadoChip({ status, sinGasto }: { status: string; sinGasto: boolean }) {
  // Falta cargar el gasto pesa más que el estado: es lo que hay que ir a hacer.
  const meta = sinGasto
    ? { label: "Falta cargar gasto", cls: "bg-orange-50 text-orange-700 ring-orange-600/20" }
    : ESTADO_CHIP[status] ?? ESTADO_CHIP.activo;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset",
        meta.cls,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {meta.label}
    </span>
  );
}

const TONO: Record<string, string> = {
  rojo: "text-rose-600",
  ambar: "text-amber-600",
  verde: "text-emerald-600",
};

function MiniStat({
  label,
  value,
  sub,
  color,
  tono,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  tono?: "rojo" | "ambar" | "verde";
}) {
  return (
    <div className="rounded-xl bg-surface-muted p-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.09em] text-slate-500">{label}</p>
      <p
        className={cn("mt-0.5 whitespace-nowrap text-lg font-bold tabular-nums", tono ? TONO[tono] : "text-slate-900")}
        style={color ? { color } : undefined}
      >
        {value}
      </p>
      {sub ? <p className="text-[11px] text-slate-500">{sub}</p> : null}
    </div>
  );
}
