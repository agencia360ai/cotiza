// Correlativo con el que arranca el nombre de un proyecto en QuickBooks. Es la
// llave que une un proyecto con sus cotizaciones (`sales_quotes.qbo_project_no`).
//
//   "DS26-19 Cantina del Tigre - Reparaciones" → "DS26-19"
//   "DM 26-4 Mantenimiento"                    → "DM26-04"
//
// Se normaliza el ancho del consecutivo porque los dos lados se escribieron a
// mano en momentos distintos: "DS26-2" y "DS26-02" son el mismo proyecto.
export function codigoDeProyecto(name: string | null | undefined): string | null {
  const m = /^\s*([A-Za-z]{2})\s*(\d{2})\s*-?\s*(\d+)/.exec(name ?? "");
  return m ? `${m[1].toUpperCase()}${m[2]}-${m[3].padStart(2, "0")}` : null;
}
