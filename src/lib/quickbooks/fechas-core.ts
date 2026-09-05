// Fechas REALES de los proyectos, sacadas de las transacciones.
//
// Hasta ahora `first_txn_date` / `last_txn_date` salían del P&L agrupado por
// MES, así que siempre caían en día 1: no porque el proyecto arrancara el 1
// sino porque así se agrupó el reporte. Las transacciones (facturas, compras,
// gastos) sí tienen `TxnDate`, que es un día de calendario.
//
// Este archivo es la parte pura: recibe lo que devolvió el gateway y saca
// (idProyecto → primera y última fecha). Sin red ni base, para poder probarlo.

/** Rango de actividad real de un proyecto. Ambas son fechas de calendario. */
export type RangoTxn = { primera: string; ultima: string };

/**
 * "YYYY-MM-DD" de un valor, o null.
 *
 * QBO manda `TxnDate` como "2026-03-14", pero algunos gateways reenvían el
 * timestamp completo. Se toma el prefijo de fecha de los dos.
 */
export function comoFecha(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  // Guardia de cordura: una fecha de 1900 o de 2190 no es un dato, es basura de
  // carga, y una sola alcanza para correr el inicio de un proyecto años atrás.
  return iso >= "2000-01-01" && iso <= "2099-12-31" ? iso : null;
}

const CAMPOS_FECHA = ["TxnDate", "txn_date", "txnDate", "Date", "date"];

function fechaDeTransaccion(o: Record<string, unknown>): string | null {
  for (const k of CAMPOS_FECHA) {
    const f = comoFecha(o[k]);
    if (f) return f;
  }
  return null;
}

/**
 * Todos los ids de cliente que aparecen bajo un nodo.
 *
 * Se busca en TODO el subárbol, no solo en la raíz: en una factura el
 * `CustomerRef` está arriba, pero en una compra o un gasto cuelga de cada
 * línea (`Line[].AccountBasedExpenseLineDetail.CustomerRef`). Mirar solo la
 * raíz dejaba afuera justamente el lado del gasto.
 */
export function idsDeCliente(n: unknown, out: Set<string>, depth = 0): void {
  if (!n || depth > 10) return;
  if (Array.isArray(n)) {
    for (const x of n) idsDeCliente(x, out, depth + 1);
    return;
  }
  if (typeof n !== "object") return;
  const o = n as Record<string, unknown>;

  for (const k of ["CustomerRef", "customer_ref", "customerRef"]) {
    const v = o[k];
    if (typeof v === "string" && v) out.add(v);
    else if (v && typeof v === "object") {
      const val = (v as Record<string, unknown>).value;
      if (typeof val === "string" && val) out.add(val);
    }
  }
  for (const k of ["customer_id", "customerId"]) {
    const v = o[k];
    if (typeof v === "string" && v) out.add(v);
  }

  for (const v of Object.values(o)) idsDeCliente(v, out, depth + 1);
}

/**
 * Recorre la respuesta juntando el rango de fechas de cada proyecto conocido.
 *
 * Se filtra contra `conocidos` por la misma razón que en el cobrado: un walk
 * genérico sin filtro levanta cualquier objeto con fecha e id y termina
 * inventando el arranque de un proyecto a partir de, por ejemplo, un pago a un
 * proveedor que no tiene nada que ver.
 */
export function cosecharFechas(
  node: unknown,
  out: Map<string, RangoTxn>,
  conocidos: Set<string>,
  depth = 0,
): void {
  if (!node || depth > 14) return;
  if (Array.isArray(node)) {
    for (const n of node) cosecharFechas(n, out, conocidos, depth + 1);
    return;
  }
  if (typeof node !== "object") return;
  const o = node as Record<string, unknown>;

  const fecha = fechaDeTransaccion(o);
  if (fecha) {
    const ids = new Set<string>();
    idsDeCliente(o, ids);
    for (const id of ids) {
      if (!conocidos.has(id)) continue;
      const r = out.get(id);
      if (!r) out.set(id, { primera: fecha, ultima: fecha });
      else {
        if (fecha < r.primera) r.primera = fecha;
        if (fecha > r.ultima) r.ultima = fecha;
      }
    }
  }

  for (const v of Object.values(o)) cosecharFechas(v, out, conocidos, depth + 1);
}

/**
 * Fusiona lo cosechado de varias fuentes (facturas, compras, gastos…).
 *
 * Un proyecto arranca con lo PRIMERO que pasó, sea una compra de material o la
 * primera factura, y termina con lo último. Tomar solo las facturas hacía
 * arrancar el proyecto el día que se cobró, no el día que empezó el trabajo.
 */
export function fusionar(destino: Map<string, RangoTxn>, extra: Map<string, RangoTxn>): void {
  for (const [id, r] of extra) {
    const y = destino.get(id);
    if (!y) destino.set(id, { ...r });
    else {
      if (r.primera < y.primera) y.primera = r.primera;
      if (r.ultima > y.ultima) y.ultima = r.ultima;
    }
  }
}
