"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronRight,
  CircleAlert,
  FileText,
  Hammer,
  Landmark,
  Search,
  SlidersHorizontal,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
  Wrench,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Seccion } from "@/lib/secciones";
import {
  filterProjects,
  money,
  monthlySeries,
  RUBROS,
  summarizeProjects,
  type OverviewExtras,
  type OverviewProject,
  type ProjectView,
} from "@/lib/inicio/overview";
import { FinanceChart } from "./finance-chart";

const panel =
  "rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_5px_-3px_rgba(15,23,42,0.12)]";
const focus =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";
const statusNames = {
  activo: "En ejecución",
  por_cobrar: "En cobranza",
  cerrado: "Cerrado",
};
const percent = (n: number | null) =>
  n === null ? "Sin datos" : `${Math.round(n * 100)}%`;

export type BusinessOverviewProps = {
  projects: OverviewProject[];
  syncedAt: number | null;
  unavailable: boolean;
  today: string;
  extras: OverviewExtras;
  sections: Seccion[];
};

export function BusinessOverview({
  projects,
  syncedAt,
  unavailable,
  today,
  extras,
  sections,
}: BusinessOverviewProps) {
  const currentYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(String(currentYear));
  const [rubro, setRubro] = useState("all");
  const [view, setView] = useState<ProjectView>("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(6);
  const [detail, setDetail] = useState<OverviewProject | null>(null);
  const detailTrigger = useRef<HTMLElement | null>(null);
  const list = useRef<HTMLElement>(null);
  const can = (section: Seccion) => sections.includes(section);
  const years = [
    ...new Set([
      currentYear,
      ...projects.flatMap((p) => (p.year === null ? [] : [p.year])),
    ]),
  ].sort((a, b) => b - a);
  const scoped = useMemo(
    () =>
      projects.filter(
        (p) =>
          (year === "all" || String(p.year) === year) &&
          (rubro === "all" || p.rubro === rubro),
      ),
    [projects, year, rubro],
  );
  const totals = useMemo(() => summarizeProjects(scoped), [scoped]);
  const rows = useMemo(
    () => filterProjects(scoped, view, query),
    [scoped, view, query],
  );
  const chartYear = year === "all" ? currentYear : Number(year);
  const series = useMemo(
    () => monthlySeries(scoped, chartYear),
    [scoped, chartYear],
  );
  const daysOld =
    syncedAt === null
      ? null
      : Math.max(
          0,
          Math.floor(
            (Date.parse(`${today}T23:59:59-05:00`) - syncedAt) / 86400000,
          ),
        );
  const stale = daysOld !== null && daysOld >= 2;
  const syncText =
    syncedAt === null
      ? "Sin sincronización registrada"
      : `Última actualización: ${new Date(syncedAt).toLocaleDateString("es-PA", { timeZone: "America/Panama", day: "numeric", month: "short" })}`;
  const displayDate = new Date(`${today}T12:00:00-05:00`).toLocaleDateString(
    "es-PA",
    { weekday: "long", day: "numeric", month: "long" },
  );
  const hasProjects = scoped.length > 0;

  function showProjects(next: ProjectView) {
    setView(next);
    setQuery("");
    setLimit(6);
    list.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "start",
    });
    list.current?.focus({ preventScroll: true });
  }

  function openDetail(project: OverviewProject) {
    detailTrigger.current = document.activeElement as HTMLElement | null;
    setDetail(project);
  }

  return (
    <div className="min-h-full bg-[#f4f6fa] text-slate-900">
      <header className="border-b border-slate-200/80 bg-white px-4 py-3 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Operación</span>
            <ChevronRight className="size-3" />
            <span className="font-medium text-slate-900">Visión general</span>
          </div>
          <span className="flex items-center gap-2 text-xs capitalize text-slate-500">
            <CalendarDays className="size-3.5" />
            {displayDate}
          </span>
        </div>
      </header>
      <div className="mx-auto max-w-[1744px] space-y-5 px-4 py-6 sm:px-6 lg:space-y-6 lg:px-8 lg:py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[.18em] text-blue-600">
              Su centro de operaciones
            </p>
            <h1 className="text-[28px] font-semibold leading-tight tracking-[-.035em] sm:text-[32px]">
              Resumen del negocio
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Claridad en los números. Foco en el siguiente paso.
            </p>
          </div>
          {can("cotizaciones") && (
            <Link
              href="/potenciales"
              className={cn(
                "inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700",
                focus,
              )}
            >
              <FileText className="size-4" />
              Ver cotizaciones
              <ArrowUpRight className="size-4" />
            </Link>
          )}
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1.5 text-[11px] font-semibold text-slate-500">
              <span className="block">Año del proyecto</span>
              <select
                value={year}
                onChange={(e) => {
                  setYear(e.target.value);
                  setLimit(6);
                }}
                className={cn(
                  "h-11 rounded-xl border border-slate-200 bg-white px-3 pr-8 text-sm font-semibold text-slate-800",
                  focus,
                )}
              >
                <option value="all">Todos los años</option>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 text-[11px] font-semibold text-slate-500">
              <span className="block">Línea de negocio</span>
              <select
                value={rubro}
                onChange={(e) => {
                  setRubro(e.target.value);
                  setLimit(6);
                }}
                className={cn(
                  "h-11 max-w-full rounded-xl border border-slate-200 bg-white px-3 pr-7 text-sm font-semibold text-slate-800",
                  focus,
                )}
              >
                <option value="all">Todas las líneas</option>
                {RUBROS.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="pb-3 text-xs text-slate-500">
              <strong className="font-semibold text-slate-800">
                {scoped.length}
              </strong>{" "}
              proyectos · {totals.active} abiertos
            </p>
          </div>
          <div
            className={cn(
              "flex max-w-full items-center gap-2 rounded-lg px-3 py-2 text-xs",
              stale || syncedAt === null
                ? "bg-amber-50 text-amber-800"
                : "bg-white text-slate-600",
            )}
          >
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                stale || syncedAt === null ? "bg-amber-500" : "bg-emerald-500",
              )}
            />
            <span>{syncText}</span>
            {can("proyectos") && (
              <Link
                href="/proyectos"
                aria-label="Ir a Proyectos para actualizar QuickBooks"
                className={cn("ml-1 rounded p-1 hover:bg-black/5", focus)}
              >
                <ArrowUpRight className="size-4" />
              </Link>
            )}
          </div>
        </div>

        {unavailable && (
          <div
            role="alert"
            className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
          >
            <CircleAlert className="size-5 shrink-0" />
            <p>
              No se pudieron cargar las finanzas. Vuelva a cargar la página o
              revise Proyectos. Los indicadores no representan un saldo de cero.
            </p>
          </div>
        )}
        <section
          aria-label="Indicadores financieros"
          className="grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-4"
        >
          <Metric
            label="Facturado"
            value={money(totals.income)}
            icon={<FileText className="size-4" />}
            hint={
              totals.missingIncome
                ? `${totals.missingIncome} proyectos sin facturación disponible`
                : "Ingresos registrados · sin anticipos"
            }
            onClick={() => showProjects("all")}
          />
          <Metric
            label="Cobrado"
            value={money(totals.collected)}
            icon={<ArrowDownLeft className="size-4" />}
            dark
            hint={
              totals.missingCash
                ? `Dato parcial · ${totals.missingCash} sin desglose de cobros`
                : `Pagos recibidos · ${money(totals.advance)} en anticipos`
            }
            onClick={() => showProjects("all")}
          />
          <Metric
            label="Por cobrar"
            value={money(totals.receivable)}
            icon={<Wallet className="size-4" />}
            hint={
              totals.missingCash
                ? `${totals.collectionCount} con saldo · dato parcial`
                : `${totals.collectionCount} proyectos con saldo pendiente`
            }
            tone="amber"
            onClick={() => showProjects("collect")}
          />
          <Metric
            label="Resultado registrado"
            value={money(totals.profit)}
            icon={
              totals.profit !== null && totals.profit < 0 ? (
                <TrendingDown className="size-4" />
              ) : (
                <TrendingUp className="size-4" />
              )
            }
            hint={`${percent(totals.margin)} de margen${totals.missingProfit ? ` · ${totals.missingProfit} sin costo validable` : " · facturado menos costos"}`}
            tone={
              totals.profit === null
                ? undefined
                : totals.profit < 0
                  ? "red"
                  : "green"
            }
            onClick={() => showProjects("review")}
          />
        </section>
        <p className="!mt-2 text-[11px] leading-5 text-slate-500">
          Acumulado de los proyectos seleccionados, no de un período contable.
          Cobros y saldos incluyen ITBMS; facturación y resultado usan el
          reporte contable. El resultado no incluye lo pendiente por facturar.
        </p>

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(310px,1fr)]">
          <section
            className={cn(panel, "order-2 min-w-0 p-4 sm:p-6 xl:order-1")}
          >
            <FinanceChart
              key={`${year}-${rubro}`}
              data={series}
              year={chartYear}
              currentMonth={
                chartYear < currentYear
                  ? 11
                  : chartYear > currentYear
                    ? 0
                    : Number(today.slice(5, 7)) - 1
              }
            />
          </section>
          <section
            className={cn(panel, "order-1 overflow-hidden xl:order-2")}
            aria-labelledby="priorities-title"
          >
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-5">
              <span className="flex size-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <Sparkles className="size-4" />
              </span>
              <div>
                <h2 id="priorities-title" className="text-base font-semibold">
                  Dónde poner el foco
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Prioridades de los proyectos seleccionados
                </p>
              </div>
            </div>
            <div className="space-y-1 p-3">
              <Action
                icon={<Wallet className="size-4" />}
                title="Dar seguimiento a cobros"
                description={
                  totals.receivable === null
                    ? "Desglose de cobros no disponible"
                    : `${money(totals.receivable)} en ${totals.collectionCount} proyectos`
                }
                color="amber"
                onClick={() => showProjects("collect")}
              />
              <Action
                icon={<TrendingDown className="size-4" />}
                title="Revisar costos y facturación"
                description={
                  hasProjects
                    ? `${totals.reviewCount} proyectos con costos mayores a lo facturado`
                    : "Sin proyectos para evaluar"
                }
                color="red"
                onClick={() => showProjects("review")}
              />
              <Action
                icon={<SlidersHorizontal className="size-4" />}
                title="Completar datos financieros"
                description={
                  hasProjects
                    ? `${filterProjects(scoped, "missing").length} proyectos con datos por revisar`
                    : "Sin datos para revisar"
                }
                color="blue"
                onClick={() => showProjects("missing")}
              />
            </div>
            {can("licitaciones") && (
              <Link
                href="/licitaciones"
                className={cn(
                  "group m-3 mt-0 block rounded-xl bg-[#eef2ff] p-4 transition-colors hover:bg-indigo-100",
                  focus,
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-xs font-semibold text-indigo-700">
                    <Landmark className="size-4" />
                    Adjudicado por activar
                  </span>
                  <ArrowUpRight className="size-4 text-indigo-600" />
                </div>
                <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-indigo-950">
                  {money(extras.tender?.amount ?? null)}
                </div>
                <p className="mt-1 text-xs leading-5 text-indigo-700">
                  {extras.tender
                    ? `${extras.tender.won} ganadas · ${extras.tender.proceed} con orden de proceder`
                    : "Datos no disponibles"}
                </p>
                <p className="mt-2 text-[11px] leading-4 text-indigo-700">
                  Monto de referencia, sin proyecto vinculado. Todos los años y
                  rubros; no es ingreso cobrado.
                </p>
              </Link>
            )}
          </section>
        </div>

        <section
          ref={list}
          tabIndex={-1}
          className={cn(panel, "scroll-mt-20 overflow-hidden outline-none")}
          aria-labelledby="projects-title"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-5 sm:px-6">
            <div>
              <h2 id="projects-title" className="text-base font-semibold">
                Proyectos bajo la lupa
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Seleccione un proyecto para entender sus números.
              </p>
            </div>
            {can("proyectos") && (
              <Link
                href="/proyectos"
                className={cn(
                  "inline-flex min-h-11 items-center gap-2 rounded-lg text-xs font-semibold text-blue-600 hover:text-blue-800",
                  focus,
                )}
              >
                Abrir Proyectos
                <ArrowUpRight className="size-4" />
              </Link>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 pb-4 sm:px-6">
            <div
              className="flex flex-wrap gap-1"
              aria-label="Filtrar proyectos"
            >
              {(
                [
                  ["all", "Todos", scoped.length],
                  ["collect", "Por cobrar", totals.collectionCount],
                  ["review", "Revisar resultado", totals.reviewCount],
                  [
                    "missing",
                    "Datos pendientes",
                    filterProjects(scoped, "missing").length,
                  ],
                ] as const
              ).map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={view === key}
                  onClick={() => {
                    setView(key);
                    setLimit(6);
                  }}
                  className={cn(
                    "flex min-h-11 items-center gap-2 rounded-lg px-3 text-xs font-medium transition-colors",
                    focus,
                    view === key
                      ? "bg-blue-50 text-blue-700"
                      : "text-slate-500 hover:bg-slate-50 hover:text-slate-800",
                  )}
                >
                  {label}
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] tabular-nums",
                      view === key ? "bg-blue-100" : "bg-slate-100",
                    )}
                  >
                    {count}
                  </span>
                </button>
              ))}
            </div>
            <label className="relative w-full sm:w-60">
              <span className="sr-only">Buscar proyecto o cliente</span>
              <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-slate-400" />
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setLimit(6);
                }}
                placeholder="Buscar proyecto o cliente"
                className={cn(
                  "h-11 w-full rounded-lg border border-slate-200 bg-slate-50/50 pl-9 pr-3 text-sm placeholder:text-slate-400",
                  focus,
                )}
              />
            </label>
          </div>
          {rows.length ? (
            <>
              <div className="hidden lg:block">
                <table className="w-full table-fixed text-sm">
                  <caption className="sr-only">
                    Proyectos seleccionados y resultados acumulados
                  </caption>
                  <thead>
                    <tr className="bg-slate-50/80 text-[10px] uppercase tracking-wider text-slate-500">
                      <th className="w-[40%] px-6 py-3 text-left font-semibold">
                        Proyecto / Cliente
                      </th>
                      <th className="px-3 py-3 text-right font-semibold">
                        Facturado
                      </th>
                      <th className="px-3 py-3 text-right font-semibold">
                        Por cobrar
                      </th>
                      <th className="px-3 py-3 text-right font-semibold">
                        Margen
                      </th>
                      <th className="w-[17%] px-6 py-3 text-right font-semibold">
                        Estado
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, limit).map((p) => (
                      <tr
                        key={p.id}
                        className="border-t border-slate-100 transition-colors hover:bg-blue-50/30"
                      >
                        <td className="px-6 py-3.5">
                          <button
                            type="button"
                            onClick={() => openDetail(p)}
                            className={cn(
                              "group block w-full rounded text-left",
                              focus,
                            )}
                          >
                            <span
                              className="block truncate text-[13px] font-semibold text-slate-800 group-hover:text-blue-600"
                              title={p.name}
                            >
                              {p.name}
                            </span>
                            <span className="mt-1 block truncate text-xs text-slate-500">
                              {p.client || "Cliente sin registrar"}
                            </span>
                          </button>
                        </td>
                        <td className="px-3 py-3 text-right text-[13px] font-semibold tabular-nums">
                          {money(p.income)}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-3 text-right text-[13px] tabular-nums",
                            (p.receivable ?? 0) > 0
                              ? "font-medium text-amber-700"
                              : "text-slate-500",
                          )}
                        >
                          {money(p.receivable)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <Margin value={p.margin} />
                        </td>
                        <td className="px-6 py-3 text-right">
                          <Status status={p.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="divide-y divide-slate-100 lg:hidden">
                {rows.slice(0, limit).map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => openDetail(p)}
                    className={cn(
                      "block w-full p-5 text-left transition-colors hover:bg-slate-50",
                      focus,
                    )}
                  >
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <Status status={p.status} />
                      <ArrowUpRight className="size-4 text-slate-400" />
                    </div>
                    <h3 className="text-sm font-semibold leading-6">
                      {p.name}
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">
                      {p.client || "Cliente sin registrar"}
                    </p>
                    <dl className="mt-4 grid grid-cols-3 gap-2">
                      <div>
                        <dt className="text-[10px] text-slate-500">
                          Facturado
                        </dt>
                        <dd className="mt-1 text-sm font-semibold tabular-nums">
                          {money(p.income)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] text-slate-500">
                          Por cobrar
                        </dt>
                        <dd className="mt-1 text-sm font-semibold tabular-nums text-amber-700">
                          {money(p.receivable)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] text-slate-500">Margen</dt>
                        <dd className="mt-1">
                          <Margin value={p.margin} />
                        </dd>
                      </div>
                    </dl>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="px-5 py-12 text-center">
              <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                {hasProjects ? (
                  <Check className="size-5" />
                ) : (
                  <Hammer className="size-5" />
                )}
              </div>
              <h3 className="text-sm font-semibold">
                {unavailable
                  ? "Proyectos no disponibles"
                  : hasProjects
                    ? "No hay proyectos con estos filtros"
                    : "Sin proyectos en esta selección"}
              </h3>
              <p className="mt-2 text-sm text-slate-500">
                {hasProjects
                  ? "Cambie la búsqueda o seleccione otra vista."
                  : "Pruebe otro año o revise la sincronización en Proyectos."}
              </p>
              {(query || view !== "all") && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setView("all");
                  }}
                  className={cn(
                    "mt-4 min-h-11 rounded-lg px-4 text-sm font-medium text-blue-600 hover:bg-blue-50",
                    focus,
                  )}
                >
                  Limpiar búsqueda y vista
                </button>
              )}
            </div>
          )}
          {rows.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-6 py-3 text-xs text-slate-500">
              <span aria-live="polite">
                Mostrando {Math.min(limit, rows.length)} de {rows.length}{" "}
                proyectos
              </span>
              {limit < rows.length && (
                <button
                  type="button"
                  onClick={() => setLimit((n) => n + 6)}
                  className={cn(
                    "min-h-11 rounded-lg px-3 font-semibold text-blue-600 hover:bg-blue-50",
                    focus,
                  )}
                >
                  Mostrar más
                  <ChevronRight className="ml-1 inline size-3.5" />
                </button>
              )}
            </div>
          )}
        </section>

        <div className="grid gap-5 xl:grid-cols-2">
          <section className={cn(panel, "p-5 sm:p-6")}>
            <h2 className="text-base font-semibold">Rentabilidad por línea</h2>
            <p className="mt-1 text-xs text-slate-500">
              Facturación y margen registrado de la selección
            </p>
            <div className="mt-5 space-y-5">
              {RUBROS.map((r) => {
                const items = scoped.filter((p) => p.rubro === r.key);
                const s = summarizeProjects(items);
                const width = Math.max(
                  0,
                  Math.min(
                    100,
                    ((s.income ?? 0) / Math.max(1, totals.income ?? 0)) * 100,
                  ),
                );
                return (
                  <div key={r.key}>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-2 font-medium text-slate-700">
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: r.color }}
                        />
                        {r.label}
                        <span className="font-normal text-slate-500">
                          {items.length}
                        </span>
                      </span>
                      <span className="flex items-center gap-3">
                        <strong className="font-semibold tabular-nums">
                          {money(s.income)}
                        </strong>
                        <Margin value={s.margin} />
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${width}%`, backgroundColor: r.color }}
                      />
                    </div>
                    {s.missingProfit > 0 && (
                      <p className="mt-1 text-[10px] text-slate-500">
                        Margen parcial: {s.missingProfit} sin costo validable
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
          <section className={cn(panel, "p-5 sm:p-6")}>
            <h2 className="text-base font-semibold">El siguiente paso</h2>
            <p className="mt-1 text-xs text-slate-500">
              Operación actual · independiente de los filtros financieros
            </p>
            <div className="mt-4 divide-y divide-slate-100">
              {can("cotizaciones") && (
                <Secondary
                  href="/potenciales"
                  icon={<FileText className="size-4" />}
                  title="Cotizaciones enviadas"
                  value={
                    extras.quotes ? money(extras.quotes.amount) : "Sin datos"
                  }
                  sub={
                    extras.quotes
                      ? `${extras.quotes.sent} por seguir · ${extras.quotes.approved} aprobadas · ${currentYear}`
                      : "No se pudo cargar el resumen"
                  }
                />
              )}
              {can("leads") && (
                <Secondary
                  href="/leads"
                  icon={<Sparkles className="size-4" />}
                  title="Oportunidades abiertas"
                  value={
                    extras.leads ? String(extras.leads.total) : "Sin datos"
                  }
                  sub={
                    extras.leads
                      ? `${extras.leads.fresh} nuevas · ${extras.leads.following} en seguimiento`
                      : "No se pudo cargar el resumen"
                  }
                />
              )}
              {can("mantenimiento") && (
                <Secondary
                  href="/mantenimiento"
                  icon={<Wrench className="size-4" />}
                  title="Mantenimiento"
                  value={
                    extras.maintenance
                      ? `${extras.maintenance.overdue} vencidos`
                      : "Sin datos"
                  }
                  sub={
                    extras.maintenance
                      ? `${extras.maintenance.week} esta semana · ${extras.maintenance.attention} equipos requieren atención`
                      : "No se pudo cargar el resumen"
                  }
                />
              )}
              {!sections.some((s) =>
                ["cotizaciones", "leads", "mantenimiento"].includes(s),
              ) && (
                <p className="py-5 text-sm text-slate-500">
                  Los accesos disponibles dependen de su perfil.
                </p>
              )}
            </div>
          </section>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-2 pb-2 text-[11px] text-slate-500">
          <span>
            Montos en USD · Datos guardados de QuickBooks y Reportme.ai
          </span>
          <span>El resumen se consulta sin ejecutar una sincronización.</span>
        </footer>
      </div>

      <Dialog.Root
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm" />
          <Dialog.Content
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              detailTrigger.current?.focus();
            }}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col overflow-y-auto bg-white p-6 shadow-2xl focus:outline-none sm:p-8"
          >
            <div className="mb-6 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-widest text-blue-600">
                Detalle del proyecto
              </span>
              <Dialog.Close
                className={cn(
                  "flex size-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100",
                  focus,
                )}
                aria-label="Cerrar detalle"
              >
                <X className="size-5" />
              </Dialog.Close>
            </div>
            <Dialog.Title className="text-2xl font-semibold leading-snug tracking-tight">
              {detail?.name}
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-slate-500">
              {detail?.client || "Cliente sin registrar"} · Acumulado del
              proyecto
            </Dialog.Description>
            {detail && (
              <>
                <div className="mt-4">
                  <Status status={detail.status} />
                </div>
                <dl className="mt-7 grid grid-cols-2 gap-3">
                  {[
                    ["Facturado", money(detail.income)],
                    ["Costos + horas", money(detail.cost)],
                    ["Cobrado", money(detail.collected)],
                    ["Por cobrar", money(detail.receivable)],
                    ["Resultado registrado", money(detail.profit)],
                    ["Por facturar", money(detail.unbilled)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl bg-slate-50 p-4">
                      <dt className="text-xs text-slate-500">{label}</dt>
                      <dd
                        className={cn(
                          "mt-2 break-words text-xl font-semibold tracking-tight tabular-nums",
                          label === "Resultado registrado" &&
                            (detail.profit ?? 0) < 0 &&
                            "text-rose-700",
                        )}
                      >
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-4 flex items-center justify-between rounded-xl border border-slate-200 p-4">
                  <span className="text-sm text-slate-600">
                    Margen sobre lo facturado
                  </span>
                  <Margin value={detail.margin} />
                </div>
                <p className="mt-4 text-xs leading-6 text-slate-500">
                  El cobrado incluye {money(detail.advance)} de anticipos. Los
                  saldos no indican vencimiento. El resultado usa lo facturado y
                  los costos registrados; no es una proyección del contrato
                  terminado.
                </p>
                {(detail.costIssue || detail.receivable === null) && (
                  <p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-800">
                    {detail.costIssue
                      ? "Revise los costos antes de interpretar el margen. "
                      : ""}
                    {detail.receivable === null
                      ? "No hay desglose de pagos confirmado; los anticipos conocidos se muestran por separado en el cobrado."
                      : ""}
                  </p>
                )}
                {can("proyectos") && (
                  <Link
                    href={`/proyectos?q=${encodeURIComponent(detail.name)}`}
                    className={cn(
                      "mt-6 flex min-h-12 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700",
                      focus,
                    )}
                  >
                    Ver en Proyectos
                    <ArrowRight className="size-4" />
                  </Link>
                )}
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  icon,
  dark,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  hint: string;
  icon: ReactNode;
  dark?: boolean;
  tone?: "red" | "green" | "amber";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group min-w-0 rounded-2xl border p-4 text-left transition-colors sm:p-6",
        focus,
        dark
          ? "border-[#172646] bg-[#172646] text-white shadow-sm hover:bg-[#203455]"
          : "border-slate-200/80 bg-white hover:border-blue-300",
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-2 text-xs font-medium",
          dark ? "text-slate-200" : "text-slate-500",
        )}
      >
        <span>{label}</span>
        <span
          className={cn(
            "flex size-8 items-center justify-center rounded-lg",
            dark ? "bg-white/10 text-blue-200" : "bg-slate-50 text-slate-500",
          )}
        >
          {icon}
        </span>
      </div>
      <div
        className={cn(
          "mt-4 break-words text-[clamp(1.25rem,2.1vw,2.2rem)] font-semibold leading-tight tracking-[-.035em] tabular-nums",
          !dark &&
            (tone === "red"
              ? "text-rose-700"
              : tone === "green"
                ? "text-emerald-700"
                : tone === "amber"
                  ? "text-amber-700"
                  : "text-slate-900"),
        )}
      >
        {value}
      </div>
      <p
        className={cn(
          "mt-3 min-h-8 text-[11px] leading-4",
          dark ? "text-slate-300" : "text-slate-500",
        )}
      >
        {hint}
      </p>
    </button>
  );
}

function Action({
  title,
  description,
  icon,
  color,
  onClick,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  color: "amber" | "red" | "blue";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors hover:bg-slate-50",
        focus,
      )}
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-xl",
          color === "amber"
            ? "bg-amber-50 text-amber-700"
            : color === "red"
              ? "bg-rose-50 text-rose-600"
              : "bg-blue-50 text-blue-600",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-slate-800">
          {title}
        </span>
        <span className="mt-1 block text-xs leading-5 text-slate-500">
          {description}
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-slate-400" />
    </button>
  );
}

function Margin({ value }: { value: number | null }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold tabular-nums",
        value === null
          ? "bg-slate-100 text-slate-600"
          : value < 0
            ? "bg-rose-50 text-rose-700"
            : "bg-emerald-50 text-emerald-700",
      )}
    >
      {value !== null &&
        (value < 0 ? (
          <TrendingDown className="size-3" />
        ) : (
          <TrendingUp className="size-3" />
        ))}
      {percent(value)}
    </span>
  );
}

function Status({ status }: { status: OverviewProject["status"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-medium",
        status === "activo"
          ? "bg-blue-50 text-blue-700"
          : status === "por_cobrar"
            ? "bg-amber-50 text-amber-800"
            : "bg-slate-100 text-slate-600",
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {statusNames[status]}
    </span>
  );
}

function Secondary({
  href,
  title,
  sub,
  value,
  icon,
}: {
  href: string;
  title: string;
  sub: string;
  value: string;
  icon: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex flex-wrap items-center gap-3 rounded-lg py-4 transition-colors hover:bg-slate-50",
        focus,
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500">
        {icon}
      </span>
      <span className="min-w-[120px] flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-slate-500">
          {sub}
        </span>
      </span>
      <span className="ml-auto flex items-center gap-2 text-sm font-semibold tabular-nums">
        {value}
        <ArrowUpRight className="size-4 text-slate-400 group-hover:text-blue-600" />
      </span>
    </Link>
  );
}
