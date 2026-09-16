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
export type MonthPnl = { month: string; income: number; cost: number; tax: number };
export type Pnl = { income: number; cost: number; tax: number; meses: MonthPnl[] };

type PnlCol = { value?: string };
type PnlRow = {
  group?: string;
  ColData?: PnlCol[]; // filas de dato (una cuenta); las secciones no la traen
  Summary?: { ColData?: PnlCol[] };
  Rows?: { Row?: PnlRow[] };
};
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

// El ITBMS que se le factura al cliente aterriza en una cuenta de SISTEMA de QBO
// —"VAT Expense", AccountSubType GlobalTaxExpense— que vive DENTRO de la sección
// de gastos y con signo negativo, porque la venta la acredita. #217 diagnosticó
// esto pero no pudo filtrarlo: el gateway tenía el token vencido y no se quiso
// adivinar la forma del reporte. Ya se leyó el reporte real y la cuenta es esa,
// así que acá se separa: el impuesto no es costo del proyecto (es recaudación
// para el fisco) y pasa a ser su propia columna.
//
// El patrón es angosto a propósito: "Impuesto Municipal", "Impuesto de Inmueble",
// "Tasa Única" y "Gasto de Impuesto sobre la Renta" SÍ son gastos reales de Dicec
// y tienen que seguir contando como costo.
const ES_CUENTA_IMPUESTO = (nombre: string) => /\bvat\b|\bitbms\b|\bsales tax\b/i.test(nombre);

/** Filas de dato (hoja) de una sección. Recursivo: las sub-cuentas anidan. */
function hojasDe(seccion: PnlRow, out: PnlRow[] = []): PnlRow[] {
  for (const r of seccion.Rows?.Row ?? []) {
    if (r.Rows?.Row?.length) hojasDe(r, out);
    else if (r.ColData?.length) out.push(r);
  }
  return out;
}

/**
 * Monto de una fila. `col` null = la columna Total (la última con valor).
 * Nunca la columna 0, que es el nombre de la cuenta y no un monto.
 */
function montoEn(cd: PnlCol[] | undefined, col: number | null): number {
  const cols = cd ?? [];
  if (col !== null) return montoDe(cols[col]?.value);
  for (let i = cols.length - 1; i >= 1; i--) {
    if (cols[i].value) return montoDe(cols[i].value);
  }
  return 0;
}

/**
 * Parte una sección en costo real vs impuesto, sumando CUENTA POR CUENTA. Leer
 * el Summary de la sección es justamente lo que impedía separarlos.
 * `impuesto` sale con el signo del reporte (negativo = recaudado en la venta).
 * Si la sección no trae desglose, cae al Summary y no hay nada que separar.
 */
function partirSeccion(seccion: PnlRow, col: number | null): { normal: number; impuesto: number } {
  const hojas = hojasDe(seccion);
  if (hojas.length === 0) return { normal: montoEn(seccion.Summary?.ColData, col), impuesto: 0 };
  let normal = 0;
  let impuesto = 0;
  for (const h of hojas) {
    const v = montoEn(h.ColData, col);
    if (ES_CUENTA_IMPUESTO(h.ColData?.[0]?.value ?? "")) impuesto += v;
    else normal += v;
  }
  return { normal, impuesto };
}

/**
 * Parser del ProfitAndLoss de QBO (un solo customer/project). Suma las secciones
 * de nivel superior CUENTA POR CUENTA, apartando el ITBMS en `tax` (ver
 * ES_CUENTA_IMPUESTO); si hay NetIncome, cost = income - net como fallback.
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

  let income = 0;
  let cost = 0;
  // El impuesto se guarda POSITIVO = lo cobrado al cliente. En el reporte viene
  // como crédito (negativo), de ahí el signo invertido al acumular.
  let tax = 0;
  let net: number | null = null;
  let huboGastos = false;
  for (const r of rows) {
    const g = (r.group ?? "").toLowerCase();
    if (ES_INGRESO(g)) {
      const s = partirSeccion(r, null);
      income += s.normal;
      tax -= s.impuesto;
    } else if (g === "netincome") {
      // NetIncome no tiene desglose: sale del Summary y SÍ incluye el impuesto.
      // Por eso solo sirve de fallback, nunca para restar.
      net = montoEn(r.Summary?.ColData, null);
    } else if (ES_GASTO(g)) {
      const s = partirSeccion(r, null);
      cost += s.normal;
      tax -= s.impuesto;
      // La sección existe aunque el filtro la deje en 0 (proyecto cuyo único
      // "gasto" era el ITBMS). Marcarla igual evita caer al fallback income-net,
      // que reinyectaría el impuesto como costo negativo.
      huboGastos = true;
    }
  }
  const meses = parseMeses(report, rows);
  // cost = income - net SOLO como fallback cuando el reporte no trae secciones
  // de gastos: con OtherIncome presente, esa resta daba costos NEGATIVOS y
  // márgenes >100% (net incluye el otro ingreso).
  if (!huboGastos && net !== null && income > 0) return { income, cost: income - net, tax, meses };
  return { income, cost, tax, meses };
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

  const acc = new Map<string, { income: number; cost: number; tax: number }>();
  for (const [, mes] of mesPorCol) acc.set(mes, { income: 0, cost: 0, tax: 0 });
  for (const r of rows) {
    const g = (r.group ?? "").toLowerCase();
    const ingreso = ES_INGRESO(g);
    // netincome ya está contenido en las otras secciones: sumarlo lo duplicaría.
    if (!ingreso && !ES_GASTO(g)) continue;
    for (const [i, mes] of mesPorCol) {
      const { normal, impuesto } = partirSeccion(r, i);
      if (normal === 0 && impuesto === 0) continue;
      const b = acc.get(mes)!;
      if (ingreso) b.income += normal;
      else b.cost += normal;
      b.tax -= impuesto;
    }
  }
  return Array.from(acc, ([month, v]) => ({ month, ...v })).sort((a, b) => a.month.localeCompare(b.month));
}

// ── Desglose por cuenta ──────────────────────────────────────────────────────

/** Una sección del P&L con las cuentas que la componen. */
export type SeccionPnl = {
  grupo: string;
  total: number;
  cuentas: { nombre: string; total: number }[];
};

/**
 * Las secciones del P&L abiertas por cuenta.
 *
 * `parsePnl` solo lee los TOTALES de cada sección, que alcanza para el board
 * pero no para explicar un número raro. Cuando una sección de gastos da
 * negativo —el ITBMS entrando como crédito, un reembolso mal clasificado— la
 * única forma de saber qué cuenta lo causa es mirar adentro. Esto es lo que
 * mira: nombre de cuenta y monto, sin interpretar nada.
 */
export function desglosarPnl(result: QboToolResult): SeccionPnl[] {
  let json: unknown = result.structuredContent;
  if (json === undefined) {
    const text = (result.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n").trim();
    const start = text.indexOf("{");
    if (start < 0) return [];
    try {
      json = JSON.parse(text.slice(start));
    } catch {
      return [];
    }
  }
  const report = (json as { Report?: unknown }).Report ?? json;
  const rows = ((report as { Rows?: { Row?: PnlRowDetalle[] } }).Rows?.Row ?? []) as PnlRowDetalle[];

  const ultimoMonto = (cd: { value?: string }[] | undefined): number => {
    for (let i = (cd ?? []).length - 1; i >= 0; i--) {
      const raw = cd![i].value ?? "";
      if (raw) return montoDe(raw);
    }
    return 0;
  };

  // Las cuentas pueden estar anidadas varios niveles (subcuentas); se aplanan,
  // que es como se leen en el reporte impreso.
  const cuentasDe = (r: PnlRowDetalle, out: { nombre: string; total: number }[], prof = 0): void => {
    if (prof > 8) return;
    for (const hija of r.Rows?.Row ?? []) {
      const cd = hija.ColData ?? hija.Summary?.ColData;
      const nombre = cd?.[0]?.value;
      if (nombre) out.push({ nombre, total: ultimoMonto(cd) });
      cuentasDe(hija, out, prof + 1);
    }
  };

  const out: SeccionPnl[] = [];
  for (const r of rows) {
    const grupo = r.group ?? "";
    if (!grupo) continue;
    const cuentas: { nombre: string; total: number }[] = [];
    cuentasDe(r, cuentas);
    out.push({ grupo, total: ultimoMonto(r.Summary?.ColData), cuentas });
  }
  return out;
}

type PnlRowDetalle = PnlRow & { ColData?: { value?: string }[]; Rows?: { Row?: PnlRowDetalle[] } };

/** Primer y último mes con movimiento (income o cost ≠ 0). */
export function ventanaDeMeses(meses: MonthPnl[]): { first: string; last: string } | null {
  // El impuesto cuenta como movimiento: si hubo ITBMS, hubo una transacción ese
  // mes. Antes entraba por `cost` (el crédito del ITBMS lo hacía ≠ 0); ahora que
  // se aparta en `tax`, omitirlo acá encogería la ventana de fechas del proyecto.
  const conMovimiento = meses.filter((m) => m.income !== 0 || m.cost !== 0 || m.tax !== 0).map((m) => m.month).sort();
  if (conMovimiento.length === 0) return null;
  const last = conMovimiento[conMovimiento.length - 1];
  // El fin es el ÚLTIMO DÍA del mes: un proyecto cuyo único movimiento es marzo
  // debe cubrir marzo entero, no morir el día 1.
  const [y, m] = last.split("-").map(Number);
  return { first: conMovimiento[0], last: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
}
