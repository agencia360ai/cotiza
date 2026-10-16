import { test } from "node:test";
import assert from "node:assert/strict";
import { agruparHoras, extraerRegistros, gastoConHoras, horasEnRango, normalizarHoras } from "../src/lib/quickbooks/horas-core";
import { margenDe } from "../src/lib/quickbooks/projects";

// Forma real de un registro de Time Activity, tal como lo devuelve el gateway.
const registro = (id: string, fecha: string, quien: string, horas: number, tarifa: number, proyecto = "233") => ({
  TxnDate: fecha,
  NameOf: "Employee",
  EmployeeRef: { value: quien === "Luis Fenton" ? "237" : "238", name: quien },
  CustomerRef: { value: proyecto, name: "DC26-05 ACESCO - Instalación de torres de enfriamiento" },
  ItemRef: { value: "2", name: "Hours" },
  BillableStatus: "Billable",
  HourlyRate: tarifa,
  CostRate: tarifa,
  Hours: horas,
  Minutes: 0,
  Id: id,
});

// Como llega del MCP: un texto suelto y el JSON de la lista en otro texto.
const sobre = (lista: unknown[]) => ({
  content: [
    { type: "text", text: `Found ${lista.length} time activity(ies):` },
    { type: "text", text: JSON.stringify(lista) },
  ],
});

test("lee la lista aunque venga como texto, después de una línea de encabezado", () => {
  const r = extraerRegistros(sobre([registro("1", "2026-05-19", "Luis Fenton", 8, 7), registro("2", "2026-05-20", "Alex Martinez", 8, 7)]));
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { proyecto: "233", fecha: "2026-05-19", horas: 8, tarifa: 7, nombre: "Luis Fenton" });
});

test("el mismo registro en texto y estructurado se cuenta una vez", () => {
  const lista = [registro("1", "2026-05-19", "Luis Fenton", 8, 7)];
  assert.equal(extraerRegistros({ ...sobre(lista), structuredContent: { items: lista } }).length, 1);
});

test("costo = horas × tarifa de costo; sin tarifa no suma pero se cuenta aparte (como en QuickBooks)", () => {
  const h = agruparHoras(
    extraerRegistros(
      sobre([
        registro("1", "2026-05-19", "Luis Fenton", 8, 7),
        registro("2", "2026-05-20", "Luis Fenton", 8, 0),
        registro("3", "2026-06-02", "Alex Martinez", 4, 7),
        registro("4", "2026-06-02", "Otro", 3, 7, "999"),
      ]),
    ),
  );
  const acesco = h.get("233")!;
  assert.equal(acesco.costo, 84);
  assert.equal(acesco.horas, 20);
  assert.equal(acesco.sinTarifa, 8);
  assert.deepEqual(acesco.meses, [
    { month: "2026-05-01", costo: 56 },
    { month: "2026-06-01", costo: 28 },
  ]);
  assert.deepEqual(acesco.tecnicos, [
    { nombre: "Luis Fenton", horas: 16, costo: 56 },
    { nombre: "Alex Martinez", horas: 4, costo: 28 },
  ]);
  assert.equal(h.get("999")!.costo, 21, "cada proyecto por su lado");
});

test("registros con entrada/salida: se descuenta el descanso", () => {
  const r = extraerRegistros([
    {
      TxnDate: "2026-07-01",
      CustomerRef: { value: "233" },
      EmployeeRef: { value: "237", name: "Luis Fenton" },
      StartTime: "2026-07-01T08:00:00-05:00",
      EndTime: "2026-07-01T17:00:00-05:00",
      BreakHours: 1,
      CostRate: 7,
      Id: "9",
    },
  ]);
  assert.equal(r[0].horas, 8);
  assert.equal(agruparHoras(r).get("233")!.costo, 56);
});

test("normalizarHoras: lo guardado vuelve igual y la basura no pasa", () => {
  const h = agruparHoras(extraerRegistros(sobre([registro("1", "2026-05-19", "Luis Fenton", 8, 7)]))).get("233")!;
  assert.deepEqual(normalizarHoras(JSON.parse(JSON.stringify(h))), h);
  assert.equal(normalizarHoras(null), null);
  assert.equal(normalizarHoras({ costo: "3640" }), null);
});

test("ACESCO cuadra con QuickBooks: 14,150.05 contable + 3,640 en horas = 17,790.05 y margen 22.7%", () => {
  const horas = { costo: 3640, horas: 608, sinTarifa: 88, meses: [], tecnicos: [] };
  assert.equal(gastoConHoras(14150.05, horas), 17790.05);
  assert.equal(Math.round(margenDe(23010, 14150.05, horas)! * 1000) / 10, 22.7);
});

test("sin dato contable no hay gasto, y un contable negativo sigue siendo s/d aunque las horas lo tapen", () => {
  const horas = { costo: 500, horas: 70, sinTarifa: 0, meses: [], tecnicos: [] };
  assert.equal(gastoConHoras(null, horas), null);
  assert.equal(gastoConHoras(1000, null), 1000);
  assert.equal(margenDe(10000, -215.25, horas), null);
});

test("horasEnRango: las horas van al mes en que se trabajaron", () => {
  const horas = {
    costo: 300,
    horas: 40,
    sinTarifa: 0,
    meses: [
      { month: "2026-05-01", costo: 100 },
      { month: "2026-07-01", costo: 200 },
    ],
    tecnicos: [],
  };
  assert.equal(horasEnRango(horas, null), 300);
  assert.equal(horasEnRango(horas, { from: "2026-07-01", to: "2026-12-31" }), 200);
  assert.equal(horasEnRango(horas, { from: "2026-08-01", to: "2026-12-31" }), 0);
  assert.equal(horasEnRango(null, { from: "2026-01-01", to: "2026-12-31" }), 0);
});
