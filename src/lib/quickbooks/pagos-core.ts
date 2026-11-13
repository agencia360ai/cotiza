// La plata de los pagos de QuickBooks, factura por factura. Sin red: se prueba solo.
//
// En QuickBooks un "pago" no siempre es plata: aplicar una nota de crédito a
// una factura se registra como un pago de $0. Contar como cobrado todo lo que
// cierra una factura (total − saldo) marcaba cobradas facturas anuladas.

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Plata recibida por factura (Invoice.Id → monto), de los pagos de QuickBooks.
 *
 * Un pago puede aplicar facturas y, además, notas de crédito o asientos. Su
 * monto (TotalAmt) es lo único que fue dinero; se reparte entre lo que el pago
 * cubre (facturas y asientos) en proporción. Un pago de $0 que solo aplica una
 * nota de crédito no le da plata a nadie.
 */
export function plataPorFactura(pagos: Record<string, unknown>[]): Map<string, number> {
  const out = new Map<string, number>();
  const vistos = new Set<string>();
  for (const p of pagos) {
    const id = typeof p.Id === "string" ? p.Id : null;
    if (id && vistos.has(id)) continue;
    if (id) vistos.add(id);
    const lineas = (Array.isArray(p.Line) ? p.Line : []) as Record<string, unknown>[];
    const tipoDe = (l: Record<string, unknown>) =>
      ((Array.isArray(l.LinkedTxn) ? l.LinkedTxn : []) as { TxnType?: unknown; TxnId?: unknown }[]).map((x) => ({
        tipo: x.TxnType,
        id: typeof x.TxnId === "string" ? x.TxnId : null,
      }));
    let cubre = 0;
    for (const l of lineas) if (tipoDe(l).some((x) => x.tipo === "Invoice" || x.tipo === "JournalEntry")) cubre += num(l.Amount);
    const factor = cubre > 0 ? Math.min(1, Math.max(0, num(p.TotalAmt)) / cubre) : 0;
    for (const l of lineas) {
      for (const x of tipoDe(l)) {
        if (x.tipo !== "Invoice" || !x.id) continue;
        out.set(x.id, r2((out.get(x.id) ?? 0) + num(l.Amount) * factor));
      }
    }
  }
  return out;
}

/**
 * Lo aplicado a una factura, separado en plata y crédito. Sin la lista de
 * pagos (`plata` undefined) todo lo aplicado cuenta como plata, como antes.
 */
export function aplicadoEnPlata(f: Record<string, unknown>, plata?: Map<string, number>): { plata: number; credito: number } {
  const total = num(f.TotalAmt);
  const aplicado = Math.min(total, Math.max(0, total - num(f.Balance ?? total)));
  if (!plata) return { plata: aplicado, credito: 0 };
  const enPlata = Math.min(aplicado, typeof f.Id === "string" ? (plata.get(f.Id) ?? 0) : 0);
  return { plata: r2(enPlata), credito: r2(aplicado - enPlata) };
}
