import { test } from "node:test";
import assert from "node:assert/strict";
import { marginOf } from "../src/lib/quickbooks/projects";
import { desglosarPnl, parsePnl } from "../src/lib/quickbooks/parse";
import type { QboToolResult } from "../src/lib/quickbooks/mcp";

// El caso real: seis proyectos con gasto negativo, cinco de ellos exactamente
// −7% del ingreso (la tasa de ITBMS). El board mostraba "Gasto -$647.50" y
// "107% margen" — un margen que no existe.
//
// #217 diagnosticó la causa pero dejó pasar el número: no se podía ver el
// reporte real (token del gateway vencido) y no se quiso adivinar el filtro.
// Ya se leyó: la cuenta es "VAT Expense" (AccountSubType GlobalTaxExpense) y el
// P&L de DS26-42 la trae en −223.65 dentro de Expenses. Así que ahora parsePnl
// SÍ la aparta, a `tax`. Las defensas de marginOf y del board se quedan igual:
// son la red por si aparece un negativo que no sea impuesto.

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

test("parsePnl aparta el ITBMS: no es gasto del proyecto", () => {
  const pnl = parsePnl(conItbmsNegativo);
  assert.equal(pnl?.income, 9250, "el ingreso no se toca");
  assert.equal(pnl?.cost, 0, "antes daba -647.50 y de ahí salía el margen de 107%");
  assert.equal(pnl?.tax, 647.5, "se guarda POSITIVO: es lo recaudado al cliente");
  assert.equal(marginOf(pnl!.income, pnl!.cost), 1, "sin costos cargados el margen es 100%, no 107%");
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

// ── Reportes REALES leídos del gateway de Dicec el 16-sep-2026 ───────────────

// DM26-32 (Nestlé, project 292): costos de verdad 202.75 MÁS el ITBMS −215.25.
// El parser viejo los sumaba y daba −12.50, que es lo que se veía en el board.
const dm2632 = envolver({
  Report: {
    Rows: {
      Row: [
        {
          group: "Income",
          Summary: { ColData: [{ value: "Total Income" }, { value: "3075.00" }] },
          Rows: { Row: [{ ColData: [{ value: "4301 Ingresos por Servicios" }, { value: "3075.00" }] }] },
        },
        {
          group: "COGS",
          Summary: { ColData: [{ value: "Total Cost of Sales" }, { value: "202.75" }] },
          Rows: {
            Row: [
              { ColData: [{ value: "5220 Mano de Obra Directa - Proyectos" }, { value: "40.00" }] },
              { ColData: [{ value: "5230 Subcontratistas - Proyectos" }, { value: "40.00" }] },
              { ColData: [{ value: "5310 Materiales y Repuestos - Servicios" }, { value: "19.49" }] },
              { ColData: [{ value: "5320 Mano de Obra Directa - Servicios" }, { value: "103.26" }] },
            ],
          },
        },
        {
          group: "Expenses",
          Summary: { ColData: [{ value: "Total Expenses" }, { value: "-215.25" }] },
          Rows: { Row: [{ ColData: [{ value: "VAT Expense" }, { value: "-215.25" }] }] },
        },
        { group: "NetIncome", Summary: { ColData: [{ value: "Net Earnings" }, { value: "3087.50" }] } },
      ],
    },
  },
});

test("DM26-32: los costos reales dejan de quedar tapados por el ITBMS", () => {
  const pnl = parsePnl(dm2632);
  assert.equal(pnl?.income, 3075);
  assert.equal(pnl?.cost, 202.75, "antes daba -12.50 (202.75 - 215.25)");
  assert.equal(pnl?.tax, 215.25);
  assert.equal(Math.round(marginOf(3075, pnl!.cost)! * 1000) / 10, 93.4);
});

test("un proyecto cuyo ÚNICO gasto era el ITBMS no cae al fallback income - net", () => {
  // Sin la guardia, `cost = income - net` reinyecta el impuesto: 9250 - 9897.50.
  const pnl = parsePnl(conItbmsNegativo);
  assert.ok(pnl!.cost >= 0, "el fallback habría devuelto -647.50 otra vez");
});

test("los impuestos que SÍ son gasto de Dicec siguen contando", () => {
  const conImpuestosReales = envolver({
    Report: {
      Rows: {
        Row: [
          {
            group: "Income",
            Summary: { ColData: [{ value: "Total Income" }, { value: "1000.00" }] },
            Rows: { Row: [{ ColData: [{ value: "4201 Ingresos" }, { value: "1000.00" }] }] },
          },
          {
            group: "Expenses",
            Summary: { ColData: [{ value: "Total Expenses" }, { value: "442.00" }] },
            Rows: {
              Row: [
                { ColData: [{ value: "6234 Impuesto Municipal" }, { value: "212.00" }] },
                { ColData: [{ value: "6236 Tasa Única" }, { value: "300.00" }] },
                { ColData: [{ value: "9103 Gasto de Impuesto sobre la Renta" }, { value: "70.00" }] },
                { ColData: [{ value: "VAT Expense" }, { value: "-140.00" }] },
              ],
            },
          },
        ],
      },
    },
  });
  const pnl = parsePnl(conImpuestosReales);
  assert.equal(pnl?.cost, 582, "212 + 300 + 70: son gastos reales, no recaudación");
  assert.equal(pnl?.tax, 140, "solo el ITBMS se aparta");
});
