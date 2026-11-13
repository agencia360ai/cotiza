import type { SeccionDesglose } from "./desglose-core";
import type { MonthPnl } from "./parse";

// Lo que el proyecto todavía no facturó: las "facturas" EST de QuickBooks y
// cualquier otra fechada en el futuro (las P26-…).
//
// El equipo carga como factura el monto del contrato que falta facturar, con
// número EST… ("ESTDC26-23", "EST DS26-01", "Est06") y fecha en un mes
// futuro, para que no entre en la contabilidad del mes. Las P26-… (y alguna
// 0090-…) se movieron igual a diciembre y, según el equipo, son lo mismo: por
// facturar, y lo que ya pagaron es anticipo. Son ingresos por venir del
// proyecto, no facturado: se muestran aparte y, si alguna vez su fecha cae
// dentro de lo que se lee, se descuentan del facturado. Sin red: se prueba solo.

export type DocEstimado = {
  numero: string;
  fecha: string; // TxnDate: la fecha "movida", no la del trabajo
  neto: number; // sin ITBMS, como el ingreso del Estado de Resultados
  total: number; // con ITBMS, lo que se le cobraría
  cobrado: number; // anticipos ya aplicados a esa EST (total − saldo)
  cuentas: { cuenta: string; monto: number }[]; // por cuenta de ingreso, para descontar del desglose
};

export type PorFacturar = { neto: number; cobrado: number; docs: DocEstimado[] };

/** Una EST: el número empieza con "EST" (en cualquier forma de escribirlo). */
export const esEstimado = (numero: unknown): boolean => typeof numero === "string" && /^\s*est/i.test(numero);

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * ¿Esta factura es "por facturar"? Una EST siempre; cualquier otra, si está
 * fechada después de `hoy` (YYYY-MM-DD). Sin `hoy`, solo las EST.
 */
export function esPorFacturar(f: Record<string, unknown>, hoy?: string): boolean {
  if (esEstimado(f.DocNumber)) return true;
  return !!hoy && typeof f.TxnDate === "string" && f.TxnDate.slice(0, 10) > hoy;
}

/** Las facturas por facturar (EST y fechadas a futuro), agrupadas por proyecto (CustomerRef). */
export function agruparEstimados(facturas: Record<string, unknown>[], hoy?: string): Map<string, PorFacturar> {
  const out = new Map<string, PorFacturar>();
  const vistas = new Set<string>();
  for (const f of facturas) {
    if (!esPorFacturar(f, hoy)) continue;
    const cliente = (f.CustomerRef as { value?: unknown } | undefined)?.value;
    if (typeof cliente !== "string") continue;
    const id = typeof f.Id === "string" ? f.Id : null;
    if (id && vistas.has(id)) continue;
    if (id) vistas.add(id);

    const total = num(f.TotalAmt);
    const impuesto = num((f.TxnTaxDetail as { TotalTax?: unknown } | undefined)?.TotalTax);
    const cuentas: DocEstimado["cuentas"] = [];
    for (const l of (Array.isArray(f.Line) ? f.Line : []) as Record<string, unknown>[]) {
      if (l.DetailType !== "SalesItemLineDetail") continue;
      const det = l.SalesItemLineDetail as { ItemAccountRef?: { name?: unknown } } | undefined;
      const cuenta = typeof det?.ItemAccountRef?.name === "string" ? det.ItemAccountRef.name : "";
      const ya = cuentas.find((c) => c.cuenta === cuenta);
      if (ya) ya.monto = r2(ya.monto + num(l.Amount));
      else cuentas.push({ cuenta, monto: r2(num(l.Amount)) });
    }
    const doc: DocEstimado = {
      numero: typeof f.DocNumber === "string" ? f.DocNumber.trim() : "(sin número)",
      fecha: typeof f.TxnDate === "string" ? f.TxnDate.slice(0, 10) : "",
      neto: r2(total - impuesto),
      total: r2(total),
      cobrado: r2(Math.max(0, total - num(f.Balance ?? total))),
      cuentas,
    };
    const p = out.get(cliente) ?? { neto: 0, cobrado: 0, docs: [] };
    p.docs.push(doc);
    p.neto = r2(p.neto + doc.neto);
    p.cobrado = r2(p.cobrado + doc.cobrado);
    out.set(cliente, p);
  }
  for (const p of out.values()) p.docs.sort((a, b) => b.neto - a.neto);
  return out;
}

/**
 * Lo facturado sin las EST que caen dentro de la ventana leída. Hoy están
 * fechadas en un mes futuro y no entran; el día que esa fecha llegue, el
 * Estado de Resultados las va a sumar como ingreso y acá se sacan, para que
 * nunca se lean como facturadas.
 */
export function sinEstimados<T extends { income: number; meses: MonthPnl[]; desglose?: SeccionDesglose[] }>(
  pnl: T,
  pf: PorFacturar | undefined,
  desde: string,
  hasta: string,
): T {
  const adentro = (pf?.docs ?? []).filter((d) => d.fecha >= desde && d.fecha <= hasta);
  if (adentro.length === 0) return pnl;
  const meses = pnl.meses.map((m) => ({ ...m }));
  const desglose = pnl.desglose?.map((s) => ({ ...s, cuentas: s.cuentas.map((c) => ({ ...c, meses: { ...c.meses } })) }));
  let income = pnl.income;
  for (const d of adentro) {
    income -= d.neto;
    const mes = `${d.fecha.slice(0, 7)}-01`;
    const m = meses.find((x) => x.month === mes);
    if (m) m.income = r2(m.income - d.neto);
    const ingresos = desglose?.find((s) => s.tipo === "ingreso");
    if (!ingresos) continue;
    for (const c of d.cuentas) {
      const cuenta = ingresos.cuentas.find((x) => x.nombre === c.cuenta);
      if (!cuenta) continue;
      cuenta.total = r2(cuenta.total - c.monto);
      if (cuenta.meses[mes] !== undefined) cuenta.meses[mes] = r2(cuenta.meses[mes] - c.monto);
      ingresos.total = r2(ingresos.total - c.monto);
    }
  }
  return { ...pnl, income: r2(income), meses, ...(desglose ? { desglose } : {}) };
}

/** Lo guardado en la base, validado. */
export function normalizarPorFacturar(v: unknown): PorFacturar | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.docs)) return null;
  const docs: DocEstimado[] = (o.docs as Record<string, unknown>[])
    .filter((d) => d && typeof d.numero === "string" && typeof d.neto === "number")
    .map((d) => ({
      numero: d.numero as string,
      fecha: typeof d.fecha === "string" ? d.fecha : "",
      neto: d.neto as number,
      total: num(d.total),
      cobrado: num(d.cobrado),
      cuentas: Array.isArray(d.cuentas) ? (d.cuentas as DocEstimado["cuentas"]).filter((c) => c && typeof c.monto === "number") : [],
    }));
  if (docs.length === 0) return null;
  return { neto: r2(docs.reduce((a, d) => a + d.neto, 0)), cobrado: r2(docs.reduce((a, d) => a + d.cobrado, 0)), docs };
}

/**
 * Margen BRUTO sobre lo que el proyecto va a facturar en total: lo ya
 * facturado más lo que está en EST, contra todo lo gastado en el proyecto.
 * Bruto porque no descuenta los gastos generales de la empresa (oficina,
 * administración): solo los costos cargados al proyecto.
 *
 * null cuando no hay ingreso previsto o el gasto no es confiable (negativo:
 * suele ser el ITBMS acreditado a una cuenta de costo).
 */
export function margenBruto(facturado: number | null, porFacturar: number, gasto: number | null): number | null {
  const previsto = (facturado ?? 0) + Math.max(0, porFacturar);
  if (previsto <= 0 || gasto === null || gasto < 0) return null;
  return (previsto - gasto) / previsto;
}
