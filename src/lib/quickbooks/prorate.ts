// Prorrateo lineal de proyectos multi-período por días de overlap.
//
// Un DM25-025 que corre jun-2025 → jun-2026 "acapara" dos años: al filtrar
// "este año" el monto mostrado debe ser SOLO la porción del contrato cuyos días
// caen dentro del rango (asumiendo devengo lineal entre inicio y fin).
// Fechas como "YYYY-MM-DD" (inclusive en ambos extremos), sin depender de TZ.

export type DateRange = { from: string; to: string };

const DAY = 86400000;

function ts(iso: string): number {
  return +new Date(iso + "T00:00:00Z");
}

// Días inclusivos entre dos fechas (mismo día = 1).
function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((ts(toIso) - ts(fromIso)) / DAY) + 1;
}

/** Fracción [0..1] de la duración del proyecto que cae dentro del rango. */
export function overlapFraction(projStart: string, projEnd: string, range: DateRange): number {
  // Fechas invertidas (dato sucio) → tratar como proyecto de un día en start.
  const start = projStart;
  const end = ts(projEnd) >= ts(projStart) ? projEnd : projStart;
  const oFrom = ts(range.from) > ts(start) ? range.from : start;
  const oTo = ts(range.to) < ts(end) ? range.to : end;
  if (ts(oFrom) > ts(oTo)) return 0; // sin overlap
  const total = daysBetween(start, end);
  if (total <= 0) return 1;
  return Math.min(1, daysBetween(oFrom, oTo) / total);
}

/** ¿El proyecto [start..end] toca el rango? */
export function overlapsRange(projStart: string, projEnd: string, range: DateRange): boolean {
  return overlapFraction(projStart, projEnd, range) > 0;
}

/** Monto prorrateado del rango (redondeado a centavos). */
export function prorate(total: number, projStart: string, projEnd: string, range: DateRange): number {
  return Math.round(total * overlapFraction(projStart, projEnd, range) * 100) / 100;
}

// Fechas efectivas del proyecto: las guardadas, o el año calendario del
// proyecto como supuesto (DM26 sin fechas ⇒ 2026 completo). `asumidas` avisa
// a la UI que conviene editarlas para un prorrateo real.
export function effectiveDates(p: { startDate: string | null; endDate: string | null; year: number | null }): {
  start: string;
  end: string;
  asumidas: boolean;
} | null {
  if (p.startDate && p.endDate) return { start: p.startDate, end: p.endDate, asumidas: false };
  if (p.startDate) {
    // Solo inicio: asumir 12 meses de contrato.
    const d = new Date(p.startDate + "T00:00:00Z");
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    d.setUTCDate(d.getUTCDate() - 1);
    return { start: p.startDate, end: d.toISOString().slice(0, 10), asumidas: true };
  }
  if (p.year) return { start: `${p.year}-01-01`, end: `${p.year}-12-31`, asumidas: true };
  return null; // sin ninguna pista de fechas
}
