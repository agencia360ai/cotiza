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
    const fin = await fetchProjectFinancials();
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

// ── Rentabilidad por proyecto (best-effort; se valida contra el gateway) ──────
// Intenta un reporte de P&L resumido por customer/project. Devuelve
// Map<key, {income, cost}> donde key puede ser el id o el nombre del project.
async function fetchProjectFinancials(): Promise<Map<string, { income: number; cost: number }>> {
  const tools = await listQboTools();
  const tool = tools.find((t) => /profit.*loss|profit_loss|\bp_l\b|pnl/i.test(t.name));
  if (!tool) return new Map();

  const today = new Date().toISOString().slice(0, 10);
  const argsVariants: Record<string, unknown>[] = [
    { params: { start_date: `${today.slice(0, 4)}-01-01`, end_date: today, summarize_column_by: "Customers" } },
    { start_date: `${today.slice(0, 4)}-01-01`, end_date: today, summarize_column_by: "Customers" },
    { params: { summarize_column_by: "Customers" } },
  ];

  for (const args of argsVariants) {
    try {
      const res = await callQboTool(tool.name, args);
      const parsed = parsePnlByCustomer(res);
      if (parsed.size > 0) return parsed;
    } catch {
      /* probar siguiente variante */
    }
  }
  return new Map();
}

// Parser defensivo del reporte ProfitAndLoss de QBO resumido por customer.
// Estructura típica: { Columns: { Column: [...] }, Rows: { Row: [...] } }.
function parsePnlByCustomer(result: QboToolResult): Map<string, { income: number; cost: number }> {
  const out = new Map<string, { income: number; cost: number }>();
  let json: unknown = result.structuredContent;
  if (json === undefined) {
    const text = (result.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
    try {
      json = JSON.parse(text);
    } catch {
      return out;
    }
  }
  const report = (json as { Report?: unknown }).Report ?? json;
  const columns = ((report as { Columns?: { Column?: unknown[] } }).Columns?.Column ?? []) as { ColTitle?: string }[];
  // Mapea índice de columna → nombre del customer/project.
  const colNames: (string | null)[] = columns.map((c) => (c?.ColTitle ? c.ColTitle : null));

  type Row = { type?: string; group?: string; Summary?: { ColData?: { value?: string }[] }; Rows?: { Row?: Row[] } };
  const walk = (rows: Row[], bucket: "income" | "expense" | null) => {
    for (const r of rows) {
      const g = (r.group ?? "").toLowerCase();
      const next = g.includes("income") || g.includes("revenue") ? "income" : g.includes("expense") || g.includes("cogs") ? "expense" : bucket;
      const summary = r.Summary?.ColData ?? [];
      if (next && summary.length) {
        summary.forEach((cell, i) => {
          const name = colNames[i];
          const val = Number((cell.value ?? "").replace(/[^0-9.-]/g, "")) || 0;
          if (name && i > 0 && val) {
            const cur = out.get(name) ?? { income: 0, cost: 0 };
            if (next === "income") cur.income += val;
            else cur.cost += val;
            out.set(name, cur);
          }
        });
      }
      if (r.Rows?.Row) walk(r.Rows.Row, next);
    }
  };
  const topRows = ((report as { Rows?: { Row?: Row[] } }).Rows?.Row ?? []) as Row[];
  walk(topRows, null);
  return out;
}
