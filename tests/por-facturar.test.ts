import { test } from "node:test";
import assert from "node:assert/strict";
import { agruparEstimados, esEstimado, normalizarPorFacturar, sinEstimados } from "../src/lib/quickbooks/estimados-core";
import { extractEntities } from "../src/lib/quickbooks/parse";

// Como las devuelve search_invoices (montos inventados).
const linea = (monto: number, cuenta = "4201 Ingresos por Contratos y Proyectos") => ({
  Amount: monto,
  DetailType: "SalesItemLineDetail",
  SalesItemLineDetail: { ItemAccountRef: { value: "136", name: cuenta } },
});
const sub = (monto: number) => ({ Amount: monto, DetailType: "SubTotalLineDetail", SubTotalLineDetail: {} });
const factura = (o: Record<string, unknown>) => ({ CustomerRef: { value: "443", name: "DC26-23" }, TxnDate: "2026-12-01", ...o });
const facturas = [
  factura({ Id: "1", DocNumber: "ESTDC26-23", Line: [linea(48200), sub(48200)], TotalAmt: 48200, TxnTaxDetail: { TotalTax: 0 }, Balance: 48200 }),
  // Con ITBMS y anticipos aplicados.
  factura({ Id: "2", DocNumber: "ESTDC26-14", CustomerRef: { value: "399" }, Line: [linea(56835), sub(56835)], TotalAmt: 60813.45, TxnTaxDetail: { TotalTax: 3978.45 }, Balance: 40813.45 }),
  // ITBMS incluido en el precio.
  factura({ Id: "3", DocNumber: "Est05", CustomerRef: { value: "262" }, Line: [linea(17940), sub(17940)], TotalAmt: 19195.8, TxnTaxDetail: { TotalTax: 1255.8 }, Balance: 14930.06 }),
  factura({ Id: "4", DocNumber: "EST DS26-01", CustomerRef: { value: "201" }, Line: [linea(1832)], TotalAmt: 1832, TxnTaxDetail: { TotalTax: 0 }, Balance: 1832 }),
  // Normales: no son EST aunque tengan "est" adentro.
  factura({ Id: "5", DocNumber: "1043", Line: [linea(500)], TotalAmt: 535, TxnTaxDetail: { TotalTax: 35 }, Balance: 0 }),
  factura({ Id: "6", DocNumber: "TEST-9", Line: [linea(10)], TotalAmt: 10, Balance: 10 }),
  // Repetida (el gateway a veces manda el mismo objeto dos veces).
  factura({ Id: "1", DocNumber: "ESTDC26-23", Line: [linea(48200)], TotalAmt: 48200, Balance: 48200 }),
];

test("solo las que empiezan con EST, se escriban como se escriban", () => {
  for (const n of ["ESTDC26-23", "EST DS26-01", "Est06", "EST.", "est-1"]) assert.ok(esEstimado(n), n);
  for (const n of ["1043", "TEST-9", "DC-EST", "", null]) assert.ok(!esEstimado(n), String(n));
});

test("se agrupan por proyecto, sin ITBMS, con lo ya cobrado de anticipo", () => {
  const m = agruparEstimados(facturas);
  assert.deepEqual([...m.keys()].sort(), ["201", "262", "399", "443"]);
  assert.deepEqual(m.get("443"), {
    neto: 48200,
    cobrado: 0,
    docs: [{ numero: "ESTDC26-23", fecha: "2026-12-01", neto: 48200, total: 48200, cobrado: 0, cuentas: [{ cuenta: "4201 Ingresos por Contratos y Proyectos", monto: 48200 }] }],
  });
  assert.equal(m.get("399")!.neto, 56835, "sin ITBMS, como el ingreso contable");
  assert.equal(m.get("399")!.cobrado, 20000, "60,813.45 − saldo 40,813.45");
  assert.equal(m.get("262")!.neto, 17940, "ITBMS incluido: igual se saca");
  assert.equal(m.get("262")!.cobrado, 4265.74);
});

test("lee la respuesta real del gateway (texto con los objetos pegados)", () => {
  const texto = "Found 2 invoices" + JSON.stringify(facturas[0]) + JSON.stringify(facturas[4]);
  const m = agruparEstimados(extractEntities({ content: [{ type: "text", text: texto }] }, "Invoice"));
  assert.deepEqual([...m.keys()], ["443"]);
});

test("una EST dentro de la ventana leída se saca del facturado, del mes y de la cuenta", () => {
  const pf = agruparEstimados([
    factura({ Id: "9", DocNumber: "ESTDC26-23", TxnDate: "2026-12-01", Line: [linea(1000)], TotalAmt: 1000, Balance: 1000 }),
  ]).get("443");
  const pnl = {
    income: 1500,
    cost: 300,
    meses: [{ month: "2026-11-01", income: 500, cost: 300 }, { month: "2026-12-01", income: 1000, cost: 0 }],
    desglose: [{ tipo: "ingreso" as const, total: 1500, cuentas: [{ nombre: "4201 Ingresos por Contratos y Proyectos", total: 1500, meses: { "2026-11-01": 500, "2026-12-01": 1000 } }] }],
  };
  const hoy = sinEstimados(pnl, pf, "2025-01-01", "2026-11-11");
  assert.equal(hoy, pnl, "todavía fuera de la ventana: no se toca nada");
  const despues = sinEstimados(pnl, pf, "2025-01-01", "2026-12-15");
  assert.equal(despues.income, 500);
  assert.deepEqual(despues.meses[1], { month: "2026-12-01", income: 0, cost: 0 });
  assert.equal(despues.desglose![0].total, 500);
  assert.deepEqual(despues.desglose![0].cuentas[0].meses, { "2026-11-01": 500, "2026-12-01": 0 });
  assert.equal(pnl.income, 1500, "no modifica el original");
});

test("lo guardado en la base se valida", () => {
  assert.equal(normalizarPorFacturar(null), null);
  assert.equal(normalizarPorFacturar({ docs: [] }), null);
  const pf = normalizarPorFacturar({ docs: [{ numero: "ESTDC26-23", fecha: "2026-12-01", neto: 100, total: 107, cobrado: 7 }, { numero: 5 }] });
  assert.deepEqual(pf, { neto: 100, cobrado: 7, docs: [{ numero: "ESTDC26-23", fecha: "2026-12-01", neto: 100, total: 107, cobrado: 7, cuentas: [] }] });
});

