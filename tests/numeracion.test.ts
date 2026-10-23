import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anioDeNumero,
  correlativo,
  formatoNumero,
  mayor,
  mismoNumero,
  numeroBase,
  numeroEnTexto,
  reemplazarNumero,
  revisionSiguiente,
} from "../src/lib/quotes/numeracion";

test("numeroEnTexto: el número del nombre del archivo, con su revisión", () => {
  assert.equal(numeroEnTexto("COT DC 26-242 - COPAMA - Suministro.pdf"), "COT DC 26-242");
  assert.equal(numeroEnTexto("cot dc 26-211  rev 2 Cantina.pdf"), "COT DC 26-211 REV 2");
  assert.equal(numeroEnTexto("COT DC 26-198A - Lazotea.pdf"), "COT DC 26-198A");
  assert.equal(numeroEnTexto("Cotización NAZ.pdf"), null);
});

test("numeroBase: una revisión es el mismo número", () => {
  assert.equal(numeroBase("COT DC 26-211 REV 2"), "COT DC 26-211");
  assert.equal(numeroBase("COT DC 26-211A"), "COT DC 26-211");
  assert.equal(numeroBase("cot dc 26-9"), "COT DC 26-009");
  assert.equal(numeroBase("26-211"), null);
});

test("el correlativo se busca solo en el año pedido", () => {
  assert.equal(correlativo("COT DC 26-242 - COPAMA.pdf", "26"), 242);
  assert.equal(correlativo("COT DC 25-410 - viejo.pdf", "26"), null);
  assert.equal(anioDeNumero("COT DC 26-211"), 2026);
});

test("mayor: el más alto de la carpeta, aunque vengan desordenados y con otros archivos", () => {
  const carpeta = ["COT DC 26-099 - A.pdf", "Notas.docx", "COT DC 26-242 - COPAMA.pdf", "COT DC 26-240 - B.pdf", "COT DC 25-500.pdf"];
  assert.deepEqual(mayor(carpeta, "26"), { n: 242, texto: "COT DC 26-242 - COPAMA.pdf" });
  assert.equal(mayor([], "26"), null);
  assert.equal(formatoNumero("26", 243), "COT DC 26-243");
  assert.equal(formatoNumero("26", 7), "COT DC 26-007");
});

test("nombre en Dropbox: se respeta el del equipo si ya trae el número; si no, se le pone adelante", async () => {
  const { nombreEnDropbox } = await import("../src/lib/quotes/subir-pdf");
  assert.equal(nombreEnDropbox("COT DC 26-243 - COPAMA - Suministro.pdf", "COT DC 26-243"), "COT DC 26-243 - COPAMA - Suministro.pdf");
  assert.equal(nombreEnDropbox("COT DC 26-243 Rev 1 - COPAMA.pdf", "COT DC 26-243"), "COT DC 26-243 Rev 1 - COPAMA.pdf", "una revisión es el mismo número");
  assert.equal(nombreEnDropbox("Cotizacion Chen.pdf", "COT DC 26-244"), "COT DC 26-244 - Cotizacion Chen.pdf");
  assert.equal(nombreEnDropbox("COT DC 26-200 viejo.pdf", "COT DC 26-244"), "COT DC 26-244 - COT DC 26-200 viejo.pdf", "otro número en el nombre no cuenta");
  assert.equal(nombreEnDropbox('Chen: "final"/v2.PDF', "COT DC 26-244"), "COT DC 26-244 - Chen final v2.PDF");
  assert.equal(nombreEnDropbox("Chen", "COT DC 26-244"), "COT DC 26-244 - Chen.pdf");
});

test("revisión siguiente: la que sigue a TODAS las de esa base, se escriban como se escriban", () => {
  assert.equal(revisionSiguiente("COT DC 26-211", ["COT DC 26-211"]), "COT DC 26-211 REV 1");
  assert.equal(revisionSiguiente("COT DC 26-211", ["COT DC 26-211", "COT DC 26-211 REV 1"]), "COT DC 26-211 REV 2");
  assert.equal(revisionSiguiente("COT DC 26-020", ["COT DC 26-020 REV. 2", "COT DC 26-020 REV 1"]), "COT DC 26-020 REV 3");
  assert.equal(revisionSiguiente("COT DC 26-109", ["COT DC 26-109 R1", "COT DC 26-109 R2"]), "COT DC 26-109 REV 3");
  assert.equal(revisionSiguiente("COT DC 25-104", ["COT DC 25-104 R1.1"]), "COT DC 25-104 REV 2");
  assert.equal(revisionSiguiente("COT DC 26-211", ["COT DC 26-211", "COT DC 26-212 REV 4"]), "COT DC 26-211 REV 1", "otra cotización no cuenta");
});

test("mismoNumero: misma base y misma revisión", () => {
  assert.ok(mismoNumero("COT DC 26-211 REV 2", "COT DC 26-211 R2"));
  assert.ok(mismoNumero("COT DC 26-211 Rev2", "cot dc 26-211 rev 2"));
  assert.ok(!mismoNumero("COT DC 26-211 REV 2", "COT DC 26-211 REV 1"));
  assert.ok(!mismoNumero("COT DC 26-211 REV 2", "COT DC 26-211"));
  assert.ok(!mismoNumero("26-211", "26-211"));
  assert.equal(reemplazarNumero("COT DC 26-211 - Cantina.pdf", "COT DC 26-211 REV 2"), "COT DC 26-211 REV 2 - Cantina.pdf");
  assert.equal(reemplazarNumero("Cantina.pdf", "COT DC 26-211 REV 2"), null);
});

test("nombre de una revisión en Dropbox: siempre con la revisión exacta", async () => {
  const { nombreEnDropbox } = await import("../src/lib/quotes/subir-pdf");
  const n = "COT DC 26-211 REV 2";
  assert.equal(nombreEnDropbox("COT DC 26-211 REV 2 - Cantina.pdf", n, true), "COT DC 26-211 REV 2 - Cantina.pdf");
  assert.equal(nombreEnDropbox("COT DC 26-211 R2 - Cantina.pdf", n, true), "COT DC 26-211 R2 - Cantina.pdf", "se respeta cómo la escribe el equipo");
  assert.equal(nombreEnDropbox("COT DC 26-211 - Cantina.pdf", n, true), "COT DC 26-211 REV 2 - Cantina.pdf", "sin la REV quedaría como la original");
  assert.equal(nombreEnDropbox("COT DC 26-211 Rev 1 - Cantina.pdf", n, true), "COT DC 26-211 REV 2 - Cantina.pdf");
  assert.equal(nombreEnDropbox("Cantina actualizada.pdf", n, true), "COT DC 26-211 REV 2 - Cantina actualizada.pdf");
});
