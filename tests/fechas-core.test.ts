import { test } from "node:test";
import assert from "node:assert/strict";
import { comoFecha, cosecharFechas, fusionar, type RangoTxn } from "../src/lib/quickbooks/fechas-core";
import { desenvolver } from "../src/lib/quickbooks/cobrado-core";

const conocidos = new Set(["215", "233", "398"]);
const cosechar = (raw: unknown) => {
  const m = new Map<string, RangoTxn>();
  cosecharFechas(raw, m, conocidos);
  return m;
};

test("comoFecha: prefijo de fecha, con y sin hora; rechaza basura y años imposibles", () => {
  assert.equal(comoFecha("2026-03-14"), "2026-03-14");
  assert.equal(comoFecha("2026-03-14T10:22:00-05:00"), "2026-03-14");
  assert.equal(comoFecha("marzo"), null);
  assert.equal(comoFecha(20260314), null);
  assert.equal(comoFecha("1899-01-01"), null);
  assert.equal(comoFecha("2199-01-01"), null);
});

const facturas = {
  QueryResponse: {
    Invoice: [
      { Id: "1", TxnDate: "2026-03-14", CustomerRef: { value: "215" } },
      { Id: "2", TxnDate: "2026-07-02", CustomerRef: { value: "215" } },
      { Id: "3", TxnDate: "2026-05-20", CustomerRef: { value: "233" } },
      { Id: "4", TxnDate: "2026-01-05", CustomerRef: { value: "999" } },
    ],
  },
};

test("factura: rango por proyecto, ignora clientes desconocidos", () => {
  const f = cosechar(facturas);
  assert.deepEqual(f.get("215"), { primera: "2026-03-14", ultima: "2026-07-02" });
  assert.deepEqual(f.get("233"), { primera: "2026-05-20", ultima: "2026-05-20" });
  assert.equal(f.has("999"), false);
});

test("compra: el CustomerRef cuelga de las líneas y una compra toca dos proyectos", () => {
  const compras = {
    QueryResponse: {
      Purchase: [
        {
          Id: "50",
          TxnDate: "2026-02-01",
          EntityRef: { value: "77", type: "Vendor" },
          Line: [
            { Amount: 300, AccountBasedExpenseLineDetail: { CustomerRef: { value: "215" } } },
            { Amount: 200, AccountBasedExpenseLineDetail: { CustomerRef: { value: "233" } } },
          ],
        },
      ],
    },
  };
  const c = cosechar(compras);
  assert.equal(c.get("215")?.primera, "2026-02-01");
  assert.equal(c.get("233")?.primera, "2026-02-01");
});

test("fusionar: la compra de febrero adelanta el inicio frente a la factura de marzo", () => {
  const total = new Map<string, RangoTxn>();
  fusionar(total, cosechar(facturas));
  fusionar(total, new Map([["215", { primera: "2026-02-01", ultima: "2026-02-01" }]]));
  assert.deepEqual(total.get("215"), { primera: "2026-02-01", ultima: "2026-07-02" });
});

test("envoltorio MCP: el reporte llega como string dentro de content[]", () => {
  // Es exactamente lo que nos hizo fallar dos veces con el cobrado.
  const envuelto = {
    content: [
      { type: "text", text: "Invoices:" },
      { type: "text", text: `Resultado: ${JSON.stringify(facturas)}` },
    ],
  };
  const e = new Map<string, RangoTxn>();
  for (const nodo of desenvolver(envuelto)) cosecharFechas(nodo, e, conocidos);
  assert.equal(e.get("215")?.ultima, "2026-07-02");
});

test("formas planas: snake_case y camelCase", () => {
  const p = cosechar([
    { txn_date: "2026-04-09", customer_id: "398" },
    { date: "2026-06-30", customerId: "398" },
  ]);
  assert.deepEqual(p.get("398"), { primera: "2026-04-09", ultima: "2026-06-30" });
});

test("basura: no inventa nada", () => {
  assert.equal(cosechar({}).size, 0);
  assert.equal(cosechar(null).size, 0);
  assert.equal(cosechar({ QueryResponse: { Invoice: [{ CustomerRef: { value: "215" } }] } }).size, 0, "sin fecha");
  assert.equal(cosechar({ QueryResponse: { Invoice: [{ TxnDate: "2026-03-01" }] } }).size, 0, "sin cliente");
});
