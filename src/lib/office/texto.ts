import { entradaDeZip, nombresDeZip } from "./unzip";

// Word y Excel → texto plano, para que la IA los lea igual que un PDF.
//
// No se busca reproducir el documento: se busca que no se pierda NINGÚN
// renglón ni precio. Por eso las tablas de Word y las filas de Excel salen
// separadas por tabulaciones — así una cotización pegada en una tabla sigue
// leyéndose como filas y no como un párrafo corrido.

const ENTIDADES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function desescapar(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTIDADES[m] ?? m)
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

function limpiar(s: string): string {
  return (
    s
      // Espacios pegados a un tabulador: los deja el fin de párrafo dentro de
      // una celda. Se van, pero los tabuladores SEGUIDOS se respetan — son
      // celdas vacías, y comerlas correría las columnas.
      .replace(/ +\t/g, "\t")
      .replace(/\t +/g, "\t")
      .split("\n")
      .map((l) => l.replace(/[ \t]+$/g, ""))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Texto de un .docx.
 *
 * `word/document.xml` marca los saltos con `<w:p>` (párrafo), `<w:br/>` y
 * `<w:tab/>`, y el texto vive en `<w:t>`. Se convierten ANTES de borrar el
 * resto de las etiquetas; hacerlo al revés pega todos los párrafos en una sola
 * línea y una lista de renglones se vuelve ilegible.
 */
export async function docxATexto(buf: ArrayBuffer): Promise<string> {
  const xml = await entradaDeZip(buf, "word/document.xml");
  if (xml === null) throw new Error("el .docx no trae word/document.xml");
  // Word mete un <w:p> DENTRO de cada celda, así que la regla global de
  // "fin de párrafo = salto de línea" partía cada celda en su propia línea y la
  // tabla salía como una columna. Dentro de la celda el párrafo es un espacio;
  // los saltos de la tabla los marcan </w:tc> y </w:tr>.
  const conCeldas = xml.replace(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g, (celda) => celda.replace(/<\/w:p>/g, " "));
  const texto = conCeldas
    .replace(/<w:tab\b[^>]*\/?>/g, "\t")
    .replace(/<w:br\b[^>]*\/?>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    // Celda → tabulación, fila → salto: una tabla se sigue leyendo como tabla.
    .replace(/<\/w:tc>/g, "\t")
    .replace(/<\/w:tr>/g, "\n")
    .replace(/<[^>]+>/g, "");
  return limpiar(desescapar(texto));
}

// ── Excel ────────────────────────────────────────────────────────────────────

function columnaDe(ref: string): number {
  // "BC12" → 54. Las celdas vacías no vienen en el XML, así que sin esto una
  // fila con huecos corre sus valores a la izquierda y se desalinean las
  // columnas: el precio de un renglón terminaría bajo "cantidad".
  const letras = ref.match(/^[A-Z]+/)?.[0] ?? "A";
  let n = 0;
  for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

function textosCompartidos(xml: string | null): string[] {
  if (!xml) return [];
  // Cada <si> puede tener varios <t> (texto con formatos mezclados).
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) =>
    desescapar([...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")),
  );
}

function hojaATexto(xml: string, compartidos: string[]): string {
  const filas: string[] = [];
  for (const fila of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const celdas: string[] = [];
    for (const c of fila[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = c[1];
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? "";
      const tipo = /t="([^"]+)"/.exec(attrs)?.[1];
      const cuerpo = c[2];
      let valor: string;
      if (tipo === "s") {
        const i = Number(/<v>([\s\S]*?)<\/v>/.exec(cuerpo)?.[1] ?? "-1");
        valor = compartidos[i] ?? "";
      } else if (tipo === "inlineStr") {
        valor = desescapar([...cuerpo.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""));
      } else {
        valor = desescapar(/<v>([\s\S]*?)<\/v>/.exec(cuerpo)?.[1] ?? "");
      }
      const col = ref ? columnaDe(ref) : celdas.length;
      while (celdas.length < col) celdas.push("");
      celdas[col] = valor.replace(/[\t\n]+/g, " ");
    }
    const linea = celdas.join("\t").replace(/\t+$/, "");
    if (linea.trim()) filas.push(linea);
  }
  return filas.join("\n");
}

/**
 * Texto de un .xlsx: cada hoja como filas separadas por tabulaciones.
 *
 * Las hojas van con su nombre de archivo por delante porque un libro con
 * "Materiales" y "Mano de obra" en pestañas distintas se lee mal si las filas
 * salen todas seguidas sin decir de dónde vienen.
 */
export async function xlsxATexto(buf: ArrayBuffer): Promise<string> {
  const compartidos = textosCompartidos(await entradaDeZip(buf, "xl/sharedStrings.xml"));
  const hojas = nombresDeZip(buf)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort();
  if (hojas.length === 0) throw new Error("el .xlsx no trae hojas");

  const partes: string[] = [];
  for (const h of hojas.slice(0, 10)) {
    const xml = await entradaDeZip(buf, h);
    if (!xml) continue;
    const t = hojaATexto(xml, compartidos);
    if (t.trim()) partes.push(hojas.length > 1 ? `--- ${h.replace(/^xl\/worksheets\//, "")} ---\n${t}` : t);
  }
  return limpiar(partes.join("\n\n"));
}
