import { test } from "node:test";
import assert from "node:assert/strict";
import { barra, etiquetaCada, fmtEje, marcasEje, posicionTip, rellenarMeses } from "../src/app/(app)/proyectos/grafica-core";

test("marcasEje: tope redondo que cubre el máximo", () => {
  assert.deepEqual(marcasEje(92083), [0, 25000, 50000, 75000, 100000]);
  assert.deepEqual(marcasEje(100000), [0, 25000, 50000, 75000, 100000]);
  assert.deepEqual(marcasEje(130000), [0, 50000, 100000, 150000]);
  assert.deepEqual(marcasEje(7), [0, 2, 4, 6, 8]);
});

test("marcasEje: sin datos no rompe la escala", () => {
  assert.deepEqual(marcasEje(0), [0, 1]);
  assert.deepEqual(marcasEje(Number.NaN), [0, 1]);
});

test("fmtEje: corto y con signo antes del $", () => {
  assert.equal(fmtEje(0), "$0");
  assert.equal(fmtEje(750), "$750");
  assert.equal(fmtEje(25000), "$25K");
  assert.equal(fmtEje(2500), "$2.5K");
  assert.equal(fmtEje(1250000), "$1.3M");
  assert.equal(fmtEje(-5000), "-$5K");
});

test("rellenarMeses: un mes sin movimiento aparece en cero en su lugar", () => {
  const data = [
    { month: "2026-03-01", v: 1 },
    { month: "2026-05-01", v: 2 },
  ];
  const r = rellenarMeses(data, (month) => ({ month, v: 0 }));
  assert.deepEqual(r.map((d) => d.month), ["2026-03-01", "2026-04-01", "2026-05-01"]);
  assert.equal(r[1].v, 0);
});

test("rellenarMeses: cruza el año y respeta el orden aunque venga desordenado", () => {
  const data = [
    { month: "2026-01-01", v: 2 },
    { month: "2025-11-01", v: 1 },
  ];
  const r = rellenarMeses(data, (month) => ({ month, v: 0 }));
  assert.deepEqual(r.map((d) => d.month), ["2025-11-01", "2025-12-01", "2026-01-01"]);
});

test("etiquetaCada: salta en trimestres o semestres cuando no entran", () => {
  assert.equal(etiquetaCada(12, 120, 30), 1);
  assert.equal(etiquetaCada(40, 14, 36), 3);
  assert.equal(etiquetaCada(60, 8, 36), 6);
});

test("posicionTip: al costado del mes; si no entra, del otro lado; si tampoco, dentro de la tarjeta", () => {
  assert.equal(posicionTip(100, 20, 1000, 196), 132, "a la derecha");
  assert.equal(posicionTip(900, 20, 1000, 196), 900 - 20 - 12 - 196, "a la izquierda cerca del borde derecho");
  const l = posicionTip(160, 10, 320, 196);
  assert.ok(l >= 0 && l + 196 <= 320, "celular: centrado y adentro");
});

test("barra: base recta y tope redondeado; sin redondeo para el tramo de abajo", () => {
  assert.match(barra(0, 10, 50, 100, true), /Q 0 50 4 50/);
  assert.match(barra(0, 10, 50, 100, false), /Q 0 50 0 50/);
  assert.ok(barra(0, 10, 99, 100, true).includes("Q 0 99 0.5 99"), "una barra de 1px no se dobla");
});
