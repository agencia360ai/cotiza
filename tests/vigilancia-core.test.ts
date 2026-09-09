import { test } from "node:test";
import assert from "node:assert/strict";
import { compararSnapshots, type Snapshot } from "../src/lib/panamacompra/vigilancia-core";

const base: Snapshot = { estado: "36", reclamos: "0", actaApertura: null, convocatoria: "1", fechaCierre: "2026-09-20" };

test("primera revisión: se guarda la foto sin inventar cambios", () => {
  assert.deepEqual(compararSnapshots(null, base), []);
});

test("sin cambios → nada que avisar", () => {
  assert.deepEqual(compararSnapshots(base, { ...base }), []);
});

test("el acta de apertura manda: es donde piden subsanar", () => {
  const c = compararSnapshots(base, { ...base, estado: "18", actaApertura: "1" });
  assert.equal(c[0].campo, "actaApertura", "va primero aunque el estado también haya cambiado");
  assert.match(c[0].resumen, /subsanar/);
  assert.equal(c[1].campo, "estado");
});

test("un reclamo nuevo se dice como riesgo, no como número", () => {
  const c = compararSnapshots(base, { ...base, reclamos: "1" });
  assert.match(c[0].resumen, /Entró un reclamo/);
});

test("convocatoria nueva = hay que volver a presentar", () => {
  const c = compararSnapshots(base, { ...base, convocatoria: "2" });
  assert.match(c[0].resumen, /volver a presentar/);
});

test("mover la fecha de cierre se dice con la fecha", () => {
  const c = compararSnapshots(base, { ...base, fechaCierre: "2026-10-05T00:00:00" });
  assert.match(c[0].resumen, /2026-10-05/);
});
