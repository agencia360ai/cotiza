// Carpeta de cartas de cotización en Dropbox — fuente del correlativo anual.
export function quotesFolder(year: number = new Date().getFullYear()): string {
  return `/Dicec/Proyectos/01 Cotizaciones/01 Cartas de Cotizaciones/${year}`;
}
