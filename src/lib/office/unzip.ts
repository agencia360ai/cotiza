// Lector mínimo de ZIP para el navegador.
//
// .docx y .xlsx son ZIP con XML adentro. Sacarles el texto no necesita una
// librería: `DecompressionStream("deflate-raw")` viene en el navegador, y del
// formato ZIP solo hace falta la parte que ubica una entrada por nombre.
//
// Se hace en el CLIENTE a propósito: un .docx de 5 MB se convierte en ~20 KB de
// texto antes de salir del navegador. Mandarlo entero al servidor para
// extraerlo allá gastaría el límite del server action en bytes que no aportan.

const EOCD = 0x06054b50; // fin del directorio central
const CEN = 0x02014b50; // entrada del directorio central
const LOC = 0x04034b50; // encabezado local de archivo

type Entrada = { nombre: string; metodo: number; offsetLocal: number; comprimido: number };

/** Índice de lo que hay adentro del ZIP, por nombre. */
function leerDirectorio(dv: DataView): Map<string, Entrada> {
  // El EOCD está al final, pero puede llevar un comentario detrás: se busca
  // hacia atrás dentro de los 64 KB que el formato permite de comentario.
  if (dv.byteLength < 22) throw new Error("no parece un archivo ZIP válido");
  let eocd = -1;
  const desde = Math.max(0, dv.byteLength - 65_557);
  for (let i = dv.byteLength - 22; i >= desde; i--) {
    if (dv.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("no parece un archivo ZIP válido");

  const total = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map<string, Entrada>();
  const dec = new TextDecoder();

  for (let i = 0; i < total; i++) {
    // Acá entra lo que suba el usuario, no solo Words bien formados: un archivo
    // cualquiera puede traer los 4 bytes del EOCD por casualidad y mandar a
    // leer fuera del buffer. Se corta y se avisa, en vez de reventar con un
    // "Offset is outside the bounds of the DataView".
    if (p + 46 > dv.byteLength) break;
    if (dv.getUint32(p, true) !== CEN) break;
    const metodo = dv.getUint16(p + 10, true);
    const comprimido = dv.getUint32(p + 20, true);
    const nLen = dv.getUint16(p + 28, true);
    const eLen = dv.getUint16(p + 30, true);
    const cLen = dv.getUint16(p + 32, true);
    const offsetLocal = dv.getUint32(p + 42, true);
    if (p + 46 + nLen > dv.byteLength) break;
    const nombre = dec.decode(new Uint8Array(dv.buffer, dv.byteOffset + p + 46, nLen));
    out.set(nombre, { nombre, metodo, offsetLocal, comprimido });
    p += 46 + nLen + eLen + cLen;
  }
  return out;
}

async function inflar(datos: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([datos as unknown as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Texto de UNA entrada del ZIP. null si no está.
 *
 * Solo se soportan los dos métodos que usan Word y Excel: sin comprimir (0) y
 * deflate (8). Cualquier otro se avisa en vez de devolver basura.
 */
export async function entradaDeZip(buf: ArrayBuffer, nombre: string): Promise<string | null> {
  const dv = new DataView(buf);
  const dir = leerDirectorio(dv);
  const e = dir.get(nombre);
  if (!e) return null;

  if (e.offsetLocal + 30 > dv.byteLength || dv.getUint32(e.offsetLocal, true) !== LOC) {
    throw new Error("ZIP corrupto");
  }
  const nLen = dv.getUint16(e.offsetLocal + 26, true);
  const eLen = dv.getUint16(e.offsetLocal + 28, true);
  const inicio = e.offsetLocal + 30 + nLen + eLen;
  if (inicio + e.comprimido > dv.byteLength) throw new Error("ZIP corrupto");
  const crudo = new Uint8Array(buf, inicio, e.comprimido);

  if (e.metodo === 0) return new TextDecoder().decode(crudo);
  if (e.metodo === 8) return new TextDecoder().decode(await inflar(crudo));
  throw new Error(`compresión no soportada (método ${e.metodo})`);
}

/** Nombres de las entradas, para elegir hojas de Excel sin adivinar. */
export function nombresDeZip(buf: ArrayBuffer): string[] {
  return [...leerDirectorio(new DataView(buf)).keys()];
}
