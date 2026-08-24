// El gateway no devuelve el reporte como objeto: lo devuelve SERIALIZADO como
// string dentro del envoltorio MCP —{ content: [{ type:"text", text:"{...}" }] }—
// igual que hace con el P&L. Recorrer el objeto sin desenvolverlo encuentra un
// `text` que es texto plano y nada más: por eso salían 0 ids y "s/d" en los 86
// proyectos. parse.ts ya resolvía esto para el P&L; este archivo no lo reusó.
export function desenvolver(raw: unknown): unknown[] {
  const out: unknown[] = [raw];
  const textos: string[] = [];
  const juntar = (n: unknown, d = 0): void => {
    if (!n || d > 6) return;
    if (Array.isArray(n)) return n.forEach((x) => juntar(x, d + 1));
    if (typeof n !== "object") return;
    const o = n as Record<string, unknown>;
    if (typeof o.text === "string") textos.push(o.text);
    Object.values(o).forEach((x) => juntar(x, d + 1));
  };
  juntar(raw);
  for (const t of textos) {
    // El texto puede traer un prefijo ("Aged Receivables Report:") antes del
    // JSON, así que se parsea desde la primera llave.
    const i = t.indexOf("{");
    if (i < 0) continue;
    try {
      out.push(JSON.parse(t.slice(i)));
    } catch {
      /* ese bloque no era JSON */
    }
  }
  return out;
}

// Los reportes de QuickBooks tienen SIEMPRE la misma forma, y no es la de un
// objeto plano por fila:
//
//   { Rows: { Row: [ { ColData: [
//       { value: "Cliente X", id: "123" },   ← el id del cliente va acá
//       { value: "1000.00" },                 ← y los montos son STRINGS
//       { value: "1500.00" } ] } ] } }        ← la última suele ser el total
//
// La primera versión buscaba `id` y `balance` como número en el MISMO objeto,
// que es como se ven las APIs REST normales. Con la forma real no matcheaba
// nunca, y por eso salía "s/d" en los 86 proyectos.
export function valorNumerico(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  // "1,500.00" y "(200.00)" —negativo contable— son formatos habituales.
  const limpio = v.replace(/[$\s,]/g, "");
  const negativo = /^\(.*\)$/.test(limpio);
  const n = Number(negativo ? limpio.slice(1, -1) : limpio);
  return Number.isFinite(n) && limpio !== "" ? (negativo ? -n : n) : null;
}

type ColData = { value?: unknown; id?: unknown };

// De una fila del reporte saca (idCliente, total). El total es la ÚLTIMA celda
// numérica: en el AR aging las del medio son los tramos de antigüedad y la
// última es la suma. Sumar todas contaría doble.
function filaDelReporte(cols: ColData[]): { id: string; total: number } | null {
  const id = cols.find((c) => typeof c.id === "string" && c.id)?.id;
  if (typeof id !== "string") return null;
  let total: number | null = null;
  for (const c of cols) {
    const n = valorNumerico(c.value);
    if (n !== null) total = n;
  }
  return total === null ? null : { id, total };
}

// Recorre el reporte juntando (idCliente, saldo), SOLO para ids que son
// proyectos conocidos. Sin ese filtro un walk genérico levanta cualquier cosa
// con id y monto y termina inventando un cobrado.
export function cosechar(node: unknown, out: Map<string, number>, conocidos: Set<string>, depth = 0): void {
  if (!node || depth > 12) return;
  if (Array.isArray(node)) {
    for (const n of node) cosechar(n, out, conocidos, depth + 1);
    return;
  }
  if (typeof node !== "object") return;
  const o = node as Record<string, unknown>;

  // Forma nativa de los reportes de QBO.
  if (Array.isArray(o.ColData)) {
    const fila = filaDelReporte(o.ColData as ColData[]);
    if (fila && conocidos.has(fila.id)) out.set(fila.id, fila.total);
  }

  // Fallback para gateways que ya devuelven filas planas.
  const idPlano =
    (typeof o.customer_id === "string" && o.customer_id) ||
    (typeof o.customerId === "string" && o.customerId) ||
    (typeof o.id === "string" && o.id) ||
    null;
  if (idPlano && conocidos.has(idPlano) && !out.has(idPlano)) {
    const total =
      valorNumerico(o.balance) ?? valorNumerico(o.Balance) ?? valorNumerico(o.total) ?? valorNumerico(o.amount);
    if (total !== null) out.set(idPlano, total);
  }

  for (const v of Object.values(o)) cosechar(v, out, conocidos, depth + 1);
}

// Cálculo del cobrado. Pura aritmética, sin red ni base: decide qué número ve
// el equipo en la columna que separa "facturado" de "en la mano", así que tiene
// que poder verificarse sola.

/**
 * Cobrado = facturado − pendiente, acotado al rango [0, facturado].
 *
 * null cuando no hay dato de pendiente: un cero inventado diría "no nos pagaron
 * nada", que es muy distinto de "no sé", y en esta pantalla esa confusión
 * cuesta plata.
 */
export function calcularCobrado(
  facturado: number | null,
  pendiente: number | undefined,
  reporteOk = false,
): number | null {
  if (facturado === null) return null;
  // Un cliente SIN saldo pendiente no aparece en el reporte de cuentas por
  // cobrar. Si el reporte se leyó bien y este proyecto no está, eso no es un
  // hueco: es el reporte diciendo que no debe nada. Marcarlo "s/d" dejaba 35
  // proyectos ya cobrados sin número para siempre y subestimaba el flujo.
  //
  // `reporteOk` es la salvaguarda: sin una lectura exitosa la ausencia no
  // significa nada, y ahí sí corresponde no saber.
  if (pendiente === undefined) return reporteOk ? facturado : null;
  const cobrado = facturado - pendiente;
  // Un pendiente mayor que lo facturado en el rango (anticipo, factura vieja)
  // daría negativo; y uno negativo daría más que el total. Ninguna de las dos
  // se muestra: se recorta a lo que puede ser cierto.
  return Math.min(Math.max(cobrado, 0), facturado);
}
