import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { renderQuotePdf } from "../src/lib/quotes/pdf";
import type { LetterData } from "../src/lib/quotes/letter";

// El PDF es lo que le llega al cliente. Estas pruebas lo GENERAN de verdad
// (con el membrete real de public/) y miran el resultado: cuántas páginas, y
// que ninguna combinación de renglones lo haga reventar a mitad de camino.

const base: Omit<LetterData, "items"> = {
  fecha: "2026-09-08",
  ubicacion: "Galera 3 y Galera 4",
  tipo: "realizar",
  aplica_itbms: true,
  tasa: 7,
  validez: 30,
  condiciones: "El mantenimiento se factura mensualmente vencido a 30 días.\nProgramación con 5 días hábiles de anticipación.",
  elaborado: "J. Guerra",
};

const item = (n: number, aparte = false) => ({
  cant: 1,
  desc: `Mantenimiento preventivo mensual — Equipo ${n} (${12 * n},000 BTU/h), monofásico, R-410A + condensadora asociada. Tarifa mensual (interior + condensadora).`,
  precio: 10 * n,
  aparte,
});

async function paginas(letter: LetterData): Promise<number> {
  const bytes = await renderQuotePdf({ quoteNumber: "COT DC 26-208", cliente: "Lanco Medical Group", letter });
  assert.ok(bytes.length > 10_000, "el PDF trae el membrete y contenido");
  return (await PDFDocument.load(bytes)).getPageCount();
}

test("una carta corta entra en una página", async () => {
  assert.equal(await paginas({ ...base, items: [item(1), item(2), item(3)] }), 1);
});

test("una carta larga salta de página sin romperse (encabezado repetido en el camino)", async () => {
  const items = Array.from({ length: 30 }, (_, i) => item(i + 1));
  const n = await paginas({ ...base, items });
  assert.ok(n >= 3, `30 renglones largos deberían ocupar 3+ páginas, ocuparon ${n}`);
});

test("el bloque aparte se dibuja después de la oferta, y puede caer en otra página", async () => {
  const items = [...Array.from({ length: 14 }, (_, i) => item(i + 1)), item(90, true), item(91, true), item(92, true)];
  const n = await paginas({ ...base, items });
  assert.ok(n >= 2, `con aparte al final debería pasar de una página, dio ${n}`);
});

test("todos los renglones aparte: total en cero y el PDF igual sale", async () => {
  assert.equal(await paginas({ ...base, items: [item(1, true), item(2, true)] }), 1);
});

test("rótulos reescritos y borrados no rompen el PDF", async () => {
  const n = await paginas({
    ...base,
    items: [item(1), item(2, true)],
    textos: { th_precio: "Tarifa mensual", validez_texto: "", lbl_aparte: "Cargos por evento:", oferta: "" },
  });
  assert.equal(n, 1);
});
