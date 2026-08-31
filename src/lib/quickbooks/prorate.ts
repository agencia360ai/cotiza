// Cuánto de un proyecto cae dentro de un rango de fechas.
//
// Hay dos caminos, y el primero gana siempre que exista:
//
//   1. MESES REALES (0045). QuickBooks nos da el P&L desglosado por mes, así
//      que "cuánto de este proyecto es de marzo" no se estima: se suma.
//   2. PRORRATEO. Para proyectos sin data mensual (cerrados con números
//      congelados, o un contrato firmado cuyo monto total aún no se facturó)
//      se reparte el monto linealmente por días entre inicio y fin.
//
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

// ── Meses reales ─────────────────────────────────────────────────────────────

export type MesMonto = { month: string; income: number; cost: number };

/** Último día del mes de "2026-03-01" → "2026-03-31". */
export function finDeMes(monthIso: string): string {
  const [y, m] = monthIso.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * Suma de los meses que caen dentro del rango. Un mes partido por el rango
 * (rangos de 90 días, o personalizados) aporta la parte proporcional de sus
 * días — no todo el mes ni nada.
 */
export function sumarMeses(meses: MesMonto[], range: DateRange | null): { income: number; cost: number } {
  let income = 0;
  let cost = 0;
  for (const m of meses) {
    const f = range ? overlapFraction(m.month, finDeMes(m.month), range) : 1;
    if (f === 0) continue;
    income += m.income * f;
    cost += m.cost * f;
  }
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return { income: round2(income), cost: round2(cost) };
}

// ── Fechas efectivas ─────────────────────────────────────────────────────────

// De dónde salieron las fechas que se están mostrando. La UI lo dice: un rango
// asumido no merece la misma confianza que uno que vino de QuickBooks.
export type FuenteFechas = "manual" | "qbo" | "asumido";

export type FechasInput = {
  startDate: string | null; // cargadas a mano (contrato firmado)
  endDate: string | null;
  qboCreatedAt?: string | null; // MetaData.CreateTime del customer en QBO
  firstTxnDate?: string | null; // primer mes con movimiento
  lastTxnDate?: string | null; // último mes con movimiento
  year: number | null; // año del correlativo — último recurso
};

const menor = (a: string | null | undefined, b: string | null | undefined) =>
  a && b ? (a < b ? a : b) : (a ?? b ?? null);

export type FechasEfectivas = {
  start: string;
  end: string;
  fuente: FuenteFechas;
  // Si el DÍA de cada extremo es un dato o un artefacto. `firstTxnDate` y
  // `lastTxnDate` salen del reporte MENSUAL, así que siempre caen en día 1:
  // escribir ese día haría pasar por dato lo que es una consecuencia de cómo
  // se agrupó el reporte. Quien muestra la fecha necesita saber la diferencia.
  diaStart: boolean;
  diaEnd: boolean;
};

/**
 * Fechas efectivas del proyecto, en orden de confianza:
 *   1. manual  — las dos cargadas a mano: es el contrato, gana siempre.
 *   2. qbo     — apertura del proyecto / primer movimiento → último movimiento.
 *   3. asumido — solo inicio ⇒ +12 meses; ni eso ⇒ el año del correlativo.
 */
export function effectiveDates(p: FechasInput): FechasEfectivas | null {
  const start = p.startDate ?? menor(p.qboCreatedAt, p.firstTxnDate);
  const end = p.endDate ?? p.lastTxnDate ?? null;
  // El día del inicio vale si lo escribió alguien o si vino de la fecha de alta
  // del cliente en QBO, que sí es un timestamp real.
  const diaStart = !!p.startDate || (!!start && start === p.qboCreatedAt);

  if (start && end) {
    return {
      start,
      end: end >= start ? end : start,
      fuente: p.startDate && p.endDate ? "manual" : "qbo",
      diaStart,
      diaEnd: !!p.endDate,
    };
  }
  if (start) {
    // Solo inicio: asumir 12 meses de contrato.
    const d = new Date(start + "T00:00:00Z");
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    d.setUTCDate(d.getUTCDate() - 1);
    return { start, end: d.toISOString().slice(0, 10), fuente: "asumido", diaStart, diaEnd: diaStart };
  }
  if (p.year) {
    return { start: `${p.year}-01-01`, end: `${p.year}-12-31`, fuente: "asumido", diaStart: false, diaEnd: false };
  }
  return null; // sin ninguna pista de fechas
}
