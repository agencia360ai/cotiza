import type { QboProject } from "@/lib/quickbooks/projects";
import { gastoConHoras } from "@/lib/quickbooks/horas-core";
import { cobrosEnRango } from "@/lib/quickbooks/cobros-core";

export const RUBROS = [
  { key: "DC", label: "Contratos", color: "#4f46e5" },
  { key: "DM", label: "Mantenimiento", color: "#0284c7" },
  { key: "DS", label: "Servicio", color: "#059669" },
  { key: "DV", label: "Ventas", color: "#d97706" },
] as const;

export type OverviewProject = {
  id: string;
  name: string;
  client: string;
  year: number | null;
  rubro: string | null;
  status: QboProject["status"];
  income: number | null;
  cost: number | null;
  profit: number | null;
  margin: number | null;
  collected: number | null;
  receivable: number | null;
  advance: number;
  unbilled: number;
  costIssue: boolean;
  months: { month: string; income: number; cost: number }[];
};

const round = (n: number) => Math.round(n * 100) / 100;

export function overviewProject(p: QboProject): OverviewProject {
  const cost = gastoConHoras(p.cost, p.horas);
  // A zero on an open job may mean costs have not been entered yet.
  const costIssue =
    cost === null ||
    cost < 0 ||
    (p.cost ?? 0) < 0 ||
    (cost === 0 && (p.income ?? 0) > 0 && p.status !== "cerrado");
  const profit =
    !costIssue && p.income !== null ? round(p.income - cost!) : null;
  // The legacy `paid` field can include credits. Only the payment breakdown
  // proves cash received; missing data must remain unknown.
  const cash = p.cobros !== null ? cobrosEnRango(p.cobros, () => 1) : null;
  const advance = p.porFacturar?.cobrado ?? 0;
  const months = new Map(
    p.meses.map((m) => [
      m.month.slice(0, 7),
      {
        month: m.month.slice(0, 7),
        income: m.income,
        cost: m.cost,
      },
    ]),
  );
  for (const h of p.horas?.meses ?? []) {
    const key = h.month.slice(0, 7);
    const m = months.get(key) ?? { month: key, income: 0, cost: 0 };
    m.cost += h.costo;
    months.set(key, m);
  }
  return {
    id: p.id,
    name: p.name,
    client: p.clientName,
    year: p.year,
    rubro: p.rubro,
    status: p.status,
    income: p.income,
    cost,
    profit,
    margin: profit !== null && (p.income ?? 0) > 0 ? profit / p.income! : null,
    collected:
      cash !== null
        ? round(cash.cobrado + advance)
        : advance > 0
          ? advance
          : null,
    receivable:
      cash !== null ? round(Math.max(0, cash.facturado - cash.cobrado)) : null,
    advance,
    unbilled: p.porFacturar?.neto ?? 0,
    costIssue,
    months: [...months.values()],
  };
}

export type ProjectView = "all" | "collect" | "review" | "missing";

export function needsReview(p: OverviewProject) {
  return p.profit !== null && p.profit < 0;
}

export function filterProjects(
  projects: OverviewProject[],
  view: ProjectView,
  query = "",
) {
  const text = query
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .trim();
  return projects
    .filter((p) => {
      const name = `${p.name} ${p.client}`
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("es");
      return (
        (!text || name.includes(text)) &&
        (view === "all" ||
          (view === "collect" && (p.receivable ?? 0) > 0) ||
          (view === "review" && needsReview(p)) ||
          (view === "missing" && (p.costIssue || p.receivable === null)))
      );
    })
    .sort((a, b) =>
      view === "review"
        ? (a.profit ?? 0) - (b.profit ?? 0)
        : view === "collect"
          ? (b.receivable ?? 0) - (a.receivable ?? 0)
          : (b.income ?? 0) - (a.income ?? 0),
    );
}

export function summarizeProjects(projects: OverviewProject[]) {
  const withIncome = projects.filter((p) => p.income !== null);
  const withCash = projects.filter((p) => p.collected !== null);
  const withReceivable = projects.filter((p) => p.receivable !== null);
  const withProfit = projects.filter((p) => p.profit !== null);
  const incomeBasis = withProfit.reduce((s, p) => s + p.income!, 0);
  const profit = withProfit.length
    ? round(withProfit.reduce((s, p) => s + p.profit!, 0))
    : null;
  return {
    income: withIncome.length
      ? round(withIncome.reduce((s, p) => s + p.income!, 0))
      : null,
    collected: withCash.length
      ? round(withCash.reduce((s, p) => s + p.collected!, 0))
      : null,
    receivable: withReceivable.length
      ? round(withReceivable.reduce((s, p) => s + p.receivable!, 0))
      : null,
    profit,
    margin: profit !== null && incomeBasis > 0 ? profit / incomeBasis : null,
    advance: round(projects.reduce((s, p) => s + p.advance, 0)),
    collectionCount: projects.filter((p) => (p.receivable ?? 0) > 0).length,
    reviewCount: projects.filter(needsReview).length,
    missingCash: projects.length - withReceivable.length,
    missingProfit: projects.length - withProfit.length,
    missingIncome: projects.length - withIncome.length,
    active: projects.filter((p) => p.status !== "cerrado").length,
  };
}

export function monthlySeries(projects: OverviewProject[], year: number) {
  return Array.from({ length: 12 }, (_, index) => {
    const key = `${year}-${String(index + 1).padStart(2, "0")}`;
    const months = projects.flatMap((p) =>
      p.months.filter((m) => m.month === key),
    );
    return {
      month: index,
      income: round(months.reduce((s, m) => s + m.income, 0)),
      cost: round(months.reduce((s, m) => s + m.cost, 0)),
      reported: months.length > 0,
    };
  });
}

export function money(value: number | null) {
  return value === null
    ? "Sin datos"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(value);
}

export type OverviewExtras = {
  tender: { amount: number; won: number; proceed: number } | null;
  leads: { total: number; fresh: number; following: number } | null;
  quotes: { sent: number; amount: number; approved: number } | null;
  maintenance: {
    equipment: number;
    overdue: number;
    attention: number;
    week: number;
  } | null;
};
