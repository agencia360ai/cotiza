import "server-only";
import { promises as fs } from "fs";
import path from "path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, setCharacterSpacing, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import { fechaLarga, fmtBal, letterTotals, numeroCarta, partirItems, type LetterData, type LetterItem } from "./letter";
import { condicionesDe, normalizarPropuesta, type Propuesta, type PropuestaImagen } from "./propuesta";

// El PDF del formato Propuesta. Las medidas son las del diseño (página de
// 816 × 1056 px) y se convierten a puntos al dibujar: así cada número de acá se
// puede comparar contra el diseño original sin hacer cuentas.
const S = 0.75; // 1 px del diseño = 0.75 pt de una carta de 612 × 792
const W = 816;
const H = 1056;
const X0 = 48;
const ANCHO = 720;
const TOP = 118; // debajo del logo del membrete
const FONDO = 958; // arriba del pie con la dirección

const hex = (h: string): RGB => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const C = {
  tinta: hex("#14212E"),
  azul: hex("#166792"),
  noche: hex("#12405F"),
  gris: hex("#4A5868"),
  linea: hex("#C9D6E2"),
  pie: hex("#5F6B78"),
  claro: hex("#A5BCD2"),
  claro2: hex("#D3DFEA"),
  blanco: rgb(1, 1, 1),
};

const PIE = [
  "URBANIZACIÓN DORADO OESTE CALLE B CASA No. 31 · TELÉFONO 236-2966 · FAX 236-3905",
  "DICEC, INC · R.U.C. 30114-77-236028 · D.V. 71",
];

type Fuentes = {
  archivo: PDFFont;
  sans: PDFFont;
  sansMed: PDFFont;
  sansSemi: PDFFont;
  mono: PDFFont;
  monoMed: PDFFont;
  monoSemi: PDFFont;
};

// Rutas escritas enteras (sin armar el nombre) para que el empaquetado de
// Vercel las detecte y las incluya en la función.
async function cargarFuentes(doc: PDFDocument): Promise<Fuentes> {
  const dir = (f: string) => path.join(process.cwd(), "public", "fonts", "propuesta", f);
  const [archivo, sans, sansMed, sansSemi, mono, monoMed, monoSemi] = await Promise.all([
    fs.readFile(dir("Archivo-Bold.ttf")),
    fs.readFile(dir("IBMPlexSans-Regular.ttf")),
    fs.readFile(dir("IBMPlexSans-Medium.ttf")),
    fs.readFile(dir("IBMPlexSans-SemiBold.ttf")),
    fs.readFile(dir("IBMPlexMono-Regular.ttf")),
    fs.readFile(dir("IBMPlexMono-Medium.ttf")),
    fs.readFile(dir("IBMPlexMono-SemiBold.ttf")),
  ]);
  doc.registerFontkit(fontkit);
  const e = (b: Buffer) => doc.embedFont(b, { subset: true });
  return {
    archivo: await e(archivo),
    sans: await e(sans),
    sansMed: await e(sansMed),
    sansSemi: await e(sansSemi),
    mono: await e(mono),
    monoMed: await e(monoMed),
    monoSemi: await e(monoSemi),
  };
}

type Estilo = { f: PDFFont; size: number; lh: number; color: RGB; ls?: number };

// Caracteres de control y espacios raros fuera: con fuentes propias el resto
// del Unicode (acentos, ×, Ø, –, ·) se dibuja tal cual.
const limpiar = (s: string) => s.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").replace(/[   ]/g, " ");

function ancho(s: string, e: Estilo): number {
  return e.f.widthOfTextAtSize(s, e.size) + (e.ls ? e.ls * e.size * s.length : 0);
}

function partir(texto: string, e: Estilo, max: number): string[] {
  const out: string[] = [];
  for (const parrafo of limpiar(texto).split("\n")) {
    const palabras = parrafo.split(/\s+/).filter(Boolean);
    let cur = "";
    for (const p of palabras) {
      const t = cur ? `${cur} ${p}` : p;
      if (ancho(t, e) <= max) {
        cur = t;
        continue;
      }
      if (cur) out.push(cur);
      cur = p;
      // Una palabra más ancha que la columna (un código largo): se corta.
      while (ancho(cur, e) > max && cur.length > 1) {
        let i = cur.length - 1;
        while (i > 1 && ancho(cur.slice(0, i), e) > max) i--;
        out.push(cur.slice(0, i));
        cur = cur.slice(i);
      }
    }
    if (cur) out.push(cur);
  }
  return out.length ? out : [""];
}

// Línea base de un texto dentro de su caja de línea, como lo pone el navegador:
// el alto de la fuente centrado en el line-height.
function base(top: number, e: Estilo): number {
  const asc = e.f.heightAtSize(e.size, { descender: false });
  const alto = e.f.heightAtSize(e.size);
  return top + (e.lh - alto) / 2 + asc;
}

function escribirEnBase(page: PDFPage, s: string, x: number, baseline: number, e: Estilo) {
  const t = limpiar(s);
  if (!t) return;
  if (e.ls) page.pushOperators(setCharacterSpacing(e.ls * e.size * S));
  page.drawText(t, { x: x * S, y: (H - baseline) * S, size: e.size * S, font: e.f, color: e.color });
  if (e.ls) page.pushOperators(setCharacterSpacing(0));
}

function escribir(page: PDFPage, s: string, x: number, top: number, e: Estilo, al?: { align: "right" | "center"; caja: number }) {
  let xx = x;
  if (al) {
    const w = ancho(limpiar(s), e);
    xx = al.align === "right" ? x + al.caja - w : x + (al.caja - w) / 2;
  }
  escribirEnBase(page, s, xx, base(top, e), e);
}

/** Varias líneas; devuelve el alto ocupado. */
function parrafo(page: PDFPage, texto: string, x: number, top: number, e: Estilo, max: number, al?: "right"): number {
  const lineas = partir(texto, e, max);
  lineas.forEach((l, i) => escribir(page, l, x, top + i * e.lh, e, al ? { align: al, caja: max } : undefined));
  return lineas.length * e.lh;
}

function rect(page: PDFPage, x: number, top: number, w: number, h: number, color: RGB) {
  page.drawRectangle({ x: x * S, y: (H - top - h) * S, width: w * S, height: h * S, color });
}

function borde(page: PDFPage, x: number, top: number, w: number, h: number, color: RGB) {
  page.drawRectangle({ x: x * S, y: (H - top - h) * S, width: w * S, height: h * S, borderColor: color, borderWidth: S });
}

/** El tamaño más grande (hasta `min`) con el que el texto entra en una línea. */
function ajustar(texto: string, e: Estilo, max: number, min: number): Estilo {
  let size = e.size;
  while (size > min && ancho(texto, { ...e, size }) > max) size -= 1;
  return { ...e, size, lh: Math.round((e.lh / e.size) * size) };
}

type Lienzo = {
  doc: PDFDocument;
  F: Fuentes;
  membrete: PDFImage;
  pages: PDFPage[];
  page: PDFPage;
  y: number;
  continuaciones: PDFPage[]; // páginas que llevan el encabezado corto "n / N"
};

function hoja(lz: Pick<Lienzo, "doc" | "F" | "membrete">): PDFPage {
  const page = lz.doc.addPage([W * S, H * S]);
  page.drawImage(lz.membrete, { x: 0, y: 0, width: W * S, height: H * S });
  const e: Estilo = { f: lz.F.sans, size: 12, lh: 16, color: C.pie, ls: 0.03 };
  PIE.forEach((l, i) => escribir(page, l, 0, 976 + i * 16, e, { align: "center", caja: W }));
  return page;
}

const ALTO_ENCABEZADO_CONT = 27; // texto 16 + 10 de aire + 1 de línea

function paginaNueva(lz: Lienzo) {
  lz.page = hoja(lz);
  lz.pages.push(lz.page);
  lz.continuaciones.push(lz.page);
  lz.y = TOP + ALTO_ENCABEZADO_CONT;
}

function asegurar(lz: Lienzo, alto: number, alCambiar?: () => void) {
  if (lz.y + alto > FONDO) {
    paginaNueva(lz);
    alCambiar?.();
  }
}

// ── Página 1: resumen ────────────────────────────────────────────────────────

function portada(lz: Lienzo, d: Datos) {
  const { page, F } = lz;
  const p = d.p;
  let y = TOP;

  // COTIZACIÓN · número ............................ Panamá, fecha
  const eNum: Estilo = { f: F.archivo, size: 20, lh: 24, color: C.tinta };
  const eKick: Estilo = { f: F.monoSemi, size: 12, lh: 14, color: C.azul, ls: 0.16 };
  const eFecha: Estilo = { f: F.sans, size: 13, lh: 18, color: C.gris };
  const bl = base(y, eNum);
  escribirEnBase(page, "COTIZACIÓN", X0, bl, eKick);
  escribirEnBase(page, d.numero, X0 + ancho("COTIZACIÓN", eKick) + 10, bl, eNum);
  const fecha = `Panamá, ${fechaLarga(d.fecha)}`;
  escribirEnBase(page, fecha, X0 + ANCHO - ancho(fecha, eFecha), bl, eFecha);
  y += 24 + 12;
  rect(page, X0, y, ANCHO, 1, C.linea);
  y += 1 + 16;

  escribir(page, p.etiqueta, X0, y, { f: F.monoSemi, size: 12, lh: 14, color: C.azul, ls: 0.14 });
  y += 14 + 4;
  const eTit = ajustar(p.titulo, { f: F.archivo, size: 44, lh: 48, color: C.tinta, ls: -0.01 }, ANCHO, 32);
  y += parrafo(page, p.titulo, X0, y, eTit, ANCHO);
  if (p.subtitulo) {
    y += 4;
    y += parrafo(page, p.subtitulo, X0, y, { f: F.sans, size: 15, lh: 20, color: C.gris }, ANCHO);
  }

  if (p.datos.length) {
    y += 16;
    const n = p.datos.length;
    const col = (ANCHO - 24 * (n - 1)) / n;
    let alto = 0;
    p.datos.forEach((dt, i) => {
      const x = X0 + i * (col + 24);
      escribir(page, dt.label.toUpperCase(), x, y, { f: F.mono, size: 12, lh: 14, color: C.gris, ls: 0.1 });
      const h = parrafo(page, dt.valor, x, y + 18, { f: F.sansMed, size: 15, lh: 20, color: C.tinta }, col);
      alto = Math.max(alto, 18 + h);
    });
    y += alto;
  }

  if (p.cifras.length) {
    y += 16;
    const n = p.cifras.length;
    const col = (ANCHO - 20 * (n - 1)) / n;
    let alto = 0;
    p.cifras.forEach((c, i) => {
      const x = X0 + i * (col + 20);
      rect(page, x, y, col, 2, C.azul);
      const eV = ajustar(c.valor, { f: F.archivo, size: 30, lh: 34, color: C.tinta }, col, 18);
      escribir(page, c.valor, x, y + 12, eV);
      const h = c.texto ? parrafo(page, c.texto, x, y + 12 + eV.lh + 4, { f: F.sans, size: 12, lh: 16, color: C.gris }, col) : 0;
      alto = Math.max(alto, 12 + eV.lh + (h ? 4 + h : 0));
    });
    y += alto;
  }

  if (p.plano && d.imagenes.length) {
    y += 18;
    escribir(page, p.plano.titulo, X0, y, { f: F.archivo, size: 18, lh: 22, color: C.tinta });
    if (p.plano.fuente) {
      escribir(page, p.plano.fuente, X0, y + 4, { f: F.mono, size: 12, lh: 14, color: C.gris }, { align: "right", caja: ANCHO });
    }
    y += 22 + 8;
    plano(page, F, X0, y, d.imagenes);
    y += 360;
  }

  y += 16;
  y += banda(page, F, y, d);
  lz.y = y;
}

// Caja del plano: una imagen ocupa todo; dos van lado a lado con una línea en
// el medio, como en el diseño (planta a la izquierda, tabla de equipos a la
// derecha).
function plano(page: PDFPage, F: Fuentes, x: number, top: number, imgs: { img: PDFImage; nota: string | null }[]) {
  borde(page, x, top, ANCHO, 360, C.linea);
  const ix = x + 13;
  const iy = top + 13;
  const iw = ANCHO - 26;
  const ih = 360 - 26;
  const encajar = (img: PDFImage, sx: number, sy: number, sw: number, sh: number) => {
    const k = Math.min(sw / img.width, sh / img.height);
    const w = img.width * k;
    const h = img.height * k;
    page.drawImage(img, { x: (sx + (sw - w) / 2) * S, y: (H - (sy + (sh - h) / 2) - h) * S, width: w * S, height: h * S });
  };
  const nota = (t: string, sx: number, sw: number, abajo: number) =>
    escribir(page, t, sx, abajo - 16, { f: F.mono, size: 12, lh: 16, color: C.gris }, { align: "center", caja: sw });
  const slots = imgs.length === 1 ? [{ sx: ix, sw: iw }] : [
    { sx: ix, sw: 331 },
    { sx: ix + 331 + 16 + 1 + 16, sw: iw - 331 - 33 },
  ];
  if (imgs.length > 1) rect(page, ix + 331 + 16, iy - 12, 1, 360 - 2, C.linea);
  imgs.slice(0, slots.length).forEach((im, i) => {
    const s = slots[i];
    const reserva = im.nota ? 24 : 0;
    encajar(im.img, s.sx, iy, s.sw, ih - reserva);
    if (im.nota) nota(im.nota, s.sx, s.sw, iy + ih);
  });
}

// La banda del precio: lo que el cliente busca primero.
function banda(page: PDFPage, F: Fuentes, top: number, d: Datos): number {
  const p = d.p;
  const alto = 14 + 14 + 4 + 40 + 4 + 18 + 14;
  rect(page, X0, top, ANCHO, alto, C.noche);
  const x = X0 + 28;
  let y = top + 14;
  escribir(page, p.inversion.toUpperCase(), x, y, { f: F.monoSemi, size: 12, lh: 14, color: C.claro, ls: 0.14 });
  y += 18;
  escribir(page, `B/. ${fmtBal(d.totales.subtotal)}`, x, y, { f: F.archivo, size: 36, lh: 40, color: C.blanco, ls: -0.01 });
  y += 44;
  const det = d.aplicaItbms
    ? `+ ITBMS ${d.tasa}% · Total B/. ${fmtBal(d.totales.total)}`
    : "Sin ITBMS";
  escribir(page, det, x, y, { f: F.sans, size: 14, lh: 18, color: C.claro2 });

  if (p.plazo) {
    const caja = 300;
    const xr = X0 + ANCHO - 28 - caja;
    const lineas = p.plazo.detalle ? 3 : 2;
    const contenido = 14 + 4 + 26 + (lineas === 3 ? 4 + 18 : 0);
    let yr = top + (alto - contenido) / 2;
    escribir(page, p.plazo.label.toUpperCase(), xr, yr, { f: F.monoSemi, size: 12, lh: 14, color: C.claro, ls: 0.14 }, { align: "right", caja });
    yr += 18;
    const eV = ajustar(p.plazo.valor, { f: F.archivo, size: 22, lh: 26, color: C.blanco }, caja, 14);
    escribir(page, p.plazo.valor, xr, yr, eV, { align: "right", caja });
    yr += eV.lh + 4;
    if (p.plazo.detalle) escribir(page, p.plazo.detalle, xr, yr, { f: F.sans, size: 13, lh: 18, color: C.claro2 }, { align: "right", caja });
  }
  return alto;
}

// ── Alcance y precio ─────────────────────────────────────────────────────────

const COL_NUM = 32;
const COL_MONTO = 120;
const GAP = 16;
const COL_DESC = ANCHO - COL_NUM - COL_MONTO - GAP * 2;

function encabezadoTabla(lz: Lienzo, titulo: string) {
  const e: Estilo = { f: lz.F.mono, size: 12, lh: 14, color: C.gris, ls: 0.1 };
  lz.y += 12;
  escribir(lz.page, "#", X0, lz.y, e);
  escribir(lz.page, titulo.toUpperCase(), X0 + COL_NUM + GAP, lz.y, e);
  escribir(lz.page, "B/.", X0 + ANCHO - COL_MONTO, lz.y, e, { align: "right", caja: COL_MONTO });
  lz.y += 14 + 8;
  rect(lz.page, X0, lz.y, ANCHO, 2, C.noche);
  lz.y += 2;
}

function filaPartida(lz: Lienzo, num: string, it: LetterItem, apagada: boolean, alCambiar: () => void) {
  const F = lz.F;
  const eTit: Estilo = { f: F.sansSemi, size: 15, lh: 20, color: C.tinta };
  const eDet: Estilo = { f: F.sans, size: 13, lh: 18, color: C.gris };
  const titulo = (it.titulo ?? "").trim() || it.desc;
  const detalle = (it.titulo ?? "").trim() ? it.desc : "";
  const lt = partir(titulo, eTit, COL_DESC);
  const ld = detalle ? partir(detalle, eDet, COL_DESC) : [];
  const cant = Number(it.cant) || 0;
  const precio = Number(it.precio) || 0;
  const conCant = cant !== 1;
  const alto = 9 + Math.max(lt.length * 20 + (ld.length ? 2 + ld.length * 18 : 0), conCant ? 20 + 16 : 20) + 9 + 1;
  asegurar(lz, alto, alCambiar);
  const { page } = lz;
  const y = lz.y + 9;
  escribir(page, num, X0, y, { f: F.monoSemi, size: 13, lh: 20, color: apagada ? C.gris : C.azul });
  lt.forEach((l, i) => escribir(page, l, X0 + COL_NUM + GAP, y + i * 20, eTit));
  ld.forEach((l, i) => escribir(page, l, X0 + COL_NUM + GAP, y + lt.length * 20 + 2 + i * 18, eDet));
  const xm = X0 + ANCHO - COL_MONTO;
  escribir(page, fmtBal(cant * precio), xm, y, { f: F.monoMed, size: 14, lh: 20, color: apagada ? C.gris : C.tinta }, { align: "right", caja: COL_MONTO });
  if (conCant) {
    escribir(page, `${fmtCant(cant)} × ${fmtBal(precio)}`, xm, y + 20, { f: F.mono, size: 11, lh: 16, color: C.gris }, { align: "right", caja: COL_MONTO });
  }
  lz.y += alto - 1;
  rect(page, X0, lz.y, ANCHO, 1, C.linea);
  lz.y += 1;
}

const fmtCant = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

function alcance(lz: Lienzo, d: Datos) {
  const F = lz.F;
  const { enTotal, aparte } = partirItems(d.items);
  const tituloTabla = d.p.partidas_titulo;

  lz.y += 14;
  escribir(lz.page, "Alcance y precio", X0, lz.y, { f: F.archivo, size: 28, lh: 32, color: C.tinta });
  lz.y += 32;
  encabezadoTabla(lz, tituloTabla);
  enTotal.forEach((it, i) => filaPartida(lz, String(i + 1).padStart(2, "0"), it, false, () => encabezadoTabla(lz, tituloTabla)));

  // Totales
  asegurar(lz, 12 + 50);
  lz.y += 12;
  const page = lz.page;
  rect(page, X0, lz.y, ANCHO, 50, C.noche);
  const eChico: Estilo = { f: F.sans, size: 13, lh: 18, color: C.claro2 };
  const eNum: Estilo = { f: F.mono, size: 13, lh: 18, color: C.blanco };
  const eTot: Estilo = { f: F.archivo, size: 22, lh: 26, color: C.blanco };
  const bl = base(lz.y + 12, eTot);
  // Los dos lados se centran cada uno en la banda, como en el diseño: el texto
  // chico no comparte línea base con el total grande.
  const blChico = base(lz.y + 16, eChico);
  let x = X0 + 16;
  const par = (label: string, valor: string) => {
    escribirEnBase(page, label, x, blChico, eChico);
    x += ancho(label, eChico) + 5;
    escribirEnBase(page, valor, x, blChico, eNum);
    x += ancho(valor, eNum) + 20;
  };
  par("Subtotal", fmtBal(d.totales.subtotal));
  if (d.aplicaItbms) par(`ITBMS ${d.tasa}%`, fmtBal(d.totales.itbms));
  else escribirEnBase(page, "Sin ITBMS", x, blChico, eChico);
  const total = `B/. ${fmtBal(d.totales.total)}`;
  const xTot = X0 + ANCHO - 16 - ancho(total, eTot);
  escribirEnBase(page, total, xTot, bl, eTot);
  const eLbl: Estilo = { f: F.monoSemi, size: 12, lh: 14, color: C.claro, ls: 0.14 };
  escribirEnBase(page, "TOTAL", xTot - 12 - ancho("TOTAL", eLbl), bl, eLbl);
  lz.y += 50;

  // Fuera del total: precio acordado, se cobran solo si se piden.
  if (aparte.length) {
    asegurar(lz, 16 + 14 + 40);
    lz.y += 16;
    escribir(lz.page, "SERVICIOS ADICIONALES · SE FACTURAN SOLO SI SE SOLICITAN", X0, lz.y, { f: F.monoSemi, size: 12, lh: 14, color: C.gris, ls: 0.1 });
    lz.y += 14 + 4;
    rect(lz.page, X0, lz.y, ANCHO, 1, C.linea);
    lz.y += 1;
    aparte.forEach((it, i) => filaPartida(lz, `A${i + 1}`, it, true, () => {}));
  }

  // Condiciones
  const conds = condicionesDe(d.p, d.validez);
  if (conds.length) {
    const eLbl2: Estilo = { f: F.mono, size: 12, lh: 18, color: C.gris };
    const eTxt: Estilo = { f: F.sans, size: 13, lh: 18, color: C.tinta };
    const primera = partir(conds[0].texto, eTxt, ANCHO - 96 - 12).length * 18;
    asegurar(lz, 20 + 28 + 8 + primera);
    lz.y += 20;
    escribir(lz.page, "Condiciones", X0, lz.y, { f: F.archivo, size: 16, lh: 20, color: C.tinta });
    lz.y += 20 + 6;
    rect(lz.page, X0, lz.y, ANCHO, 2, C.noche);
    lz.y += 2 + 8;
    conds.forEach((c, i) => {
      const lineas = partir(c.texto, eTxt, ANCHO - 96 - 12);
      asegurar(lz, lineas.length * 18);
      if (i > 0) lz.y += 6;
      escribir(lz.page, c.label.toUpperCase(), X0, lz.y, eLbl2);
      lineas.forEach((l, j) => escribir(lz.page, l, X0 + 96 + 12, lz.y + j * 18, eTxt));
      lz.y += lineas.length * 18;
    });
  }

  // Contacto y aceptación del cliente
  const firma = 220;
  const eC: Estilo = { f: F.sans, size: 13, lh: 18, color: C.tinta };
  const eCb: Estilo = { ...eC, f: F.sansSemi };
  const contacto = d.p.contacto ?? d.elaborado;
  const maxC = ANCHO - firma - 24;
  const lineasC = contacto ? partir(`Contacto: ${contacto}`, eC, maxC) : [];
  const altoFila = Math.max(lineasC.length * 18, 19);
  asegurar(lz, 30 + altoFila);
  lz.y += 30;
  const abajo = lz.y + altoFila;
  lineasC.forEach((l, i) => {
    const top = abajo - lineasC.length * 18 + i * 18;
    if (i === 0 && l.startsWith("Contacto:")) {
      escribir(lz.page, "Contacto:", X0, top, eCb);
      escribir(lz.page, l.slice("Contacto:".length).trimStart(), X0 + ancho("Contacto: ", eCb), top, eC);
    } else escribir(lz.page, l, X0, top, eC);
  });
  const xf = X0 + ANCHO - firma;
  rect(lz.page, xf, abajo - 19, firma, 1, C.tinta);
  escribir(lz.page, "Aceptación del cliente", xf, abajo - 14, { f: F.mono, size: 12, lh: 14, color: C.gris }, { align: "center", caja: firma });
  lz.y = abajo;
}

// ── Entrada ──────────────────────────────────────────────────────────────────

type Datos = {
  numero: string;
  fecha: string;
  p: Propuesta;
  items: LetterItem[];
  totales: { subtotal: number; itbms: number; total: number };
  aplicaItbms: boolean;
  tasa: number;
  validez: number | null;
  elaborado: string | null;
  imagenes: { img: PDFImage; nota: string | null }[];
};

export async function renderPropuestaPdf(input: {
  quoteNumber: string;
  cliente: string;
  letter: LetterData;
  // path de storage → bytes. Lo que no esté acá se omite (imagen borrada).
  imagenes?: Map<string, Uint8Array>;
}): Promise<Uint8Array> {
  const { letter } = input;
  const doc = await PDFDocument.create();
  const [F, membreteBytes] = await Promise.all([
    cargarFuentes(doc),
    fs.readFile(path.join(process.cwd(), "public", "dicec-membrete.png")),
  ]);
  const membrete = await doc.embedPng(membreteBytes);
  const p = normalizarPropuesta(letter.propuesta, input.cliente);

  const imagenes: Datos["imagenes"] = [];
  for (const im of p.plano?.imagenes ?? []) {
    const bytes = input.imagenes?.get(im.path);
    if (!bytes) continue;
    try {
      const img = await embeberImagen(doc, bytes, im);
      imagenes.push({ img, nota: im.nota });
    } catch {
      /* imagen corrupta o de otro tipo: la propuesta sale sin ella */
    }
  }

  const d: Datos = {
    numero: numeroCarta(input.quoteNumber),
    fecha: letter.fecha,
    p,
    items: letter.items,
    totales: letterTotals(letter),
    aplicaItbms: letter.aplica_itbms,
    tasa: letter.tasa,
    validez: letter.validez,
    elaborado: letter.elaborado,
    imagenes,
  };

  const lz: Lienzo = { doc, F, membrete, pages: [], page: undefined as unknown as PDFPage, y: TOP, continuaciones: [] };
  lz.page = hoja(lz);
  lz.pages.push(lz.page);
  portada(lz, d);

  // Con plano, la primera página ya está llena (así es el diseño). Sin plano,
  // el alcance sigue abajo si entra el título, la tabla y al menos una partida:
  // una cotización chica sale en una sola hoja.
  if (imagenes.length > 0 || lz.y + 28 + 46 + 36 + 60 > FONDO) paginaNueva(lz);
  else lz.y += 28;
  alcance(lz, d);

  const total = lz.pages.length;
  if (total > 1) {
    const e: Estilo = { f: F.mono, size: 12, lh: 16, color: C.gris };
    const titulo = `Cotización ${d.numero} · ${p.titulo}`;
    for (const pg of lz.continuaciones) {
      const n = lz.pages.indexOf(pg) + 1;
      escribir(pg, partir(titulo, e, ANCHO - 80)[0], X0, TOP, e);
      escribir(pg, `${n} / ${total}`, X0, TOP, e, { align: "right", caja: ANCHO });
      rect(pg, X0, TOP + 16 + 10, ANCHO, 1, C.linea);
    }
  }
  return doc.save();
}

async function embeberImagen(doc: PDFDocument, bytes: Uint8Array, im: PropuestaImagen): Promise<PDFImage> {
  // Por los bytes, no por el mime guardado: una foto renombrada no rompe el PDF.
  const png = bytes[0] === 0x89 && bytes[1] === 0x50;
  void im;
  return png ? doc.embedPng(bytes) : doc.embedJpg(bytes);
}
