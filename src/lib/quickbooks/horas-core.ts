// Horas de técnicos por proyecto, a partir de los registros de tiempo (Time
// Activity) de QuickBooks.
//
// Por qué hace falta: la pantalla de proyecto de QuickBooks suma al costo las
// horas cargadas × la tarifa de costo de cada empleado ("Hourly time cost").
// Eso NO es un asiento contable, así que no aparece en el Estado de
// Resultados, que es de donde sale el resto del gasto. Sin esto, cada proyecto
// con horas mostraba un margen más alto que el de QuickBooks.
//
// Puro (sin red) para poder probarlo: horas.ts trae los registros, esto los
// agrupa.

import { sumarMeses, type DateRange } from "./prorate";

export type HorasProyecto = {
  costo: number; // horas × tarifa de costo — lo que QuickBooks suma como costo
  horas: number;
  // Horas cargadas sin tarifa de costo: QuickBooks tampoco las cuenta. Se
  // muestran para que se vean, porque son mano de obra que no pesa en el margen.
  sinTarifa: number;
  meses: { month: string; costo: number }[]; // "2026-05-01" → costo de ese mes
  tecnicos: { nombre: string; horas: number; costo: number }[];
};

type Registro = {
  proyecto: string;
  fecha: string;
  horas: number;
  tarifa: number;
  nombre: string;
};

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const ref = (v: unknown): { value: string; name: string } | null => {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  return typeof o.value === "string" ? { value: o.value, name: typeof o.name === "string" ? o.name : "" } : null;
};

// Duración del registro. Se carga de dos formas: horas/minutos sueltos, o
// entrada/salida con descanso.
function duracion(o: Record<string, unknown>): number {
  if (o.Hours !== undefined || o.Minutes !== undefined) {
    return num(o.Hours) + num(o.Minutes) / 60 + num(o.Seconds) / 3600;
  }
  if (typeof o.StartTime === "string" && typeof o.EndTime === "string") {
    const ms = Date.parse(o.EndTime) - Date.parse(o.StartTime);
    const descanso = num(o.BreakHours) + num(o.BreakMinutes) / 60;
    return Number.isFinite(ms) && ms > 0 ? Math.max(0, ms / 3600000 - descanso) : 0;
  }
  return 0;
}

/** ¿Este objeto es un registro de tiempo de QuickBooks? */
function comoRegistro(o: Record<string, unknown>): Registro | null {
  if (typeof o.TxnDate !== "string") return null;
  if (o.Hours === undefined && o.Minutes === undefined && o.StartTime === undefined) return null;
  const cliente = ref(o.CustomerRef);
  if (!cliente) return null;
  const quien = ref(o.EmployeeRef) ?? ref(o.VendorRef);
  return {
    proyecto: cliente.value,
    fecha: o.TxnDate.slice(0, 10),
    horas: duracion(o),
    tarifa: num(o.CostRate),
    nombre: quien?.name || "Sin nombre",
  };
}

/**
 * Saca los registros de tiempo de lo que devuelva el gateway: el JSON viene
 * dentro de un `text` (a veces precedido de "Found 81 time activity(ies):") y
 * puede ser una lista, no un objeto. Se deduplican por Id porque algunos
 * gateways mandan el mismo dato en texto y estructurado.
 */
export function extraerRegistros(raw: unknown): Registro[] {
  const nodos: unknown[] = [raw];
  const juntarTextos = (n: unknown, d = 0): void => {
    if (!n || d > 6) return;
    if (Array.isArray(n)) return n.forEach((x) => juntarTextos(x, d + 1));
    if (typeof n !== "object") return;
    const o = n as Record<string, unknown>;
    if (typeof o.text === "string") {
      const t = o.text;
      const i = [t.indexOf("["), t.indexOf("{")].filter((x) => x >= 0).sort((a, b) => a - b)[0];
      if (i !== undefined) {
        try {
          nodos.push(JSON.parse(t.slice(i)));
        } catch {
          /* ese texto no era JSON */
        }
      }
    }
    Object.values(o).forEach((x) => juntarTextos(x, d + 1));
  };
  juntarTextos(raw);

  const vistos = new Set<string>();
  const out: Registro[] = [];
  const recorrer = (n: unknown, d = 0): void => {
    if (!n || d > 12) return;
    if (Array.isArray(n)) return n.forEach((x) => recorrer(x, d + 1));
    if (typeof n !== "object") return;
    const o = n as Record<string, unknown>;
    const r = comoRegistro(o);
    if (r) {
      const id = typeof o.Id === "string" ? o.Id : null;
      if (id && vistos.has(id)) return;
      if (id) vistos.add(id);
      out.push(r);
      return;
    }
    Object.values(o).forEach((x) => recorrer(x, d + 1));
  };
  nodos.forEach((n) => recorrer(n));
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Agrupa los registros por proyecto (id del customer en QuickBooks). */
export function agruparHoras(registros: Registro[]): Map<string, HorasProyecto> {
  type Acc = { costo: number; horas: number; sinTarifa: number; meses: Map<string, number>; tecnicos: Map<string, { horas: number; costo: number }> };
  const acc = new Map<string, Acc>();
  for (const r of registros) {
    if (r.horas <= 0) continue;
    const a = acc.get(r.proyecto) ?? { costo: 0, horas: 0, sinTarifa: 0, meses: new Map(), tecnicos: new Map() };
    const costo = r.horas * r.tarifa;
    a.costo += costo;
    a.horas += r.horas;
    if (r.tarifa <= 0) a.sinTarifa += r.horas;
    const mes = `${r.fecha.slice(0, 7)}-01`;
    a.meses.set(mes, (a.meses.get(mes) ?? 0) + costo);
    const t = a.tecnicos.get(r.nombre) ?? { horas: 0, costo: 0 };
    t.horas += r.horas;
    t.costo += costo;
    a.tecnicos.set(r.nombre, t);
    acc.set(r.proyecto, a);
  }
  const out = new Map<string, HorasProyecto>();
  for (const [id, a] of acc) {
    out.set(id, {
      costo: round2(a.costo),
      horas: round2(a.horas),
      sinTarifa: round2(a.sinTarifa),
      meses: [...a.meses]
        .filter(([, c]) => c !== 0)
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([month, c]) => ({ month, costo: round2(c) })),
      tecnicos: [...a.tecnicos]
        .map(([nombre, t]) => ({ nombre, horas: round2(t.horas), costo: round2(t.costo) }))
        .sort((x, y) => y.costo - x.costo || y.horas - x.horas),
    });
  }
  return out;
}

/** Lo que se guarda en la base viene como JSON sin tipo: se valida al leerlo. */
export function normalizarHoras(v: unknown): HorasProyecto | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.costo !== "number" || typeof o.horas !== "number") return null;
  const lista = (x: unknown) => (Array.isArray(x) ? x : []);
  return {
    costo: o.costo,
    horas: o.horas,
    sinTarifa: num(o.sinTarifa),
    meses: lista(o.meses)
      .filter((m): m is { month: string; costo: number } => !!m && typeof m.month === "string" && typeof m.costo === "number")
      .map((m) => ({ month: m.month, costo: m.costo })),
    tecnicos: lista(o.tecnicos)
      .filter((t): t is { nombre: string; horas: number; costo: number } => !!t && typeof t.nombre === "string")
      .map((t) => ({ nombre: t.nombre, horas: num(t.horas), costo: num(t.costo) })),
  };
}

/**
 * Gasto que se muestra: lo contable (Estado de Resultados) más las horas.
 *
 * Sin dato contable (null) no hay gasto: sumar solo las horas mostraría un
 * margen altísimo para un proyecto del que no sabemos lo que costó.
 */
export function gastoConHoras(contable: number | null, horas: HorasProyecto | null): number | null {
  if (contable === null) return null;
  return round2(contable + (horas?.costo ?? 0));
}

/**
 * Costo de las horas que cae dentro del rango. Va por el mes en que se
 * trabajaron, no prorrateado: las horas tienen fecha propia, aunque el resto
 * del gasto del proyecto se tenga que repartir por días.
 */
export function horasEnRango(h: HorasProyecto | null, range: DateRange | null): number {
  if (!h) return 0;
  if (!range) return h.costo;
  return sumarMeses(
    h.meses.map((m) => ({ month: m.month, income: 0, cost: m.costo })),
    range,
  ).cost;
}
