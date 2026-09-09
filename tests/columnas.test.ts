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
