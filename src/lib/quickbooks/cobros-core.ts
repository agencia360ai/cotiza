import { esPorFacturar } from "./estimados-core";
import { aplicadoEnPlata } from "./pagos-core";

// Lo cobrado de cada proyecto: la PLATA de los pagos registrados en QuickBooks.
//
// Antes se deducía: facturado − saldo de cuentas por cobrar, y un proyecto que
// no aparecía en ese reporte se daba por cobrado entero. Después se tomó "total
// − saldo" de cada factura, pero eso cuenta como cobrado cualquier cosa que la
// cierre: en QuickBooks una nota de crédito se aplica con un "pago" de $0
// (DC26-24: la factura #210 se anuló con la nota #211 y figuraba cobrada sin
// que entrara un centavo). Ahora cuenta solo el monto en dinero de cada pago;
// lo que se cerró con notas de crédito no es cobrado ni por cobrar: se resta
// de lo facturado.
//
// Va CON ITBMS, como entra al banco. Se agrupa por el mes de la factura para
// que el rango de fechas del tablero cuente lo cobrado de lo facturado en ese
// rango. Las facturas por facturar (EST, fechadas a futuro) no van acá: lo que
// tengan pagado es anticipo y se lleva en estimados-core.

/** Un mes de un proyecto: lo facturado (con ITBMS, sin lo anulado con notas de crédito) y lo que ya se pagó en plata. */
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
  plata?: Map<string, number>,
): Map<string, CobroMes[]> {
  const acc = new Map<string, Map<string, CobroMes>>();
  const vistas = new Set<string>();
  const sumar = (f: Record<string, unknown>, facturado: number, cobrado: number, tipo: string) => {
    const cliente = (f.CustomerRef as { value?: unknown } | undefined)?.value;
    if (typeof cliente !== "string" || !conocidos.has(cliente)) return;
    if (typeof f.TxnDate !== "string") return;
    const id = typeof f.Id === "string" ? `${tipo}:${f.Id}` : null;
    if (id && vistas.has(id)) return;
    if (id) vistas.add(id);
    const month = `${f.TxnDate.slice(0, 7)}-01`;
    const meses = acc.get(cliente) ?? new Map<string, CobroMes>();
    const m = meses.get(month) ?? { month, facturado: 0, cobrado: 0 };
    m.facturado = r2(m.facturado + facturado);
    m.cobrado = r2(m.cobrado + cobrado);
    meses.set(month, m);
    acc.set(cliente, meses);
  };
  for (const f of facturas) {
    if (esPorFacturar(f, hoy)) continue;
    // Lo anulado con notas de crédito no se facturó de verdad: sale de las dos.
    const a = aplicadoEnPlata(f, plata);
    sumar(f, num(f.TotalAmt) - a.credito, a.plata, "inv");
  }
  for (const r of recibos) sumar(r, num(r.TotalAmt), num(r.TotalAmt), "rcp");
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
