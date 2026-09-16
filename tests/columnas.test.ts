import { test } from "node:test";
import assert from "node:assert/strict";
import { mover, sanear, ORDEN_DEFECTO, type ColKey } from "../src/app/(app)/proyectos/columnas";

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
  assert.deepEqual(s.orden.slice(0, 2), ["total", "nombre"], "respeta el orden pedido");
  assert.equal(s.orden.length, ORDEN_DEFECTO.length, "las que faltan se agregan al final");
  assert.deepEqual([...new Set(s.orden)], s.orden, "sin duplicados");
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

test("Facturado y Tax existen y una preferencia vieja las recibe", () => {
  assert.ok(ORDEN_DEFECTO.includes("facturado"), "el pendiente de cobro es columna propia");
  assert.ok(ORDEN_DEFECTO.includes("tax"), "el ITBMS salió del gasto y tiene la suya");
  // Preferencia guardada ANTES de que existieran: no puede dejarlas afuera.
  const vieja = ["nombre", "cliente", "total", "cobrado", "gasto", "inicio", "fin", "estado", "margen", "cotizacion"];
  const s = sanear(vieja, []);
  assert.ok(s.orden.includes("facturado"));
  assert.ok(s.orden.includes("tax"));
  assert.equal(s.orden.length, ORDEN_DEFECTO.length);
});

test("Facturado va pegado a Cobrado: se leen juntas o no se leen", () => {
  const i = ORDEN_DEFECTO.indexOf("cobrado");
  assert.equal(ORDEN_DEFECTO[i + 1], "facturado", "cobrado + facturado = total, así que van contiguas");
});
