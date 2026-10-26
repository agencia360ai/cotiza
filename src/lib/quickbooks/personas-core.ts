// Quién es quién entre Personal (la app) y QuickBooks. Sin red: lo usan el
// vínculo automático y los tests.
//
// En QuickBooks los de planilla son empleados (Employee, con costo por hora) y
// los de servicio profesional son proveedores (Vendor, "Juan Pablo Pareja
// (Serv. Profesional)"). Los nombres no coinciden letra por letra con los de
// Personal ("Alex Javier Martinez" ↔ "Alex Martinez"), así que se comparan
// por palabras.

export type TipoQbo = "Employee" | "Vendor";

export type PersonaQbo = {
  tipo: TipoQbo;
  id: string;
  nombre: string;
  costoHora: number | null; // CostRate del empleado: lo que QuickBooks aplica a sus horas
  tarifaFactura: number | null; // BillRate: con valor, las horas salen facturables
};

/** Las palabras de un nombre, sin tildes ni lo que va entre paréntesis. */
export function palabras(nombre: string): string[] {
  return nombre
    .replace(/\([^)]*\)/g, " ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-zñ]+/)
    .filter((p) => p.length >= 2);
}

/** Mismo nombre si todas las palabras del más corto están en el otro (al menos dos). */
export function mismaPersona(a: string, b: string): boolean {
  const pa = palabras(a);
  const pb = palabras(b);
  const [corto, largo] = pa.length <= pb.length ? [pa, pb] : [pb, pa];
  return corto.length >= 2 && corto.every((p) => largo.includes(p));
}

/**
 * La ficha de QuickBooks de alguien de Personal, o null si no hay una sola
 * que encaje. Un empleado gana sobre un proveedor del mismo nombre: si alguien
 * pasó a planilla, sus horas tienen que llevar costo.
 */
export function emparejar(nombre: string, personas: PersonaQbo[]): PersonaQbo | null {
  const candidatos = personas.filter((p) => mismaPersona(nombre, p.nombre));
  for (const tipo of ["Employee", "Vendor"] as const) {
    const delTipo = candidatos.filter((p) => p.tipo === tipo);
    if (delTipo.length === 1) return delTipo[0];
    if (delTipo.length > 1) return null; // dos fichas parecidas: mejor no adivinar
  }
  return null;
}

/** Lo que se le manda a QuickBooks como duración: horas enteras y minutos. */
export function partirHoras(h: number): { hours: number; minutes: number } {
  const total = Math.round(h * 60);
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}
