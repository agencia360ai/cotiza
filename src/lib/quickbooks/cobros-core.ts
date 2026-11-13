import { esPorFacturar } from "./estimados-core";

// Lo cobrado de cada proyecto, sacado de los PAGOS registrados en QuickBooks.
//
// Antes se deducía: facturado − saldo de cuentas por cobrar, y un proyecto que
// no aparecía en ese reporte se daba por cobrado entero. Eso marcaba como
// pagadas facturas sin ningún pago registrado. Ahora sale de cada factura: lo
// pagado es lo que QuickBooks le aplicó (total − saldo), y todo lo demás está
// por cobrar.
//
// Va CON ITBMS, como entra al banco. Se agrupa por el mes de la factura para
// que el rango de fechas del tablero cuente lo cobrado de lo facturado en ese
// rango. Las facturas por facturar (EST, fechadas a futuro) no van acá: lo que
// tengan pagado es anticipo y se lleva en estimados-core.

/** Un mes de un proyecto: lo facturado (con ITBMS) y lo que ya se pagó de eso. */
export type CobroMes = { month: string; facturado: number; cobrado: number };

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Facturas y recibos de venta → cobros por proyecto y mes.
 *
 * Un recibo de venta (SalesReceipt) se cobra en el acto: entra entero como
 * facturado y cobrado. `conocidos` filtra a los proyectos del tablero.
 */
export function agruparCobros(
  facturas: Record<string, unknown>[],
  recibos: Record<string, unknown>[],
  conocidos: Set<string>,
  hoy: string,
): Map<string, CobroMes[]> {
  const acc = new Map<string, Map<string, CobroMes>>();
  const vistas = new Set<string>();
  const sumar = (f: Record<string, unknown>, cobrado: number, tipo: string) => {
    const cliente = (f.CustomerRef as { value?: unknown } | undefined)?.value;
    if (typeof cliente !== "string" || !conocidos.has(cliente)) return;
    if (typeof f.TxnDate !== "string") return;
    const id = typeof f.Id === "string" ? `${tipo}:${f.Id}` : null;
    if (id && vistas.has(id)) return;
    if (id) vistas.add(id);
    const month = `${f.TxnDate.slice(0, 7)}-01`;
    const meses = acc.get(cliente) ?? new Map<string, CobroMes>();
    const m = meses.get(month) ?? { month, facturado: 0, cobrado: 0 };
    m.facturado = r2(m.facturado + num(f.TotalAmt));
    m.cobrado = r2(m.cobrado + cobrado);
    meses.set(month, m);
    acc.set(cliente, meses);
  };
  for (const f of facturas) {
    if (esPorFacturar(f, hoy)) continue;
    const total = num(f.TotalAmt);
    sumar(f, Math.min(total, Math.max(0, total - num(f.Balance ?? total))), "inv");
  }
  for (const r of recibos) sumar(r, num(r.TotalAmt), "rcp");
  const out = new Map<string, CobroMes[]>();
  for (const [id, meses] of acc) out.set(id, [...meses.values()].sort((a, b) => a.month.localeCompare(b.month)));
  return out;
}

/** Lo que se guardó en la base, validado. null = sin dato (no "cero"). */
export function normalizarCobros(v: unknown): CobroMes[] | null {
  if (!Array.isArray(v)) return null;
  const out: CobroMes[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    if (typeof o.month !== "string" || !/^\d{4}-\d{2}-01$/.test(o.month)) continue;
    out.push({ month: o.month, facturado: num(o.facturado), cobrado: num(o.cobrado) });
  }
  return out;
}

/**
 * Facturado y cobrado dentro de un rango. `fraccion(mes)` dice qué parte del
 * mes cae en el rango (1 sin rango), igual que para el resto de los montos.
 */
export function cobrosEnRango(cobros: CobroMes[], fraccion: (month: string) => number): { facturado: number; cobrado: number } {
  let facturado = 0;
  let cobrado = 0;
  for (const m of cobros) {
    const f = fraccion(m.month);
    if (f <= 0) continue;
    facturado += m.facturado * f;
    cobrado += m.cobrado * f;
  }
  return { facturado: r2(facturado), cobrado: r2(cobrado) };
}
