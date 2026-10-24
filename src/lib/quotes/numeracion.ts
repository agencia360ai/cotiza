// Números de cotización: "COT DC 26-211", con revisiones ("COT DC 26-211 Rev 2",
// "COT DC 26-211 R1.1", "COT DC 26-211A").
//
// La carpeta de cartas en Dropbox es la fuente real del correlativo: ahí está
// todo lo que salió, se haya hecho con la app o a mano. La base se suma para no
// repetir un número que todavía es borrador y no se publicó.

import { parseRev } from "@/lib/pipeline/revisions";

const PATRON_NUMERO = /COT\s+[A-Za-z]{1,3}\s+\d{2}-\d{1,4}[A-Za-z]?(?:\s+(?:rev\.?\s*\d+|r\d+(?:\.\d+)?))?/i;

/** El número que aparece en un texto (nombre de archivo, título), normalizado. */
export function numeroEnTexto(texto: string): string | null {
  const m = texto.match(PATRON_NUMERO);
  return m ? m[0].replace(/\s+/g, " ").trim().toUpperCase() : null;
}

/**
 * El número que leyó la IA, completado con el del nombre del archivo. La IA a
 * veces lo copia como lo dice la carta ("Cotización DC 26-249", sin el COT) o
 * se come la revisión que el nombre sí trae ("COT DC 26-244 REV 2"). Sin el
 * COT el número no agrupa con sus revisiones ni cuenta para el correlativo.
 */
export function numeroDeLectura(leido: string | null | undefined, archivo: string): string | null {
  const limpio = (leido ?? "").replace(/^\s*cotizaci[oó]n\s+(?:n[º°o.]*\s*)?/i, "").trim();
  const delPdf = limpio ? (numeroEnTexto(limpio) ?? numeroEnTexto(`COT ${limpio}`)) : null;
  const delNombre = numeroEnTexto(archivo);
  if (delPdf && delNombre && numeroBase(delPdf) === numeroBase(delNombre) && parseRev(delNombre).rev > parseRev(delPdf).rev) return delNombre;
  return delPdf ?? delNombre;
}

/** El texto con su número cambiado por otro, o null si no trae número. */
export function reemplazarNumero(texto: string, numero: string): string | null {
  return PATRON_NUMERO.test(texto) ? texto.replace(PATRON_NUMERO, numero) : null;
}

/** Mismo número y misma revisión, se escriba "REV 2", "Rev2" o "R2". */
export function mismoNumero(a: string, b: string): boolean {
  const base = numeroBase(a);
  return base !== null && base === numeroBase(b) && parseRev(a).rev === parseRev(b).rev;
}

/**
 * La revisión que sigue a todas las usadas de esa base:
 * con "COT DC 26-211" y "COT DC 26-211 REV 1" → "COT DC 26-211 REV 2".
 */
export function revisionSiguiente(base: string, usados: string[]): string {
  const revs = usados.filter((n) => numeroBase(n) === base).map((n) => parseRev(n).rev);
  return `${base} REV ${Math.floor(Math.max(0, ...revs)) + 1}`;
}

/** Sin revisión ni letra: "COT DC 26-211 REV 2" → "COT DC 26-211". */
export function numeroBase(numero: string): string | null {
  const m = numero.toUpperCase().match(/COT\s+([A-Z]{1,3})\s+(\d{2})-(\d{1,4})/);
  return m ? `COT ${m[1]} ${m[2]}-${String(Number(m[3])).padStart(3, "0")}` : null;
}

/** Año del número: "COT DC 26-211" → 2026. */
export function anioDeNumero(numero: string): number | null {
  const m = numero.match(/\s(\d{2})-\d/);
  return m ? 2000 + Number(m[1]) : null;
}

/** El correlativo de ESE año que aparece en el texto, o null. */
export function correlativo(texto: string, yy: string): number | null {
  const m = texto.match(new RegExp(`COT\\s+[A-Z]{1,3}\\s+${yy}-(\\d+)`, "i"));
  return m ? parseInt(m[1], 10) : null;
}

/** El más alto de una lista de textos (nombres de archivo o números), con el texto que lo trae. */
export function mayor(textos: string[], yy: string): { n: number; texto: string } | null {
  let best: { n: number; texto: string } | null = null;
  for (const t of textos) {
    const n = correlativo(t, yy);
    if (n !== null && (!best || n > best.n)) best = { n, texto: t };
  }
  return best;
}

export function formatoNumero(yy: string, n: number): string {
  return `COT DC ${yy}-${String(n).padStart(3, "0")}`;
}
