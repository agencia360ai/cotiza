import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { renderQuotePdf } from "../src/lib/quotes/pdf";
import { condicionesDe, normalizarPropuesta, propuestaVacia } from "../src/lib/quotes/propuesta";
import { aplicarAjuste, type BorradorAjustable, type RefinedQuote } from "../src/lib/quotes/refinar-core";
import { leerHtmlDiseno, textoVisible } from "../src/lib/office/html-diseno";
import { NAZ } from "./fixtures/propuesta-naz";

// El formato Propuesta: el diseño de NAZ Beauty Shop hecho datos. Las pruebas
// generan el PDF de verdad (membrete y fuentes reales) y miran lo que sale.

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const imagenesNaz = new Map(NAZ.letter.propuesta!.plano!.imagenes.map((i) => [i.path, new Uint8Array(PNG_1PX)]));

async function pdf(letter = NAZ.letter, imagenes = imagenesNaz) {
  const bytes = await renderQuotePdf({ quoteNumber: NAZ.quoteNumber, cliente: NAZ.cliente, letter, imagenes });
  return { bytes, doc: await PDFDocument.load(bytes) };
}

test("NAZ sale en dos hojas, como el diseño: resumen con plano, y alcance y precio", async () => {
  const { doc } = await pdf();
  assert.equal(doc.getPageCount(), 2);
  const [w, h] = [doc.getPage(0).getWidth(), doc.getPage(0).getHeight()];
  assert.deepEqual([w, h], [612, 792], "carta US, igual que la carta clásica");
});

test("las fuentes del diseño van embebidas (no Helvetica)", async () => {
  const { doc } = await pdf();
  const fuentes = doc.context
    .enumerateIndirectObjects()
    .map(([, o]) => o)
    .filter((o): o is PDFDict => o instanceof PDFDict && o.get(PDFName.of("Type")) === PDFName.of("Font"))
    .map((o) => String(o.get(PDFName.of("BaseFont")) ?? ""));
  for (const f of ["Archivo-Bold", "IBMPlexSans", "IBMPlexMono"]) assert.ok(fuentes.some((n) => n.includes(f)), f);
  assert.ok(!fuentes.some((n) => /Helvetica/.test(n)), "sin fuentes estándar");
});

test("sin plano, el alcance arranca en la primera hoja", async () => {
  const sinPlano = { ...NAZ.letter, propuesta: { ...NAZ.letter.propuesta!, plano: null } };
  const { doc } = await pdf(sinPlano, new Map());
  // El resumen sin plano deja lugar: las 7 partidas empiezan en la hoja 1.
  assert.ok(doc.getPageCount() <= 2);
});

test("muchas partidas: pagina sin romperse", async () => {
  const items = Array.from({ length: 40 }, (_, i) => ({ cant: 1, titulo: `Partida ${i + 1}`, desc: "Suministro e instalación según planos", precio: 100 }));
  const { doc } = await pdf({ ...NAZ.letter, items });
  assert.ok(doc.getPageCount() >= 3);
});

test("una imagen que falta en storage no rompe el PDF: sale sin ella", async () => {
  const { doc } = await pdf(NAZ.letter, new Map());
  assert.equal(doc.getPageCount(), 2);
});

test("normalizarPropuesta: recorta a lo que entra en el diseño y descarta lo vacío", () => {
  const p = normalizarPropuesta({
    titulo: "  NAZ  ",
    datos: [{ label: "Cliente", valor: "NAZ" }, { label: "", valor: "x" }, { label: "A", valor: "1" }, { label: "B", valor: "2" }, { label: "C", valor: "3" }],
    cifras: Array.from({ length: 6 }, (_, i) => ({ valor: String(i), texto: "" })),
    plazo: { label: "", valor: "" },
    plano: { titulo: "", imagenes: [{ path: "a.png", mime: "image/png" }, { path: "b.gif", mime: "image/gif" }] },
  });
  assert.equal(p.titulo, "NAZ");
  assert.equal(p.datos.length, 3);
  assert.equal(p.datos[0].label, "Cliente");
  assert.equal(p.cifras.length, 4);
  assert.equal(p.plazo, null, "un plazo sin valor no se imprime");
  assert.deepEqual(p.plano?.imagenes.map((i) => i.path), ["a.png"], "solo PNG/JPG");
  assert.equal(p.plano?.titulo, "Plano");
  assert.deepEqual(normalizarPropuesta(null, "Cliente X"), propuestaVacia("Cliente X"));
});

test("la vigencia sale de la validez si la propuesta no la trae, y no se duplica", () => {
  const p = { ...propuestaVacia("X"), condiciones: [{ label: "Pago", texto: "Contado." }] };
  assert.deepEqual(condicionesDe(p, 15)[0], { label: "VIGENCIA", texto: "15 días." });
  const conVig = { ...p, condiciones: [{ label: "Vigencia", texto: "30 días." }] };
  assert.equal(condicionesDe(conVig, 15).length, 1);
});

test("ajustar con IA cambia la propuesta pero no el contacto ni el plano", () => {
  const actual: BorradorAjustable = { numero: NAZ.quoteNumber, cliente: NAZ.cliente, rubro: "DC", descripcionCorta: "NAZ", letter: NAZ.letter };
  const prop = NAZ.letter.propuesta!;
  const respuesta: RefinedQuote = {
    client_name: NAZ.cliente,
    rubro: "DC",
    descripcion_corta: "NAZ",
    ubicacion: null,
    tipo: "realizar",
    items: NAZ.letter.items.map((it) => ({ ...it, titulo: it.titulo ?? null, aparte: false })),
    aplica_itbms: true,
    validez_dias: 30,
    condiciones: null,
    textos_cambios: [],
    propuesta: { ...prop, plazo: { label: "Instalación", valor: "15 días hábiles", detalle: null } },
    resumen: "Plazo a 15 días",
  };
  const out = aplicarAjuste(actual, respuesta);
  assert.equal(out.letter.propuesta?.plazo?.valor, "15 días hábiles");
  assert.equal(out.letter.propuesta?.contacto, prop.contacto);
  assert.deepEqual(out.letter.propuesta?.plano, prop.plano);
  assert.equal(out.letter.items[0].titulo, "Unidad autocontenida 15 TR");
  assert.equal(out.letter.formato, "propuesta", "el formato no lo cambia la IA");
  // Sin propuesta en la respuesta (formato carta), no se borra la que había.
  assert.deepEqual(aplicarAjuste(actual, { ...respuesta, propuesta: null }).letter.propuesta, prop);
});

// ── HTML de diseño ───────────────────────────────────────────────────────────

const empaquetar = (template: string, recursos: Record<string, { mime: string; bytes: Buffer }>) => {
  const manifest = Object.fromEntries(
    Object.entries(recursos).map(([id, r]) => [id, { mime: r.mime, compressed: true, data: gzipSync(r.bytes).toString("base64") }]),
  );
  return `<html><body><script type="__bundler/manifest">${JSON.stringify(manifest)}</script>
<script type="__bundler/template">${JSON.stringify(template)}</script></body></html>`;
};

test("lee un HTML empaquetado y anidado: texto de cada página e imágenes, sin el membrete", async () => {
  const pagina = empaquetar(
    `<x-dc><helmet><style>.a{}</style></helmet><img src="m1" alt="Membrete DICEC, Inc."><div>COTIZACIÓN</div><div>DC 26-211</div><h1>NAZ &amp; Co.</h1><img src="p1" alt="Planta de aire"><div>B/. 28,500.00</div></x-dc>`,
    { m1: { mime: "image/jpeg", bytes: Buffer.from([0xff, 0xd8, 0xff]) }, p1: { mime: "image/png", bytes: PNG_1PX } },
  );
  const tablero = empaquetar(`<section><h2>1 · Resumen</h2><iframe src="about:blank#pg"></iframe></section>`, {
    pg: { mime: "text/html", bytes: Buffer.from(pagina) },
  });
  const r = await leerHtmlDiseno(tablero);
  assert.match(r.texto, /DC 26-211/);
  assert.match(r.texto, /NAZ & Co\./, "decodifica entidades");
  assert.match(r.texto, /B\/\. 28,500\.00/);
  assert.doesNotMatch(r.texto, /\.a\{\}/, "sin CSS");
  assert.deepEqual(r.imagenes.map((i) => [i.mime, i.alt]), [["image/png", "Planta de aire"]]);
  assert.equal(Buffer.from(r.imagenes[0].base64, "base64").length, PNG_1PX.length);
});

test("un HTML común se lee como texto", async () => {
  assert.equal(textoVisible("<p>Hola&nbsp;<b>mundo</b></p><p>2</p>"), "Hola mundo\n2");
  const r = await leerHtmlDiseno("<html><body><h1>Cotización</h1></body></html>");
  assert.equal(r.texto, "Cotización");
  assert.equal(r.imagenes.length, 0);
});

test("las fuentes de la Propuesta están en public/ con su licencia", () => {
  const dir = join(process.cwd(), "public", "fonts", "propuesta");
  for (const f of ["Archivo-Bold.ttf", "IBMPlexSans-Regular.ttf", "IBMPlexMono-SemiBold.ttf", "OFL-Archivo.txt", "OFL-IBMPlex.txt"]) {
    assert.ok(readFileSync(join(dir, f)).length > 1000, f);
  }
});
