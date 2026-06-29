import "server-only";
import { fetchQboCustomers } from "./customers";
import { listQboTools, callQboTool, type QboToolResult } from "./mcp";

// Un proyecto en QBO = un customer con IsProject=true (bajo el cliente padre).
export type QboProject = {
  id: string;
  name: string; // nombre limpio (hoja, sin "Padre:")
  fullName: string; // displayName completo
  rubro: string | null; // DC | DM | DS | DV
  year: number | null;
  clientName: string;
  income: number | null;
  cost: number | null;
  margin: number | null; // 0..1
};

// "DC25-02", "DC-2501", "DS25-27" → { rubro, year(20YY) }
function parseRubroYear(name: string): { rubro: string; year: number } | null {
  const m = name.match(/\b(D[CMSV])\s*-?\s*(\d{2})\b/i);
  if (!m) return null;
  return { rubro: m[1].toUpperCase(), year: 2000 + Number(m[2]) };
}

function leafName(fullyQualified: string | null, displayName: string): string {
  if (fullyQualified && fullyQualified.includes(":")) return fullyQualified.split(":").pop()!.trim();
  return displayName;
}

export type FetchProjectsResult = { projects: QboProject[]; financialsOk: boolean };

export async function fetchQboProjects(opts?: { year?: number }): Promise<FetchProjectsResult> {
  const { customers } = await fetchQboCustomers();
  const byId = new Map(customers.map((c) => [c.id, c]));

  let projects: QboProject[] = customers
    .filter((c) => c.isProject)
    .map((p) => {
      const ry = parseRubroYear(p.displayName) ?? parseRubroYear(p.fullyQualifiedName ?? "");
      const parent = p.parentId ? byId.get(p.parentId) : null;
      return {
        id: p.id,
        name: leafName(p.fullyQualifiedName, p.displayName),
        fullName: p.displayName,
        rubro: ry?.rubro ?? null,
        year: ry?.year ?? null,
        clientName: parent?.displayName ?? "",
        income: null,
        cost: null,
        margin: null,
      };
    });

  if (opts?.year) projects = projects.filter((p) => p.year === opts.year);

  // Rentabilidad (best-effort): si el reporte de QBO responde, llenamos margen.
  let financialsOk = false;
  try {
    const fin = await fetchProjectFinancials(projects.map((p) => p.id));
    if (fin.size > 0) {
      financialsOk = true;
      for (const p of projects) {
        const f = fin.get(p.id) ?? fin.get(p.fullName) ?? fin.get(p.name);
        if (f) {
          p.income = f.income;
          p.cost = f.cost;
          p.margin = f.income > 0 ? (f.income - f.cost) / f.income : null;
        }
      }
    }
  } catch {
    /* sin financials: la lista igual se muestra */
  }

  return { projects: projects.sort((a, b) => a.fullName.localeCompare(b.fullName)), financialsOk };
}

// ── Rentabilidad por proyecto ────────────────────────────────────────────────
// QBO calcula el Income vs Cost por project. Lo sacamos con get_profit_and_loss
// FILTRADO por customer = el project (cada project es un customer). Una llamada
// por proyecto (chunked); el reporte es el formato estándar de Intuit.
async function fetchProjectFinancials(ids: string[]): Promise<Map<string, { income: number; cost: number }>> {
  const out = new Map<string, { income: number; cost: number }>();
  if (ids.length === 0) return out;
  const tools = await listQboTools();
  const tool = tools.find((t) => /profit.*loss|profit_loss|\bp_l\b|pnl/i.test(t.name));
  if (!tool) return out;

  const year = new Date().getFullYear();
  const start = `${year}-01-01`;
  const end = new Date().toISOString().slice(0, 10);

  const one = async (id: string): Promise<void> => {
    const variants: Record<string, unknown>[] = [
      { params: { start_date: start, end_date: end, customer: id } },
      { params: { start_date: start, end_date: end, customer_id: id } },
      { start_date: start, end_date: end, customer: id },
    ];
    for (const args of variants) {
      try {
        const fin = parsePnl(await callQboTool(tool.name, args));
        if (fin && (fin.income !== 0 || fin.cost !== 0)) {
          out.set(id, fin);
          return;
        }
      } catch {
        /* siguiente variante */
      }
    }
  };

  // Concurrencia baja para no saturar el server: de a 3, con respiro entre tandas.
  for (let i = 0; i < ids.length; i += 3) {
    await Promise.all(ids.slice(i, i + 3).map(one));
    if (i + 3 < ids.length) await new Promise((r) => setTimeout(r, 250));
  }
  return out;
}

type PnlRow = { group?: string; Summary?: { ColData?: { value?: string }[] }; Rows?: { Row?: PnlRow[] } };

// Parser del ProfitAndLoss de QBO (un solo customer/project). Toma los totales
// de las secciones de nivel superior; si hay NetIncome, cost = income - net.
function parsePnl(result: QboToolResult): { income: number; cost: number } | null {
  let json: unknown = result.structuredContent;
  if (json === undefined) {
    const text = (result.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n").trim();
    if (!text) return null;
    try {
      json = JSON.parse(text);
    } catch {
      return null;
    }
  }
  const report = (json as { Report?: unknown }).Report ?? json;
  const rows = ((report as { Rows?: { Row?: PnlRow[] } }).Rows?.Row ?? []) as PnlRow[];

  const total = (r: PnlRow): number => {
    const cd = r.Summary?.ColData ?? [];
    for (let i = cd.length - 1; i >= 0; i--) {
      const v = Number((cd[i].value ?? "").replace(/[^0-9.-]/g, ""));
      if (cd[i].value && !Number.isNaN(v)) return v;
    }
    return 0;
  };

  let income = 0;
  let cost = 0;
  let net: number | null = null;
  for (const r of rows) {
    const g = (r.group ?? "").toLowerCase();
    if (g === "income") income = total(r);
    else if (g === "netincome") net = total(r);
    else if (g === "cogs" || g === "expenses" || g === "otherexpenses" || g.includes("expense")) cost += total(r);
  }
  if (net !== null && income > 0) return { income, cost: income - net };
  return { income, cost };
}
