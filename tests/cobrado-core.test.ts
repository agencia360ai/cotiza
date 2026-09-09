import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularCobrado, cosechar, desenvolver, valorNumerico } from "../src/lib/quickbooks/cobrado-core";

// Estas tres funciones fueron la fuente de tres bugs seguidos ("s/d" en los 86
// proyectos, 8% de cobrado, reporte como string). Cada caso de acá es uno de
// esos bugs, para que no vuelvan.

test("valorNumerico: formatos contables de QuickBooks", () => {
  assert.equal(valorNumerico("1,500.00"), 1500);
  assert.equal(valorNumerico("$1,000"), 1000);
  assert.equal(valorNumerico("(200.00)"), -200, "paréntesis = negativo");
  assert.equal(valorNumerico(""), null);
  assert.equal(valorNumerico("abc"), null);
  assert.equal(valorNumerico(42), 42);
  assert.equal(valorNumerico(NaN), null);
});

const reporte = {
  Rows: {
    Row: [
      { ColData: [{ value: "Cliente A", id: "215" }, { value: "100.00" }, { value: "50.00" }, { value: "150.00" }] },
      { ColData: [{ value: "Cliente B", id: "233" }, { value: "0.00" }, { value: "" }, { value: "0.00" }] },
      { ColData: [{ value: "Otro", id: "999" }, { value: "9,999.00" }] },
    ],
  },
};

test("cosechar: forma nativa de los reportes (ColData), el total es la ÚLTIMA celda", () => {
  const out = new Map<string, number>();
  cosechar(reporte, out, new Set(["215", "233"]));
  assert.equal(out.get("215"), 150, "no suma los tramos de antigüedad: toma el total");
  assert.equal(out.get("233"), 0);
  assert.equal(out.has("999"), false, "solo proyectos conocidos");
});

test("desenvolver: el reporte viene como string con prefijo dentro del envoltorio MCP", () => {
  const raw = {
    content: [
      { type: "text", text: "Aged Receivables Report:" },
      { type: "text", text: `Report: ${JSON.stringify(reporte)}` },
    ],
  };
  const out = new Map<string, number>();
  for (const nodo of desenvolver(raw)) cosechar(nodo, out, new Set(["215"]));
  assert.equal(out.get("215"), 150);
});

test("cosechar: fallback para gateways que devuelven filas planas", () => {
  const out = new Map<string, number>();
  cosechar([{ customer_id: "215", balance: "75.50" }], out, new Set(["215"]));
  assert.equal(out.get("215"), 75.5);
});

test("calcularCobrado: facturado − pendiente, acotado a [0, facturado]", () => {
  assert.equal(calcularCobrado(1000, 300), 700);
  assert.equal(calcularCobrado(1000, 1500), 0, "anticipo/factura vieja no da negativo");
  assert.equal(calcularCobrado(1000, -50), 1000, "un pendiente negativo no da más que el total");
  assert.equal(calcularCobrado(null, 100), null);
});

test("calcularCobrado: ausente en el reporte = pagado, SOLO si el reporte se leyó bien", () => {
  // Un cliente sin saldo no aparece en el aging. Sin esto, 35 proyectos ya
  // cobrados quedaban en "s/d" para siempre.
  assert.equal(calcularCobrado(1000, undefined, true), 1000);
  assert.equal(calcularCobrado(1000, undefined, false), null, "sin lectura exitosa, la ausencia no significa nada");
});
