// Extracción de entidades desde lo que devuelve el gateway MCP de QuickBooks.
//
// El mismo gateway contesta en cuatro formas distintas según el tool: JSON
// estructurado, un array pelado, el `{ QueryResponse: { Entidad: [...] } }` de
// Intuit, o un blob de texto tipo "Found 82 customers:{…}{…}" con los objetos
// concatenados sin comas. Esto vivía dentro de customers.ts; se sacó acá porque
// el sync de fechas necesita exactamente lo mismo para facturas y compras.

import type { QboToolResult } from "./mcp";

/** Objetos `{…}` de nivel superior dentro de un blob (ignora llaves en strings). */
export function parseConcatenatedObjects(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          out.push(JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>);
        } catch {
          /* objeto incompleto */
        }
        start = -1;
      }
    }
  }
  return out;
}

/** Encuentra el array de entidades dentro de un JSON, sea cual sea su envoltorio. */
export function digArray(json: unknown, entity: string): Record<string, unknown>[] {
  if (json == null || typeof json !== "object") return [];
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  const o = json as Record<string, unknown>;
  const qr = o.QueryResponse as Record<string, unknown> | undefined;
  if (qr && Array.isArray(qr[entity])) return qr[entity] as Record<string, unknown>[];
  const claves = [entity, `${entity}s`, entity.toLowerCase(), `${entity.toLowerCase()}s`, "data", "items", "results", "value"];
  for (const key of claves) {
    if (Array.isArray(o[key])) return o[key] as Record<string, unknown>[];
  }
  if (o.Id || o.id || o.DisplayName || o.displayName) return [o];
  return [];
}

/** Lista de entidades del tool result, probando todas las formas. */
export function extractEntities(result: QboToolResult, entity: string): Record<string, unknown>[] {
  if (result.structuredContent !== undefined) {
    const a = digArray(result.structuredContent, entity);
    if (a.length) return a;
  }
  const text = (result.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("\n")
    .trim();
  if (!text) return [];
  try {
    const a = digArray(JSON.parse(text), entity);
    if (a.length) return a;
  } catch {
    /* no es JSON limpio: cae al scanner */
  }
  return parseConcatenatedObjects(text);
}

export function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

export function nested(o: Record<string, unknown>, a: string, b: string): string | null {
  const x = o[a] as Record<string, unknown> | undefined;
  return x ? str(x[b]) : null;
}

/** "2026-03-14T09:12:00-05:00" · "2026-03-14" · "03/14/2026" → "2026-03-14". */
export function toIsoDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  const d = new Date(s);
  return Number.isNaN(+d) ? null : d.toISOString().slice(0, 10);
}

// ── Profit & Loss ────────────────────────────────────────────────────────────

/** Un mes con movimiento del proyecto. `month` = primer día: "2026-03-01". */
export type MonthPnl = { month: string; income: number; cost: number };
export type Pnl = { income: number; cost: number; meses: MonthPnl[] };

type PnlRow = { group?: string; Summary?: { ColData?: { value?: string }[] }; Rows?: { Row?: PnlRow[] } };
// Cabecera de columnas. Con summarize_column_by=Month cada columna es un mes y
// trae su rango en MetaData ({ Name:"StartDate", Value:"2026-03-01" }); la
// primera columna (la cuenta) y la última (Total) no traen StartDate.
type PnlColumn = { ColTitle?: string; ColType?: string; MetaData?: { Name?: string; Value?: string }[] };

// Un valor contable de QBO: "1,234.56" · "(62.00)" (negativo) · "" (sin dato).
function montoDe(raw: string | undefined): number {
  if (!raw) return 0;
  const neg = /^\s*\(.*\)\s*$/.test(raw);
  const v = Number(raw.replace(/[^0-9.-]/g, ""));
  if (Number.isNaN(v)) return 0;
  return neg ? -Math.abs(v) : v;
}

const ES_INGRESO = (g: string) => g === "income" || g === "otherincome";
const ES_GASTO = (g: string) => g === "cogs" || g === "expenses" || g === "otherexpenses" || g.includes("expense");

/**
 * Parser del ProfitAndLoss de QBO (un solo customer/project). Toma los totales
 * de las secciones de nivel superior; si hay NetIncome, cost = income - net.
 * Con summarize_column_by=Month desglosa además cada mes: el total sigue
 * saliendo de la ÚLTIMA columna con valor, que es exactamente la de Total.
 */
export function parsePnl(result: QboToolResult): Pnl | null {
  let json: unknown = result.structuredContent;
  if (json === undefined) {
    const text = (result.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n").trim();
    // El gateway antepone "Profit and Loss Report:" antes del JSON → arrancamos en la "{".
    const start = text.indexOf("{");
    if (start < 0) return null;
    try {
      json = JSON.parse(text.slice(start));
    } catch {
      return null;
    }
  }
  const report = (json as { Report?: unknown }).Report ?? json;
  const rows = ((report as { Rows?: { Row?: PnlRow[] } }).Rows?.Row ?? []) as PnlRow[];

  const total = (r: PnlRow): number => {
    const cd = r.Summary?.ColData ?? [];
    for (let i = cd.length - 1; i >= 0; i--) {
      const raw = cd[i].value ?? "";
      if (raw) return montoDe(raw);
    }
    return 0;
  };

  let income = 0;
  let cost = 0;
  let net: number | null = null;
  let huboGastos = false;
  for (const r of rows) {
    const g = (r.group ?? "").toLowerCase();
    if (ES_INGRESO(g)) income += total(r);
    else if (g === "netincome") net = total(r);
    else if (ES_GASTO(g)) {
      cost += total(r);
      huboGastos = true;
    }
  }
  const meses = parseMeses(report, rows);
  // cost = income - net SOLO como fallback cuando el reporte no trae secciones
  // de gastos: con OtherIncome presente, esa resta daba costos NEGATIVOS y
  // márgenes >100% (net incluye el otro ingreso).
  if (!huboGastos && net !== null && income > 0) return { income, cost: income - net, meses };
  return { income, cost, meses };
}

// Desglose mensual. Sin summarize_column_by=Month (o si el gateway lo ignora)
// no hay columnas con StartDate y devuelve [] — el caller cae al camino viejo.
function parseMeses(report: unknown, rows: PnlRow[]): MonthPnl[] {
  const cols = ((report as { Columns?: { Column?: PnlColumn[] } }).Columns?.Column ?? []) as PnlColumn[];
  const mesPorCol = new Map<number, string>();
  cols.forEach((c, i) => {
    const inicio = c.MetaData?.find((m) => m.Name === "StartDate")?.Value;
    if (inicio && /^\d{4}-\d{2}-\d{2}/.test(inicio)) mesPorCol.set(i, `${inicio.slice(0, 7)}-01`);
  });
  if (mesPorCol.size === 0) return [];

  const acc = new Map<string, { income: number; cost: number }>();
  for (const [, mes] of mesPorCol) acc.set(mes, { income: 0, cost: 0 });
  for (const r of rows) {
    const g = (r.group ?? "").toLowerCase();
    const ingreso = ES_INGRESO(g);
    // netincome ya está contenido en las otras secciones: sumarlo lo duplicaría.
    if (!ingreso && !ES_GASTO(g)) continue;
    const cd = r.Summary?.ColData ?? [];
    for (const [i, mes] of mesPorCol) {
      const v = montoDe(cd[i]?.value);
      if (v === 0) continue;
      const b = acc.get(mes)!;
      if (ingreso) b.income += v;
      else b.cost += v;
    }
  }
  return Array.from(acc, ([month, v]) => ({ month, ...v })).sort((a, b) => a.month.localeCompare(b.month));
}

/** Primer y último mes con movimiento (income o cost ≠ 0). */
export function ventanaDeMeses(meses: MonthPnl[]): { first: string; last: string } | null {
  const conMovimiento = meses.filter((m) => m.income !== 0 || m.cost !== 0).map((m) => m.month).sort();
  if (conMovimiento.length === 0) return null;
  const last = conMovimiento[conMovimiento.length - 1];
  // El fin es el ÚLTIMO DÍA del mes: un proyecto cuyo único movimiento es marzo
  // debe cubrir marzo entero, no morir el día 1.
  const [y, m] = last.split("-").map(Number);
  return { first: conMovimiento[0], last: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
}
