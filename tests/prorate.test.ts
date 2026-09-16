import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveDates, overlapFraction, sumarMeses } from "../src/lib/quickbooks/prorate";

// De dónde salen las fechas del proyecto, y —lo que costó descubrir— si el DÍA
// de cada extremo es un dato o un artefacto del reporte mensual.

test("manual: las dos fechas cargadas a mano mandan y traen día real", () => {
  const e = effectiveDates({ startDate: "2026-03-14", endDate: "2026-09-30", qboCreatedAt: "2026-01-01", firstTxnDate: "2026-04-01", year: 2026 });
  assert.deepEqual(e, { start: "2026-03-14", end: "2026-09-30", fuente: "manual", diaStart: true, diaEnd: true });
});

test("qbo desde el reporte MENSUAL: el día 1 no es un dato", () => {
  const e = effectiveDates({ startDate: null, endDate: null, firstTxnDate: "2026-03-01", lastTxnDate: "2026-08-01", txnDatesSource: "mes", year: 2026 });
  assert.equal(e?.fuente, "qbo");
  assert.equal(e?.diaStart, false);
  assert.equal(e?.diaEnd, false);
});

test("qbo desde TRANSACCIONES: el día sí es un dato", () => {
  const e = effectiveDates({ startDate: null, endDate: null, firstTxnDate: "2026-03-14", lastTxnDate: "2026-08-22", txnDatesSource: "transaccion", year: 2026 });
  assert.equal(e?.diaStart, true);
  assert.equal(e?.diaEnd, true);
});

test("la fecha de alta del cliente en QBO gana si es anterior, y trae día real", () => {
  const e = effectiveDates({ startDate: null, endDate: null, qboCreatedAt: "2026-02-10", firstTxnDate: "2026-03-01", lastTxnDate: "2026-08-01", txnDatesSource: "mes", year: 2026 });
  assert.equal(e?.start, "2026-02-10");
  assert.equal(e?.diaStart, true);
  assert.equal(e?.diaEnd, false, "el fin sigue viniendo del mes");
});

test("solo inicio: asume 12 meses, y el fin hereda si el inicio tenía día", () => {
  const e = effectiveDates({ startDate: "2026-03-14", endDate: null, year: 2026 });
  assert.equal(e?.fuente, "asumido");
  assert.equal(e?.end, "2027-03-13");
  assert.equal(e?.diaStart, true);
  assert.equal(e?.diaEnd, true);
});

test("solo el año: enero a diciembre, sin día", () => {
  const e = effectiveDates({ startDate: null, endDate: null, year: 2026 });
  assert.deepEqual(e, { start: "2026-01-01", end: "2026-12-31", fuente: "asumido", diaStart: false, diaEnd: false });
});

test("sin ninguna pista → null; fin antes que inicio se recorta al inicio", () => {
  assert.equal(effectiveDates({ startDate: null, endDate: null, year: null }), null);
  const e = effectiveDates({ startDate: "2026-05-01", endDate: "2026-04-01", year: 2026 });
  assert.equal(e?.end, "2026-05-01");
});

test("overlapFraction y sumarMeses: un mes partido por el rango aporta su parte", () => {
  assert.equal(overlapFraction("2026-01-01", "2026-12-31", { from: "2026-01-01", to: "2026-12-31" }), 1);
  assert.equal(overlapFraction("2026-01-01", "2026-12-31", { from: "2027-01-01", to: "2027-12-31" }), 0);
  const s = sumarMeses(
    [
      { month: "2026-03-01", income: 3100, cost: 310, tax: 217 },
      { month: "2026-04-01", income: 1000, cost: 100, tax: 70 },
    ],
    { from: "2026-03-01", to: "2026-03-31" },
  );
  assert.deepEqual(s, { income: 3100, cost: 310, tax: 217 });
});
