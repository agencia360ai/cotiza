import { test } from "node:test";
import assert from "node:assert/strict";
import { anioDeNumero, correlativo, formatoNumero, mayor, numeroBase, numeroEnTexto } from "../src/lib/quotes/numeracion";

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
