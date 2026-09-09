import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicarAjuste, type RefinedQuote, type BorradorAjustable } from "../src/lib/quotes/refinar-core";
import { letterTotals } from "../src/lib/quotes/letter";

// Acá vive la garantía de que "ajustar con IA" no rompe el formato: lo que la
// IA no puede tocar se preserva del borrador anterior.

const actual: BorradorAjustable = {
  numero: "COT DC 26-208",
  cliente: "Lanco Medical Group",
  rubro: "DM",
  descripcionCorta: "Mantenimiento preventivo mensual",
  letter: {
    fecha: "2026-09-08",
    ubicacion: "Galera 3 y Galera 4",
    tipo: "realizar",
    items: [{ cant: 2, desc: "Manejadora Trane 10 TR", precio: 130 }],
    aplica_itbms: true,
    tasa: 7,
    validez: 30,
    condiciones: "Validez 30 días.",
    elaborado: "J. Guerra",
    textos: { th_precio: "Tarifa", empresa: "DICEC, INC" },
    firma: { id: "f1", x: 0.1, y: 0.8, w: 0.2 },
  },
};

const r = (over: Partial<RefinedQuote> = {}): RefinedQuote => ({
  client_name: "Lanco Medical Group",
  rubro: "DM",
  descripcion_corta: "Mantenimiento preventivo mensual",
  ubicacion: "Galera 3 y Galera 4",
  tipo: "realizar",
  items: [
    { cant: 2, desc: "Manejadora Trane 10 TR — mensual", precio: 130, aparte: false },
    { cant: 1, desc: "Limpieza anual de ductos (una sola vez)", precio: 450, aparte: true },
  ],
  aplica_itbms: true,
  validez_dias: 30,
  condiciones: "Mensual se factura vencido a 30 días.",
  textos_cambios: [],
  resumen: "Separé el mantenimiento mensual del add-on de una sola vez.",
  ...over,
});

test("el caso del usuario: separar mensual de add-ons", () => {
  const a = aplicarAjuste(actual, r());
  assert.equal(a.letter.items.length, 2);
  assert.equal(a.letter.items.filter((i) => i.aparte).length, 1, "conserva el flag aparte");
  assert.equal(letterTotals(a.letter).subtotal, 260, "el total solo cuenta lo mensual");
  assert.match(a.resumen, /Separé/);
});

test("lo que la IA no puede tocar se preserva: fecha, tasa, elaborado, firma, correlativo", () => {
  const a = aplicarAjuste(actual, r());
  assert.equal(a.letter.fecha, "2026-09-08");
  assert.equal(a.letter.tasa, 7);
  assert.equal(a.letter.elaborado, "J. Guerra");
  assert.deepEqual(a.letter.firma, actual.letter.firma);
  assert.equal(a.numero, "COT DC 26-208");
});

test("los rótulos se mergean: el nuevo entra y los viejos sobreviven", () => {
  const b = aplicarAjuste(actual, r({ textos_cambios: [{ campo: "th_desc", valor: "Servicio" }] }));
  assert.equal(b.letter.textos?.th_desc, "Servicio");
  assert.equal(b.letter.textos?.th_precio, "Tarifa", "un ajuste sobre otra cosa no borra un rótulo reescrito antes");
  assert.equal(b.letter.textos?.empresa, "DICEC, INC");
});

test("cadena vacía borra una línea de la carta", () => {
  const c = aplicarAjuste(actual, r({ textos_cambios: [{ campo: "validez_texto", valor: "" }] }));
  assert.equal(c.letter.textos?.validez_texto, "");
});

test("cambio de rubro y descripción corta", () => {
  const d = aplicarAjuste(actual, r({ rubro: "DC", descripcion_corta: "Contrato de mantenimiento" }));
  assert.equal(d.rubro, "DC");
  assert.equal(d.descripcionCorta, "Contrato de mantenimiento");
});

test("sin rótulos previos ni cambios queda null, no {}", () => {
  const sinTextos = { ...actual, letter: { ...actual.letter, textos: null } };
  assert.equal(aplicarAjuste(sinTextos, r()).letter.textos, null);
});

test("encadenar dos ajustes no pierde nada", () => {
  const b = aplicarAjuste(actual, r({ textos_cambios: [{ campo: "th_desc", valor: "Servicio" }] }));
  const f = aplicarAjuste(b, r({ textos_cambios: [{ campo: "lbl_total", valor: "Total mensual" }] }));
  assert.equal(f.letter.textos?.th_desc, "Servicio");
  assert.equal(f.letter.textos?.th_precio, "Tarifa");
  assert.equal(f.letter.textos?.lbl_total, "Total mensual");
  assert.equal(f.letter.firma?.id, "f1");
});
