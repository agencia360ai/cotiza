import { test } from "node:test";
import assert from "node:assert/strict";
import { cartaDeGenerada } from "../src/lib/quotes/desde-ia";
import type { GeneratedQuote } from "../src/lib/ai/generate-quote";

const generada: GeneratedQuote = {
  client_name: "Cantina del Tigre",
  ubicacion: "San Francisco",
  tipo: "realizar",
  rubro: "DM",
  items: [
    { titulo: "Mantenimiento fancoils", cant: 2, desc: "Mantenimiento profundo de blower, fancoil McQuay 5 TR", precio: 450, aparte: false },
    { titulo: null, cant: 1, desc: "Recarga de refrigerante, por evento", precio: 120, aparte: true },
  ],
  aplica_itbms: true,
  validez_dias: null,
  condiciones: "Anticipo del 50%.",
  descripcion_corta: "Mantenimiento profundo de fancoils",
  propuesta: null,
};

test("la carta conserva renglones, precios y lo que va fuera del total", () => {
  const l = cartaDeGenerada(generada, { formato: "carta", fecha: "2026-10-23", elaborado: null, contacto: null, cliente: "Cantina del Tigre" });
  assert.deepEqual(l.items, [
    { cant: 2, desc: "Mantenimiento profundo de blower, fancoil McQuay 5 TR", precio: 450, aparte: undefined },
    { cant: 1, desc: "Recarga de refrigerante, por evento", precio: 120, aparte: true },
  ]);
  assert.equal(l.fecha, "2026-10-23");
  assert.equal(l.validez, 30, "sin validez en el PDF queda la de siempre");
  assert.equal(l.condiciones, "Anticipo del 50%.");
  assert.equal(l.aplica_itbms, true);
  assert.equal(l.tasa, 7);
  assert.equal(l.propuesta, null, "la carta clásica no lleva propuesta");
  assert.ok(l.items.every((it) => !("titulo" in it)), "la carta clásica no lleva títulos de partida");
});

test("en formato Propuesta viajan los títulos y el contacto", () => {
  const l = cartaDeGenerada(generada, { formato: "propuesta", fecha: "2026-10-23", elaborado: "J. Guerra", contacto: "Ventas DICEC", cliente: "Cantina del Tigre" });
  assert.equal(l.items[0].titulo, "Mantenimiento fancoils");
  assert.equal(l.items[1].titulo, undefined);
  assert.equal(l.elaborado, "J. Guerra");
  assert.equal(l.propuesta?.contacto, "Ventas DICEC");
  assert.equal(l.propuesta?.plano, null);
});

test("de dónde sale la revisión: PDF subido, carta, PDF de Dropbox, o el resumen", async () => {
  const { fuenteDeRevision } = await import("../src/lib/quotes/revision");
  assert.equal(fuenteDeRevision({ pdfSubido: true, conCarta: true, conPdfEnDropbox: true }), "pdf-subido", "lo que se subió recién manda");
  assert.equal(fuenteDeRevision({ pdfSubido: false, conCarta: true, conPdfEnDropbox: true }), "carta", "la carta es la original exacta");
  assert.equal(fuenteDeRevision({ pdfSubido: false, conCarta: false, conPdfEnDropbox: true }), "pdf-original");
  assert.equal(fuenteDeRevision({ pdfSubido: false, conCarta: false, conPdfEnDropbox: false }), "resumen");
});
