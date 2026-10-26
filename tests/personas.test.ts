import { test } from "node:test";
import assert from "node:assert/strict";
import { emparejar, mismaPersona, palabras, partirHoras, type PersonaQbo } from "../src/lib/quickbooks/personas-core";
import { ajustarHoras, margenConHoras, type HorasProyecto } from "../src/lib/quickbooks/horas-core";

// Como están hoy en QuickBooks (empleados = planilla, proveedores = serv. profesional).
const qbo: PersonaQbo[] = [
  { tipo: "Employee", id: "238", nombre: "Alex Martinez", costoHora: 7, tarifaFactura: 7 },
  { tipo: "Employee", id: "239", nombre: "Gabriel Gonzalez", costoHora: 7, tarifaFactura: 7 },
  { tipo: "Employee", id: "237", nombre: "Luis Fenton", costoHora: 7, tarifaFactura: 7 },
  { tipo: "Employee", id: "400000021", nombre: "Nestor Gabriel Gutierrez", costoHora: null, tarifaFactura: null },
  { tipo: "Vendor", id: "240", nombre: "Juan Pablo Pareja (Serv. Profesional)", costoHora: null, tarifaFactura: null },
  { tipo: "Vendor", id: "22", nombre: "Humberto Gonzalez (Serv. Profesional)", costoHora: null, tarifaFactura: null },
  { tipo: "Vendor", id: "339", nombre: "Davis Rodriguez", costoHora: null, tarifaFactura: null },
];

test("cada técnico de Personal encuentra su ficha de QuickBooks", () => {
  assert.equal(emparejar("Alex Javier Martinez", qbo)?.id, "238", "con segundo nombre");
  assert.equal(emparejar("Gabriel Gonzalez", qbo)?.id, "239", "no lo confunde con Humberto Gonzalez ni con Nestor Gabriel");
  assert.equal(emparejar("Luis Fenton", qbo)?.tipo, "Employee");
  assert.equal(emparejar("Juan Pablo Pareja", qbo)?.id, "240", "sin el (Serv. Profesional)");
  assert.equal(emparejar("Humberto Gonzalez", qbo)?.tipo, "Vendor");
  assert.equal(emparejar("Davis Rodriguez", qbo)?.id, "339");
  assert.equal(emparejar("Ricaurte Javier Ríos", qbo), null, "no está en QuickBooks");
});

test("si hay empleado y proveedor con el mismo nombre, gana el empleado (pasó a planilla)", () => {
  const ambos = [...qbo, { tipo: "Vendor" as const, id: "900", nombre: "Alex Martinez (Serv. Profesional)", costoHora: null, tarifaFactura: null }];
  assert.equal(emparejar("Alex Martinez", ambos)?.id, "238");
});

test("dos fichas parecidas del mismo tipo: no adivina", () => {
  const dobles = [...qbo, { tipo: "Employee" as const, id: "901", nombre: "Luis Fenton Jr", costoHora: 7, tarifaFactura: 7 }];
  assert.equal(emparejar("Luis Fenton", dobles), null);
});

test("nombres: sin tildes, sin paréntesis, al menos dos palabras", () => {
  assert.deepEqual(palabras("Ydenis Vásquez"), ["ydenis", "vasquez"]);
  assert.ok(mismaPersona("Ydenis Vasquez", "Ydenis Vásquez"));
  assert.ok(!mismaPersona("Luis", "Luis Fenton"), "una sola palabra no alcanza");
});

test("la duración va en horas y minutos enteros", () => {
  assert.deepEqual(partirHoras(8), { hours: 8, minutes: 0 });
  assert.deepEqual(partirHoras(7.5), { hours: 7, minutes: 30 });
  assert.deepEqual(partirHoras(0.25), { hours: 0, minutes: 15 });
  assert.deepEqual(partirHoras(2.33), { hours: 2, minutes: 20 });
});

const previas: HorasProyecto = {
  costo: 56,
  horas: 8,
  sinTarifa: 0,
  meses: [{ month: "2026-08-01", costo: 56 }],
  tecnicos: [{ nombre: "Luis Fenton", horas: 8, costo: 56 }],
};

test("10 horas de Alex a $7 suman $70 al proyecto; las de un proveedor, 0", () => {
  const h = ajustarHoras(previas, [
    { nombre: "Alex Martinez", fecha: "2026-10-20", horas: 10, costoHora: 7, proveedor: false },
    { nombre: "Juan Pablo Pareja (Serv. Profesional)", fecha: "2026-10-21", horas: 6, costoHora: 0, proveedor: true },
  ])!;
  assert.equal(h.costo, 126);
  assert.equal(h.horas, 24);
  assert.equal(h.sinTarifa, 0, "el proveedor va sin costo a propósito: no es 'sin tarifa'");
  assert.deepEqual(h.meses, [{ month: "2026-08-01", costo: 56 }, { month: "2026-10-01", costo: 70 }]);
  assert.deepEqual(h.tecnicos, [
    { nombre: "Alex Martinez", horas: 10, costo: 70 },
    { nombre: "Luis Fenton", horas: 8, costo: 56 },
    { nombre: "Juan Pablo Pareja (Serv. Profesional)", horas: 6, costo: 0, proveedor: true },
  ]);
  assert.equal(margenConHoras(1000, 500, h), (1000 - 626) / 1000);
});

test("un empleado sin tarifa sí queda como 'sin tarifa'", () => {
  const h = ajustarHoras(null, [{ nombre: "Nestor Gabriel Gutierrez", fecha: "2026-10-20", horas: 4, costoHora: 0, proveedor: false }])!;
  assert.equal(h.sinTarifa, 4);
  assert.equal(h.costo, 0);
});

test("borrar lo cargado lo descuenta, y si no queda nada no hay horas", () => {
  const entrada = { nombre: "Alex Martinez", fecha: "2026-10-20", horas: 10, costoHora: 7, proveedor: false };
  const con = ajustarHoras(previas, [entrada]);
  assert.deepEqual(ajustarHoras(con, [entrada], -1), previas);
  assert.equal(ajustarHoras(ajustarHoras(null, [entrada]), [entrada], -1), null);
});

test("margen: sin gasto confiable no hay margen", () => {
  assert.equal(margenConHoras(1000, -50, previas), null);
  assert.equal(margenConHoras(0, 100, previas), null);
  assert.equal(margenConHoras(1000, null, previas), null);
});
