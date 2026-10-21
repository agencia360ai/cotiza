// Números de cotización: "COT DC 26-211", con revisiones ("COT DC 26-211 Rev 2",
// "COT DC 26-211 R1.1", "COT DC 26-211A").
//
// La carpeta de cartas en Dropbox es la fuente real del correlativo: ahí está
// todo lo que salió, se haya hecho con la app o a mano. La base se suma para no
// repetir un número que todavía es borrador y no se publicó.

/** El número que aparece en un texto (nombre de archivo, título), normalizado. */
export function numeroEnTexto(texto: string): string | null {
  const m = texto.match(/COT\s+[A-Za-z]{1,3}\s+\d{2}-\d{1,4}[A-Za-z]?(?:\s+(?:rev\.?\s*\d+|r\d+(?:\.\d+)?))?/i);
  return m ? m[0].replace(/\s+/g, " ").trim().toUpperCase() : null;
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
