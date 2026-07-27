import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { fechaLarga, fmtBal, letterTotals, resolveTextos, type LetterData } from "./letter";

// Carta US Letter en puntos. El membrete va a sangre (imagen de página completa)
// y el contenido respeta el encabezado/pie del arte.
const PAGE_W = 612;
const PAGE_H = 792;
const MX = 76; // margen lateral
const TOP_Y = PAGE_H - 122; // debajo del logo del membrete
const BOTTOM = 100; // reserva del pie del membrete
const INK = rgb(0.09, 0.12, 0.18);

// Helvetica usa WinAnsi: cubre acentos/ñ pero no símbolos unicode sueltos.
function clean(s: string): string {
  return s
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/•/g, "-")
    .replace(/[^\x20-\x7E -ÿ\n]/g, "");
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const raw of clean(text).split("\n")) {
    const words = raw.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push("");
      continue;
    }
    let cur = "";
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(t, size) <= width) {
        cur = t;
        continue;
      }
      if (cur) out.push(cur);
      if (font.widthOfTextAtSize(w, size) > width) {
        let piece = "";
        for (const ch of w) {
          if (font.widthOfTextAtSize(piece + ch, size) > width) {
            out.push(piece);
            piece = ch;
          } else piece += ch;
        }
        cur = piece;
      } else cur = w;
    }
    if (cur) out.push(cur);
  }
  return out.length ? out : [""];
}

type Ctx = {
  doc: PDFDocument;
  membrete: PDFImage;
  font: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  page: PDFPage;
  y: number;
};

function newPage(ctx: Pick<Ctx, "doc" | "membrete">): { page: PDFPage; y: number } {
  const page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  page.drawImage(ctx.membrete, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });
  return { page, y: TOP_Y };
}

function ensure(ctx: Ctx, needed: number) {
  if (ctx.y - needed < BOTTOM) {
    const np = newPage(ctx);
    ctx.page = np.page;
    ctx.y = np.y;
  }
}

function text(ctx: Ctx, s: string, opts: { x?: number; size?: number; font?: PDFFont; lh?: number; width?: number; align?: "left" | "right" }) {
  const size = opts.size ?? 10.5;
  const font = opts.font ?? ctx.font;
  const lh = opts.lh ?? size * 1.45;
  const width = opts.width ?? PAGE_W - MX * 2;
  const lines = wrap(s, font, size, width);
  for (const ln of lines) {
    ensure(ctx, lh);
    const w = font.widthOfTextAtSize(ln, size);
    const x = opts.align === "right" ? (opts.x ?? PAGE_W - MX) - w : opts.x ?? MX;
    ctx.page.drawText(ln, { x, y: ctx.y - size, size, font, color: INK });
    ctx.y -= lh;
  }
}

// Data URL ("data:image/png;base64,…") → bytes, para embeber la firma.
function dataUrlBytes(dataUrl: string): { bytes: Uint8Array; png: boolean } | null {
  const m = dataUrl.match(/^data:image\/(png|jpe?g);base64,(.+)$/i);
  if (!m) return null;
  try {
    return { bytes: Buffer.from(m[2], "base64"), png: /png/i.test(m[1]) };
  } catch {
    return null;
  }
}

export async function renderQuotePdf(input: {
  quoteNumber: string;
  cliente: string;
  letter: LetterData;
  firmaDataUrl?: string | null;
}): Promise<Uint8Array> {
  const { letter } = input;
  const T = resolveTextos(letter, { quoteNumber: input.quoteNumber });
  const doc = await PDFDocument.create();
  const membreteBytes = await fs.readFile(path.join(process.cwd(), "public", "dicec-membrete.png"));
  const membrete = await doc.embedPng(membreteBytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  const first = newPage({ doc, membrete });
  const ctx: Ctx = { doc, membrete, font, bold, italic, page: first.page, y: first.y };

  // Fecha (derecha) + destinatario
  text(ctx, fechaLarga(letter.fecha), { align: "right" });
  ctx.y -= 10;
  text(ctx, input.cliente, { font: bold });
  if (letter.ubicacion) text(ctx, letter.ubicacion, {});
  if (T.saludo) text(ctx, T.saludo, {});
  ctx.y -= 8;

  // Referencia (con subrayado en la palabra)
  if (T.ref_label || T.ref_texto) {
    const size = 10.5;
    ensure(ctx, size * 1.5);
    const label = clean(T.ref_label);
    ctx.page.drawText(label, { x: MX, y: ctx.y - size, size, font, color: INK });
    const lw = font.widthOfTextAtSize(label, size);
    if (label) {
      ctx.page.drawLine({
        start: { x: MX, y: ctx.y - size - 1.5 },
        end: { x: MX + lw, y: ctx.y - size - 1.5 },
        thickness: 0.7,
        color: INK,
      });
    }
    ctx.page.drawText(clean(label ? `: ${T.ref_texto}` : T.ref_texto), {
      x: MX + lw,
      y: ctx.y - size,
      size,
      font: bold,
      color: INK,
    });
    ctx.y -= size * 1.9;
  }

  if (T.intro) {
    text(ctx, T.intro, {});
    ctx.y -= 6;
  }

  // Tabla de renglones
  const CANT_W = 42;
  const PRECIO_W = 78;
  const TOTAL_W = 82;
  const DESC_W = PAGE_W - MX * 2 - CANT_W - PRECIO_W - TOTAL_W - 18;
  const xCant = MX;
  const xDesc = MX + CANT_W + 6;
  const xPrecioR = MX + CANT_W + 6 + DESC_W + 6 + PRECIO_W;
  const xTotalR = PAGE_W - MX;
  const size = 9.8;
  const lh = size * 1.4;

  // encabezado
  ensure(ctx, lh + 8);
  const thPrecio = clean(T.th_precio);
  const thTotal = clean(T.th_total);
  ctx.page.drawText(clean(T.th_cant), { x: xCant, y: ctx.y - size, size, font: bold, color: INK });
  ctx.page.drawText(clean(T.th_desc), { x: xDesc, y: ctx.y - size, size, font: bold, color: INK });
  ctx.page.drawText(thPrecio, { x: xPrecioR - bold.widthOfTextAtSize(thPrecio, size), y: ctx.y - size, size, font: bold, color: INK });
  ctx.page.drawText(thTotal, { x: xTotalR - bold.widthOfTextAtSize(thTotal, size), y: ctx.y - size, size, font: bold, color: INK });
  ctx.y -= lh + 2;
  ctx.page.drawLine({ start: { x: MX, y: ctx.y }, end: { x: PAGE_W - MX, y: ctx.y }, thickness: 1.1, color: INK });
  ctx.y -= 6;

  for (const it of letter.items) {
    const descLines = wrap(it.desc, font, size, DESC_W);
    const rowH = descLines.length * lh + 6;
    ensure(ctx, rowH);
    const rowTop = ctx.y;
    ctx.page.drawText(String(it.cant), { x: xCant, y: rowTop - size, size, font, color: INK });
    let yy = rowTop;
    for (const ln of descLines) {
      ctx.page.drawText(ln, { x: xDesc, y: yy - size, size, font, color: INK });
      yy -= lh;
    }
    const precio = `B/. ${fmtBal(it.precio)}`;
    const tot = `B/. ${fmtBal((Number(it.cant) || 0) * (Number(it.precio) || 0))}`;
    ctx.page.drawText(precio, { x: xPrecioR - font.widthOfTextAtSize(precio, size), y: rowTop - size, size, font, color: INK });
    ctx.page.drawText(tot, { x: xTotalR - font.widthOfTextAtSize(tot, size), y: rowTop - size, size, font, color: INK });
    ctx.y = rowTop - descLines.length * lh - 4;
    ctx.page.drawLine({ start: { x: MX, y: ctx.y }, end: { x: PAGE_W - MX, y: ctx.y }, thickness: 0.4, color: rgb(0.8, 0.84, 0.89) });
    ctx.y -= 5;
  }

  // Totales (bloque derecho)
  const { subtotal, itbms, total } = letterTotals(letter);
  const totRows: [string, string, boolean][] = [[clean(T.lbl_subtotal), `B/. ${fmtBal(subtotal)}`, false]];
  if (letter.aplica_itbms) totRows.push([clean(T.lbl_itbms), `B/. ${fmtBal(itbms)}`, false]);
  totRows.push([clean(T.lbl_total), `B/. ${fmtBal(total)}`, true]);
  const boxW = 200;
  const boxX = PAGE_W - MX - boxW;
  ensure(ctx, totRows.length * lh + 12);
  for (const [label, val, strong] of totRows) {
    const f = strong ? bold : font;
    if (strong) {
      ctx.page.drawLine({ start: { x: boxX, y: ctx.y + 2 }, end: { x: PAGE_W - MX, y: ctx.y + 2 }, thickness: 1, color: INK });
      ctx.y -= 3;
    }
    ctx.page.drawText(label, { x: boxX, y: ctx.y - size, size, font: f, color: INK });
    ctx.page.drawText(val, { x: xTotalR - f.widthOfTextAtSize(val, size), y: ctx.y - size, size, font: f, color: INK });
    ctx.y -= lh;
  }
  ctx.y -= 10;

  // Oferta
  if (T.oferta) {
    const size2 = 10.5;
    ensure(ctx, size2 * 1.6);
    const pre = `${clean(T.oferta)} `;
    ctx.page.drawText(pre, { x: MX, y: ctx.y - size2, size: size2, font, color: INK });
    ctx.page.drawText(clean(`B/. ${fmtBal(total)}`), {
      x: MX + font.widthOfTextAtSize(pre, size2),
      y: ctx.y - size2,
      size: size2,
      font: italic,
      color: INK,
    });
    ctx.y -= size2 * 1.9;
  }

  if (T.validez_texto) text(ctx, T.validez_texto, {});
  if (letter.condiciones) text(ctx, letter.condiciones, {});

  // Firma (línea + nombre). La IMAGEN de la firma se dibuja aparte, al final,
  // porque va posicionada libremente por el usuario.
  if (letter.elaborado) {
    ensure(ctx, 64);
    ctx.y -= 40;
    ctx.page.drawLine({ start: { x: MX, y: ctx.y }, end: { x: MX + 190, y: ctx.y }, thickness: 0.8, color: INK });
    ctx.y -= 4;
    text(ctx, letter.elaborado, {});
    if (T.empresa) text(ctx, T.empresa, {});
  }

  // Imagen de la firma: coordenadas en fracciones de página (x/y desde la
  // esquina SUPERIOR izquierda, como en el editor) → puntos PDF (y desde abajo).
  // Va en la ÚLTIMA página, que es donde queda el bloque de firma.
  const fir = letter.firma;
  if (fir && input.firmaDataUrl) {
    const parsed = dataUrlBytes(input.firmaDataUrl);
    if (parsed) {
      try {
        const img = parsed.png ? await doc.embedPng(parsed.bytes) : await doc.embedJpg(parsed.bytes);
        const w = Math.max(0.02, Math.min(1, fir.w)) * PAGE_W;
        const h = (img.height / img.width) * w;
        const x = Math.max(0, Math.min(1, fir.x)) * PAGE_W;
        const yTop = Math.max(0, Math.min(1, fir.y)) * PAGE_H;
        const pages = doc.getPages();
        pages[pages.length - 1].drawImage(img, { x, y: PAGE_H - yTop - h, width: w, height: h });
      } catch {
        /* firma ilegible: la carta sale igual, sin ella */
      }
    }
  }

  return doc.save();
}
