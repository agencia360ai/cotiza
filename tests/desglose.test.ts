import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDesglose, parsePnl } from "../src/lib/quickbooks/parse";
import { gastoPorMes, nombreDeCuenta, normalizarDesglose, totalDe, esCosto } from "../src/lib/quickbooks/desglose-core";
import type { HorasProyecto } from "../src/lib/quickbooks/horas-core";

// Misma forma que el ProfitAndLoss que devuelve el gateway con
// summarize_column_by=Month (texto con prefijo + JSON), con montos inventados.
const col = (titulo: string, inicio?: string) => ({
  ColTitle: titulo,
  ColType: inicio ? "Money" : "Account",
  MetaData: inicio ? [{ Name: "StartDate", Value: inicio }] : [{ Name: "ColKey", Value: "account" }],
});
const fila = (nombre: string, ...v: string[]) => ({ ColData: [{ value: nombre, id: "1" }, ...v.map((value) => ({ value }))], type: "Data" });
const resumen = (nombre: string, ...v: string[]) => ({ ColData: [{ value: nombre }, ...v.map((value) => ({ value }))] });
const reporte = {
  Header: { ReportName: "ProfitAndLoss", SummarizeColumnsBy: "Month" },
  Columns: { Column: [col(""), col("Jun 2026", "2026-06-01"), col("Jul 2026", "2026-07-01"), col("Aug 2026", "2026-08-01"), { ColTitle: "Total", ColType: "Money" }] },
  Rows: {
    Row: [
      { group: "Income", type: "Section", Header: resumen("Income", "", "", "", ""), Rows: { Row: [fila("4101 Ventas de Equipos y Accesorios", "", "", "9500.00", "9500.00")] }, Summary: resumen("Total Income", "0.00", "0.00", "9500.00", "9500.00") },
      {
        group: "COGS",
        type: "Section",
        Header: resumen("Cost of Sales", "", "", "", ""),
        Rows: { Row: [fila("5210 Materiales - Proyectos", "3390.00", "58.00", "", "3448.00"), fila("5230 Subcontratistas - Proyectos", "", "", "1672.55", "1672.55")] },
        Summary: resumen("Total Cost of Sales", "3390.00", "58.00", "1672.55", "5120.55"),
      },
      { group: "GrossProfit", type: "Section", Summary: resumen("Gross Profit", "-3390.00", "-58.00", "7827.45", "4379.45") },
      {
        group: "Expenses",
        type: "Section",
        Header: resumen("Expenses", "", "", "", ""),
        Rows: {
          Row: [
            fila("6240 Acarreos y Encomiendas", "", "", "36.50", "36.50"),
            // Cuenta padre con subcuentas: el subtotal del padre no se cuenta.
            {
              type: "Section",
              Header: resumen("6300 Vehículos", "", "", "", ""),
              Rows: { Row: [fila("6310 Combustible", "", "20.00", "", "20.00"), fila("6320 Peajes", "", "", "5.00", "5.00")] },
              Summary: resumen("Total 6300 Vehículos", "", "20.00", "5.00", "25.00"),
            },
            fila("8000 Gasto Temporal", "", "", "(65.00)", "(65.00)"),
            fila("6400 Sin movimiento", "", "", "", ""),
          ],
        },
        Summary: resumen("Total Expenses", "0.00", "20.00", "-23.50", "-3.50"),
      },
      { group: "NetIncome", type: "Section", Summary: resumen("Net Earnings", "-3390.00", "-78.00", "7851.00", "4383.00") },
    ],
  },
};
const respuesta = { content: [{ type: "text", text: `Profit and Loss Report:${JSON.stringify(reporte)}` }] };

test("el desglose por cuenta sale con sus totales y sus meses", () => {
  const d = parseDesglose(respuesta)!;
  assert.deepEqual(d.map((s) => [s.tipo, s.total]), [["ingreso", 9500], ["costo_venta", 5120.55], ["gasto", -3.5]]);
  assert.deepEqual(d[0].cuentas, [{ nombre: "4101 Ventas de Equipos y Accesorios", total: 9500, meses: { "2026-08-01": 9500 } }]);
  assert.deepEqual(d[1].cuentas[0], { nombre: "5210 Materiales - Proyectos", total: 3448, meses: { "2026-06-01": 3390, "2026-07-01": 58 } });
  const gastos = d[2].cuentas.map((c) => [c.nombre, c.total]);
  assert.deepEqual(
    gastos,
    [["8000 Gasto Temporal", -65], ["6240 Acarreos y Encomiendas", 36.5], ["6310 Combustible", 20], ["6320 Peajes", 5]],
    "las subcuentas cuentan una vez, sin el subtotal del padre; el negativo queda; las sin movimiento no",
  );
});

test("el refactor no cambió los totales ni los meses del P&L", () => {
  const p = parsePnl(respuesta)!;
  assert.equal(p.income, 9500);
  assert.equal(Math.round(p.cost * 100) / 100, 5117.05);
  assert.deepEqual(p.meses.map((m) => [m.month, m.income, Math.round(m.cost * 100) / 100]), [
    ["2026-06-01", 0, 3390],
    ["2026-07-01", 0, 78],
    ["2026-08-01", 9500, 1649.05],
  ]);
});

test("sin respuesta legible no hay desglose", () => {
  assert.equal(parseDesglose({ content: [{ type: "text", text: "Error: gateway" }] }), null);
});

const horas: HorasProyecto = {
  costo: 300,
  horas: 50,
  sinTarifa: 0,
  meses: [{ month: "2026-07-01", costo: 120 }, { month: "2026-09-01", costo: 180 }],
  tecnicos: [{ nombre: "Técnico A", horas: 50, costo: 300 }],
};

test("gasto por mes: costo de venta, gastos y horas, en orden y sin meses vacíos", () => {
  const d = { desde: "2025-01-01", actualizado: "2026-10-24T00:00:00Z", secciones: parseDesglose(respuesta)! };
  const m = gastoPorMes(d, horas, []);
  assert.deepEqual(m, [
    { month: "2026-06-01", costo_venta: 3390, gasto: 0, contable: 0, horas: 0 },
    { month: "2026-07-01", costo_venta: 58, gasto: 20, contable: 0, horas: 120 },
    { month: "2026-08-01", costo_venta: 1672.55, gasto: -23.5, contable: 0, horas: 0 },
    { month: "2026-09-01", costo_venta: 0, gasto: 0, contable: 0, horas: 180 },
  ]);
  assert.equal(totalDe(d, esCosto), 5117.05);
});

test("sin desglose por mes queda el gasto contable de cada mes", () => {
  const m = gastoPorMes(null, null, [
    { month: "2026-05-01", income: 0, cost: 400 },
    { month: "2026-06-01", income: 900, cost: 0 },
  ]);
  assert.deepEqual(m, [{ month: "2026-05-01", costo_venta: 0, gasto: 0, contable: 400, horas: 0 }]);
});

test("nombres de cuenta sin el número contable", () => {
  assert.equal(nombreDeCuenta("4101 Ventas de Equipos y Accesorios"), "Ventas de Equipos y Accesorios");
  assert.equal(nombreDeCuenta("5100.1 Equipos"), "Equipos");
  assert.equal(nombreDeCuenta("Acarreos y Encomiendas"), "Acarreos y Encomiendas");
  assert.equal(nombreDeCuenta("2026"), "2026");
});

test("lo guardado en la base se valida antes de usarlo", () => {
  assert.equal(normalizarDesglose(null), null);
  assert.equal(normalizarDesglose({ secciones: [] }), null);
  const d = normalizarDesglose({
    desde: "2025-01-01",
    actualizado: "2026-10-24T00:00:00Z",
    secciones: [
      { tipo: "ingreso", total: 10, cuentas: [{ nombre: "Ventas", total: 10, meses: { "2026-08-01": 10, malo: "x" } }] },
      { tipo: "inventado", total: 5, cuentas: [] },
    ],
  });
  assert.deepEqual(d, {
    desde: "2025-01-01",
    actualizado: "2026-10-24T00:00:00Z",
    secciones: [{ tipo: "ingreso", total: 10, cuentas: [{ nombre: "Ventas", total: 10, meses: { "2026-08-01": 10 } }] }],
  });
});
