// HTML exportados de herramientas de diseño (como la cotización de NAZ): un
// archivo que trae adentro, comprimidas en base64, las páginas, las fuentes y
// las imágenes. Abierto como texto son 800 KB de base64 que la IA no puede
// leer y que no entran en el envío.
//
// Esto lo desarma en el navegador: el texto visible de cada página (para que la
// IA arme la cotización) y las imágenes (para poder usar el plano en la
// propuesta). El membrete se descarta: la app ya tiene el suyo.
//
// Sin dependencias de servidor ni del DOM: se prueba en Node.

export type ImagenDiseno = { nombre: string; mime: "image/png" | "image/jpeg"; base64: string; alt: string };
export type HtmlDiseno = { texto: string; imagenes: ImagenDiseno[] };

type Recurso = { mime: string; compressed?: boolean; data: string };

function bloque(html: string, tipo: string): string | null {
  const m = html.match(new RegExp(`<script type="__bundler/${tipo}">([\\s\\S]*?)</script>`));
  return m ? m[1].trim() : null;
}

export function esHtmlEmpaquetado(html: string): boolean {
  return html.includes('type="__bundler/manifest"');
}

function bytesDeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function base64DeBytes(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(bin);
}

async function descomprimir(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Texto visible de una página HTML, con un salto por bloque. */
export function textoVisible(html: string): string {
  return html
    .replace(/<(style|script|helmet|noscript)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|h[1-6]|li|tr|section|header|footer|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTIDADES[e.toLowerCase()] ?? m;
    })
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

// alt de cada <img src="id">: dice qué es cada imagen ("Membrete…", "Planta…").
function altsPorRecurso(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = tag.match(/\ssrc="([^"]+)"/i)?.[1];
    const alt = tag.match(/\salt="([^"]*)"/i)?.[1] ?? "";
    if (src) out.set(src, alt.replace(/&amp;/g, "&"));
  }
  return out;
}

/**
 * Desarma un HTML empaquetado. Las páginas pueden venir anidadas (un tablero
 * con dos páginas, cada una empaquetada a su vez): se recorre hasta el fondo.
 */
export async function leerHtmlDiseno(html: string, profundidad = 0): Promise<HtmlDiseno> {
  if (!esHtmlEmpaquetado(html) || profundidad > 4) return { texto: textoVisible(html), imagenes: [] };
  const manifiesto = JSON.parse(bloque(html, "manifest") ?? "{}") as Record<string, Recurso>;
  const plantilla = JSON.parse(bloque(html, "template") ?? '""') as string;
  const alts = altsPorRecurso(plantilla);

  const textos: string[] = [];
  const imagenes: ImagenDiseno[] = [];
  const propio = textoVisible(plantilla);
  if (propio) textos.push(propio);

  for (const [id, r] of Object.entries(manifiesto)) {
    let bytes = bytesDeBase64(r.data);
    if (r.compressed) bytes = await descomprimir(bytes);
    if (r.mime === "text/html") {
      const sub = await leerHtmlDiseno(new TextDecoder().decode(bytes), profundidad + 1);
      if (sub.texto) textos.push(sub.texto);
      imagenes.push(...sub.imagenes);
    } else if (r.mime === "image/png" || r.mime === "image/jpeg") {
      const alt = alts.get(id) ?? "";
      if (/membrete|letterhead/i.test(alt)) continue;
      imagenes.push({ nombre: alt || id, mime: r.mime, base64: base64DeBytes(bytes), alt });
    }
  }
  return { texto: textos.join("\n\n"), imagenes };
}
