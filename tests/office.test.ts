import { test } from "node:test";
import assert from "node:assert/strict";
import { docxATexto, xlsxATexto } from "../src/lib/office/texto";
import { zip } from "./helpers/zip";

const documentXml = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>
<w:p><w:r><w:t>Cotización para Esa Flaca Rica &amp; Cía</w:t></w:r></w:p>
<w:p><w:r><w:t>Reemplazo de compresor</w:t></w:r><w:r><w:br/><w:t>Incluye mano de obra</w:t></w:r></w:p>
<w:tbl>
<w:tr><w:tc><w:p><w:r><w:t>Cant</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Desc</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Precio</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Compresor Copeland 5HP</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>2850.00</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>
<w:p><w:r><w:t>Validez</w:t></w:r><w:r><w:tab/><w:t>15 días</w:t></w:r></w:p>
</w:body></w:document>`;

const docx = () => zip([{ name: "[Content_Types].xml", data: "<Types/>" }, { name: "word/document.xml", data: documentXml }]);

test("docx: acentos, entidades y saltos", async () => {
  const t = await docxATexto(docx());
  assert.ok(t.includes("Cotización para Esa Flaca Rica & Cía"));
  assert.ok(t.includes("Reemplazo de compresor\nIncluye mano de obra"), "<w:br/> es salto");
  assert.ok(t.includes("Validez\t15 días"), "<w:tab/> es tabulación");
  assert.doesNotMatch(t, /[<>]/, "no quedan etiquetas");
});

test("docx: la tabla queda en filas, no en una columna", async () => {
  // Word mete un <w:p> dentro de cada celda; sin tratar las celdas aparte, cada
  // celda salía en su propia línea y no se sabía qué precio era de qué renglón.
  const t = await docxATexto(docx());
  assert.match(t, /Cant\tDesc\tPrecio/);
  assert.match(t, /1\tCompresor Copeland 5HP\t2850\.00/);
});

test("docx sin document.xml avisa", async () => {
  await assert.rejects(docxATexto(zip([{ name: "otro.xml", data: "<a/>" }])), /word\/document\.xml/);
});

test("un archivo que no es ZIP avisa en vez de reventar", async () => {
  const basura = new TextEncoder().encode("no soy un zip, soy basura cualquiera").buffer as ArrayBuffer;
  await assert.rejects(docxATexto(basura), /ZIP/);
});

const xlsx = () =>
  zip([
    { name: "xl/sharedStrings.xml", data: "<sst><si><t>Descripción</t></si><si><t>Cantidad</t></si><si><t>Compresor 5HP</t></si><si><t>Válvula</t></si></sst>" },
    {
      name: "xl/worksheets/sheet1.xml",
      data: `<worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>Precio</t></is></c></row>
<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1</v></c><c r="C2"><v>2850</v></c></row>
<row r="3"><c r="A3" t="s"><v>3</v></c><c r="C3"><v>120.5</v></c></row>
</sheetData></worksheet>`,
    },
  ]);

test("xlsx: sharedStrings, inlineStr y números", async () => {
  const x = await xlsxATexto(xlsx());
  assert.ok(x.includes("Descripción\tCantidad\tPrecio"));
  assert.ok(x.includes("Compresor 5HP\t1\t2850"));
});

test("xlsx: una celda vacía no corre las columnas", async () => {
  // La fila 3 no tiene B: el 120.5 tiene que quedar en la TERCERA columna, o el
  // precio termina debajo de "cantidad".
  const x = await xlsxATexto(xlsx());
  assert.ok(x.includes("Válvula\t\t120.5"), x);
});

test("xlsx sin hojas avisa", async () => {
  await assert.rejects(xlsxATexto(zip([{ name: "xl/sharedStrings.xml", data: "<sst/>" }])), /hojas/);
});
