import { test } from "node:test";
import assert from "node:assert/strict";
import { letterTotals, partirItems, resolveTextos, type LetterData } from "../src/lib/quotes/letter";

// El caso real de Lanco (COT DC 26-208): 680 mensual + filtros a 150 por evento.
const carta: LetterData = {
  fecha: "2026-09-08",
  ubicacion: null,
  tipo: "realizar",
  items: [
    { cant: 2, desc: "Manejadora Trane 10 TR", precio: 130 },
    { cant: 4, desc: "Fan coil Lennox 5 TR", precio: 70 },
    { cant: 1, desc: "Split Carrier 3 TR", precio: 50 },
    { cant: 1, desc: "Mini split Carrier 2 TR", precio: 40 },
    { cant: 1, desc: "Mini split Carrier 1.5 TR", precio: 30 },
    { cant: 1, desc: "Fan coil Carrier 1 TR", precio: 20 },
    { cant: 1, desc: "Reemplazo de filtros — por evento", precio: 150, aparte: true },
  ],
  aplica_itbms: true,
  tasa: 7,
  validez: 30,
  condiciones: null,
  elaborado: null,
};

const r2 = (n: number) => Math.round(n * 100) / 100;

test("los renglones aparte no suman al total ni al ITBMS", () => {
  const t = letterTotals(carta);
  assert.equal(t.subtotal, 680, "680, no 830");
  assert.equal(r2(t.itbms), 47.6, "ITBMS sobre 680");
  assert.equal(r2(t.total), 727.6);
});

test("partirItems separa lo que suma de lo que se cotiza aparte", () => {
  const { enTotal, aparte } = partirItems(carta.items);
  assert.equal(enTotal.length, 6);
  assert.equal(aparte.length, 1);
  assert.equal(aparte[0].precio, 150);
});

test("cartas guardadas antes de `aparte` dan exactamente el mismo total que antes", () => {
  const vieja: LetterData = { ...carta, items: carta.items.map((i) => ({ cant: i.cant, desc: i.desc, precio: i.precio })) };
  assert.equal(letterTotals(vieja).subtotal, 830);
});

test("todos aparte → total 0, no NaN", () => {
  const todos: LetterData = { ...carta, items: carta.items.map((i) => ({ ...i, aparte: true })) };
  assert.equal(letterTotals(todos).total, 0);
});

test("sin ITBMS el total es el subtotal", () => {
  assert.equal(letterTotals({ ...carta, aplica_itbms: false }).total, 680);
});

test("el rótulo del bloque aparte tiene default, se reescribe y se borra con cadena vacía", () => {
  const ctx = { quoteNumber: "COT DC 26-208" };
  assert.match(resolveTextos(carta, ctx).lbl_aparte, /solo cuando se soliciten/);
  assert.equal(resolveTextos({ ...carta, textos: { lbl_aparte: "Cargos por evento:" } }, ctx).lbl_aparte, "Cargos por evento:");
  assert.equal(resolveTextos({ ...carta, textos: { lbl_aparte: "" } }, ctx).lbl_aparte, "");
});

test("la intro cambia con el tipo de trabajos", () => {
  const ctx = { quoteNumber: "X" };
  assert.match(resolveTextos({ ...carta, tipo: "realizar" }, ctx).intro, /a realizar/);
  assert.match(resolveTextos({ ...carta, tipo: "realizados" }, ctx).intro, /realizados/);
});
