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
export function calcularCobrado(facturado: number | null, pendiente: number | undefined): number | null {
  if (facturado === null || pendiente === undefined) return null;
  const cobrado = facturado - pendiente;
  // Un pendiente mayor que lo facturado en el rango (anticipo, factura vieja)
  // daría negativo; y uno negativo daría más que el total. Ninguna de las dos
  // se muestra: se recorta a lo que puede ser cierto.
  return Math.min(Math.max(cobrado, 0), facturado);
}
