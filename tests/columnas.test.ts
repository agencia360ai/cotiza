import { test } from "node:test";
import assert from "node:assert/strict";
import { desdeV1, mover, sanear, ORDEN_DEFECTO, type ColKey } from "../src/app/(app)/proyectos/columnas";

test("mover hacia la derecha deja la columna DESPUÉS de donde se soltó", () => {
  const o: ColKey[] = ["nombre", "cliente", "total", "cobrado"];
  assert.deepEqual(mover(o, "nombre", "total"), ["cliente", "total", "nombre", "cobrado"]);
});

test("mover hacia la izquierda la deja ANTES", () => {
  const o: ColKey[] = ["nombre", "cliente", "total", "cobrado"];
  assert.deepEqual(mover(o, "cobrado", "cliente"), ["nombre", "cobrado", "cliente", "total"]);
});

test("mover sobre sí misma o con llaves desconocidas devuelve la misma referencia", () => {
  const o: ColKey[] = ["nombre", "cliente"];
  assert.equal(mover(o, "nombre", "nombre"), o);
  assert.equal(mover(o, "gasto", "nombre"), o);
});

test("sanear: una preferencia vieja no puede dejar la tabla sin columnas nuevas", () => {
  const s = sanear(["total", "nombre"], []);
  assert.deepEqual(s.orden.filter((k) => k === "total" || k === "nombre"), ["total", "nombre"], "respeta el orden pedido");
  assert.equal(s.orden.length, ORDEN_DEFECTO.length, "las que faltan se agregan");
  assert.deepEqual([...new Set(s.orden)], s.orden, "sin duplicados");
});

test("sanear: una columna nueva aparece al lado de donde va por defecto, no al final", () => {
  // Preferencia guardada antes de que existiera "Por facturar", con el orden cambiado.
  const viejo: ColKey[] = ["nombre", "total", "cliente", "cobrado", "gasto", "inicio", "fin", "estado", "margen", "cotizacion"];
  const s = sanear(viejo, ["cotizacion", "margen"]);
  assert.deepEqual(s.orden, ["nombre", "porfacturar", "total", "cliente", "cobrado", "gasto", "inicio", "fin", "estado", "margen", "cotizacion"]);
  assert.ok(!s.ocultas.includes("porfacturar"), "y se ve");
});

test("por defecto: Por facturar, Facturado y Cobrado, en ese orden", () => {
  const i = (k: ColKey) => ORDEN_DEFECTO.indexOf(k);
  assert.equal(i("total"), i("porfacturar") + 1);
  assert.equal(i("cobrado"), i("total") + 1);
});

test("desdeV1: una preferencia v1 pasa Por facturar antes de Facturado y conserva lo demás", () => {
  const v1 = JSON.stringify({
    orden: ["nombre", "cliente", "total", "porfacturar", "cobrado", "gasto", "inicio", "fin", "estado", "margen", "cotizacion"],
    ocultas: ["cotizacion"],
  });
  const g = JSON.parse(desdeV1(v1)!);
  const s = sanear(g.orden, g.ocultas);
  assert.deepEqual(s.orden.slice(0, 5), ["nombre", "cliente", "porfacturar", "total", "cobrado"]);
  assert.deepEqual(s.ocultas, ["cotizacion"], "las columnas ocultas siguen ocultas");
  assert.equal(desdeV1(null), null);
  assert.equal(desdeV1("{roto"), null);
});

test("sanear: llaves que ya no existen se filtran, duplicados se quitan", () => {
  const s = sanear(["nombre", "vieja", "nombre", 42, null], ["cotizacion", "inventada"]);
  assert.equal(s.orden.filter((k) => k === "nombre").length, 1);
  assert.equal(s.orden.includes("vieja" as ColKey), false);
  assert.deepEqual(s.ocultas, ["cotizacion"]);
});

test("sanear: basura total → defaults", () => {
  const s = sanear("no", "tampoco");
  assert.deepEqual(s.orden, ORDEN_DEFECTO);
  assert.deepEqual(s.ocultas, ["cotizacion", "margen"]);
});
