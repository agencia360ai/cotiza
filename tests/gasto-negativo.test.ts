import { test } from "node:test";
import assert from "node:assert/strict";
import { marginOf } from "../src/lib/quickbooks/projects";
import { desglosarPnl, parsePnl } from "../src/lib/quickbooks/parse";
import type { QboToolResult } from "../src/lib/quickbooks/mcp";

// El caso real: seis proyectos con gasto negativo, cinco de ellos exactamente
// −7% del ingreso (la tasa de ITBMS). El board mostraba "Gasto -$647.50" y
// "107% margen" — un margen que no existe.

test("marginOf: un gasto negativo no da margen, da s/d", () => {
  assert.equal(marginOf(9250, -647.5), null, "antes daba 1.07 → 107%");
  assert.equal(marginOf(3075, -12.5), null);
});

test("marginOf: lo normal sigue igual", () => {
  assert.equal(marginOf(1000, 400), 0.6);
  assert.equal(marginOf(1000, 0), 1, "sin gasto cargado el margen es 100%: lo decide la UI, no esto");
  assert.equal(marginOf(1000, 1200), -0.2, "un gasto MAYOR que el ingreso sí es real: pérdida");
  assert.equal(marginOf(null, 400), null);
  assert.equal(marginOf(0, 400), null);
});

// Reporte armado como el que devuelve QBO para DC26-18: ingreso 9,250 y una
// sección de gastos cuyo único movimiento es el ITBMS acreditado (−647.50).
const envolver = (report: unknown): QboToolResult => ({
  content: [{ type: "text", text: `Profit and Loss Report:\n${JSON.stringify(report)}` }],
});

const conItbmsNegativo = envolver({
  Report: {
    Rows: {
      Row: [
        {
          group: "Income",
          Summary: { ColData: [{ value: "Total Income" }, { value: "9250.00" }] },
          Rows: { Row: [{ ColData: [{ value: "Servicios" }, { value: "9250.00" }] }] },
        },
        {
          group: "Expenses",
          Summary: { ColData: [{ value: "Total Expenses" }, { value: "-647.50" }] },
          Rows: {
            Row: [
              { ColData: [{ value: "Materiales" }, { value: "0.00" }] },
              { ColData: [{ value: "ITBMS por pagar" }, { value: "-647.50" }] },
            ],
          },
        },
        { group: "NetIncome", Summary: { ColData: [{ value: "Net Income" }, { value: "9897.50" }] } },
      ],
    },
  },
});

test("parsePnl lee el reporte tal cual viene: gasto negativo incluido", () => {
  // No se corrige acá a propósito: lo que dice QuickBooks es lo que se guarda.
  // La defensa está en marginOf y en cómo lo muestra el board.
  const pnl = parsePnl(conItbmsNegativo);
  assert.equal(pnl?.income, 9250);
  assert.equal(pnl?.cost, -647.5);
});

test("desglosarPnl dice DE QUÉ CUENTA sale el negativo", () => {
  const secciones = desglosarPnl(conItbmsNegativo);
  const gastos = secciones.find((s) => s.grupo === "Expenses");
  assert.ok(gastos, "encuentra la sección de gastos");
  assert.equal(gastos.total, -647.5);
  const culpable = gastos.cuentas.find((c) => c.total < 0);
  assert.equal(culpable?.nombre, "ITBMS por pagar", "esto es lo que hay que corregir en QBO");
  assert.equal(culpable?.total, -647.5);
});

test("desglosarPnl aplana subcuentas anidadas", () => {
  const anidado = envolver({
    Rows: {
      Row: [
        {
          group: "Expenses",
          Summary: { ColData: [{ value: "Total" }, { value: "100.00" }] },
          Rows: {
            Row: [
              {
                ColData: [{ value: "Operativos" }, { value: "100.00" }],
                Rows: { Row: [{ ColData: [{ value: "Combustible" }, { value: "60.00" }] }] },
              },
            ],
          },
        },
      ],
    },
  });
  const nombres = desglosarPnl(anidado)[0].cuentas.map((c) => c.nombre);
  assert.deepEqual(nombres, ["Operativos", "Combustible"]);
});

test("desglosarPnl con basura devuelve vacío en vez de reventar", () => {
  assert.deepEqual(desglosarPnl({ content: [{ type: "text", text: "no hay json acá" }] }), []);
  assert.deepEqual(desglosarPnl({}), []);
});
