import { test } from "node:test";
import assert from "node:assert/strict";
import { agruparCobros, cobrosEnRango, normalizarCobros } from "../src/lib/quickbooks/cobros-core";
import { agruparEstimados, esPorFacturar } from "../src/lib/quickbooks/estimados-core";

const HOY = "2026-11-13";
const fac = (id: string, cliente: string, fecha: string, total: number, saldo: number, numero = `00${id}`, impuesto = 0) => ({
  Id: id,
  DocNumber: numero,
  TxnDate: fecha,
  TotalAmt: total,
  Balance: saldo,
  CustomerRef: { value: cliente },
  TxnTaxDetail: { TotalTax: impuesto },
});
const conocidos = new Set(["271", "454", "355"]);

test("cobrado = lo pagado de cada factura (total − saldo), con ITBMS, por mes de la factura", () => {
  const c = agruparCobros(
    [
      fac("1", "271", "2026-03-12", 518.95, 0, "0000000017", 33.95),
      fac("2", "271", "2026-03-18", 485, 0),
      fac("3", "355", "2026-07-30", 11700, 11700),
      fac("4", "454", "2026-11-02", 9600, 0),
      fac("5", "454", "2026-11-02", 9600, 9600),
    ],
    [],
    conocidos,
    HOY,
  );
  assert.deepEqual(c.get("271"), [{ month: "2026-03-01", facturado: 1003.95, cobrado: 1003.95 }]);
  assert.deepEqual(c.get("355"), [{ month: "2026-07-01", facturado: 11700, cobrado: 0 }], "sin pago registrado: todo por cobrar");
  assert.deepEqual(c.get("454"), [{ month: "2026-11-01", facturado: 19200, cobrado: 9600 }]);
});

test("las EST y las fechadas a futuro (P26) no van al cobrado: son por facturar", () => {
  const c = agruparCobros(
    [fac("6", "271", "2026-12-01", 3535, 0, "P26-024"), fac("7", "271", "2026-12-01", 48200, 48200, "ESTDC26-23"), fac("8", "271", "2026-05-14", 85.6, 0)],
    [],
    conocidos,
    HOY,
  );
  assert.deepEqual(c.get("271"), [{ month: "2026-05-01", facturado: 85.6, cobrado: 85.6 }]);
});

test("un recibo de venta entra cobrado entero; proyectos ajenos y duplicados no suman", () => {
  const c = agruparCobros(
    [fac("9", "999", "2026-04-01", 500, 0), fac("10", "355", "2026-04-01", 100, 40), fac("10", "355", "2026-04-01", 100, 40)],
    [{ Id: "r1", TxnDate: "2026-04-20", TotalAmt: 250, CustomerRef: { value: "355" } }],
    conocidos,
    HOY,
  );
  assert.equal(c.has("999"), false);
  assert.deepEqual(c.get("355"), [{ month: "2026-04-01", facturado: 350, cobrado: 310 }]);
});

test("cobrosEnRango suma solo los meses del rango", () => {
  const cobros = [
    { month: "2025-12-01", facturado: 1000, cobrado: 1000 },
    { month: "2026-03-01", facturado: 500, cobrado: 200 },
  ];
  assert.deepEqual(cobrosEnRango(cobros, (m) => (m >= "2026-01-01" ? 1 : 0)), { facturado: 500, cobrado: 200 });
  assert.deepEqual(cobrosEnRango(cobros, () => 1), { facturado: 1500, cobrado: 1200 });
});

test("normalizarCobros: null es 'sin dato'; filas raras se descartan", () => {
  assert.equal(normalizarCobros(null), null);
  assert.deepEqual(normalizarCobros([{ month: "2026-03-01", facturado: "10", cobrado: 5 }, { month: "marzo" }, 3]), [
    { month: "2026-03-01", facturado: 10, cobrado: 5 },
  ]);
});

test("por facturar: EST siempre, y cualquier factura fechada después de hoy", () => {
  assert.equal(esPorFacturar({ DocNumber: "ESTDC26-23", TxnDate: "2026-03-01" }, HOY), true);
  assert.equal(esPorFacturar({ DocNumber: "P26-024", TxnDate: "2026-12-01" }, HOY), true);
  assert.equal(esPorFacturar({ DocNumber: "P26-024", TxnDate: "2026-12-01" }), false, "sin hoy, solo EST");
  assert.equal(esPorFacturar({ DocNumber: "0000000210", TxnDate: "2026-11-02" }, HOY), false);
  const pf = agruparEstimados([fac("6", "271", "2026-12-01", 3535, 0, "P26-024"), fac("8", "271", "2026-05-14", 85.6, 0)], HOY);
  assert.deepEqual(pf.get("271"), {
    neto: 3535,
    cobrado: 3535,
    docs: [{ numero: "P26-024", fecha: "2026-12-01", neto: 3535, total: 3535, cobrado: 3535, cuentas: [] }],
  });
});
