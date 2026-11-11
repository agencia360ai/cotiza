// Cálculos de la gráfica mensual de Proyectos, sin React para poder probarlos.

/**
 * Las marcas del eje Y: de 0 a un tope "redondo" (1, 2, 2.5 o 5 por potencia
 * de 10) que cubre el máximo. Con marcas como $23,417 nadie lee la escala.
 */
export function marcasEje(max: number, lineas = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const crudo = max / lineas;
  const mag = 10 ** Math.floor(Math.log10(crudo));
  const paso = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => p >= crudo) ?? 10 * mag;
  const n = Math.ceil(max / paso - 1e-9);
  return Array.from({ length: n + 1 }, (_, i) => Math.round(i * paso * 100) / 100);
}

/** "$25K", "$2.5K", "$1.2M": el eje no tiene lugar para "$25,000.00". */
export function fmtEje(v: number): string {
  const a = Math.abs(v);
  const signo = v < 0 ? "-$" : "$";
  const corto = (x: number) => String(Math.round(x * 10) / 10);
  if (a >= 1e6) return `${signo}${corto(a / 1e6)}M`;
  if (a >= 1e3) return `${signo}${corto(a / 1e3)}K`;
  return `${signo}${Math.round(a)}`;
}

/**
 * Completa los meses sin movimiento entre el primero y el último. Sin esto un
 * mes vacío desaparecía y la gráfica juntaba marzo con mayo como si fueran
 * seguidos. Los meses van como "YYYY-MM-01".
 */
export function rellenarMeses<T extends { month: string }>(data: T[], vacio: (month: string) => T): T[] {
  if (data.length < 2) return data;
  const porMes = new Map(data.map((d) => [d.month.slice(0, 7), d]));
  const meses = [...porMes.keys()].sort();
  const fin = meses[meses.length - 1];
  const out: T[] = [];
  const d = new Date(`${meses[0]}-01T00:00:00Z`);
  // Tope de 10 años: una fecha sucia no puede colgar el navegador.
  for (let i = 0; i < 120; i++) {
    const mes = d.toISOString().slice(0, 7);
    out.push(porMes.get(mes) ?? vacio(`${mes}-01`));
    if (mes >= fin) break;
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

/**
 * Cada cuántos meses va una etiqueta para que no se pisen. En "Todo" hay
 * decenas de meses y una etiqueta por barra era una mancha gris.
 */
export function etiquetaCada(meses: number, anchoSlot: number, anchoEtiqueta: number): number {
  if (meses <= 0 || anchoSlot <= 0) return 1;
  const cada = Math.ceil(anchoEtiqueta / anchoSlot);
  // Saltos que caen en trimestres o semestres: "ene, abr, jul, oct" se lee;
  // "ene, may, sep" obliga a contar.
  return [1, 2, 3, 6, 12, 24].find((c) => c >= cada) ?? cada;
}

/**
 * Barra con las esquinas de arriba redondeadas (4px) y la base recta: las
 * barras nacen del eje, no flotan sobre él. Sin redondeo para un tramo de
 * abajo en una barra apilada.
 */
export function barra(x: number, w: number, top: number, bottom: number, redondo: boolean): string {
  const r = redondo ? Math.max(0, Math.min(4, w / 2, (bottom - top) / 2)) : 0;
  return `M ${x} ${bottom} L ${x} ${top + r} Q ${x} ${top} ${x + r} ${top} L ${x + w - r} ${top} Q ${x + w} ${top} ${x + w} ${top + r} L ${x + w} ${bottom} Z`;
}

/**
 * Dónde va el detalle de un mes: al costado de sus barras para no taparlas; si
 * no entra de ningún lado (celular), centrado y dentro de la tarjeta.
 */
export function posicionTip(cx: number, mitadGrupo: number, ancho: number, anchoTip: number): number {
  const derecha = cx + mitadGrupo + 12;
  if (derecha + anchoTip <= ancho) return derecha;
  const izquierda = cx - mitadGrupo - 12 - anchoTip;
  if (izquierda >= 0) return izquierda;
  return Math.min(Math.max(cx - anchoTip / 2, 0), Math.max(0, ancho - anchoTip));
}
