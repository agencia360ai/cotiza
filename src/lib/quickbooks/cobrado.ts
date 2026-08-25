import "server-only";
import { listQboTools, withQboSession } from "./mcp";
import { cosechar, desenvolver } from "./cobrado-core";
import { parsePnl } from "./parse";

/** Cuánto entró en un mes, a nivel empresa. */
export type MesCobrado = { month: string; cobrado: number };

// Cuánto se COBRÓ de verdad, por proyecto.
//
// El P&L de QuickBooks es base devengado: su "income" es lo FACTURADO, e
// incluye facturas que el cliente todavía no pagó. Mostrar eso como "Cobro"
// hacía leer como plata en la mano algo que puede seguir siendo una cuenta por
// cobrar — y en una empresa que vive del flujo, esa diferencia es el negocio.
//
// El cobrado se deduce: facturado − saldo pendiente. El pendiente sale de UN
// solo reporte de cuentas por cobrar con todos los clientes, no de una consulta
// por proyecto: son ~80 proyectos y el gateway ya es lento con el P&L.

export type SaldosPendientes = {
  /** qb_job_id → saldo pendiente. Ausente = el reporte no lo mencionó. */
  porProyecto: Map<string, number>;
  /** Qué herramienta se usó; null si el gateway no expone ninguna. */
  fuente: string | null;
};

const VACIO: SaldosPendientes = { porProyecto: new Map(), fuente: null };

// Se acepta cualquiera de las dos formas que suele exponer el gateway. El
// reporte de antigüedad da todos los clientes de una; el balance por cliente
// sería una llamada por proyecto y no vale la pena.
const RE_AGED = /aged.*receivab|receivab.*aging|cuentas.*cobrar/i;
const RE_BALANCE = /customer.*balance|balance.*customer/i;

/**
 * Saldos pendientes por proyecto. Devuelve el mapa vacío —no lanza— cuando el
 * gateway no expone el reporte: sin esto el board pierde una columna, no la
 * pantalla entera.
 */
export async function fetchSaldosPendientes(idsDeProyectos: string[]): Promise<SaldosPendientes> {
  let tools;
  try {
    tools = await listQboTools();
  } catch {
    return VACIO;
  }
  const tool = tools.find((t) => RE_AGED.test(t.name)) ?? tools.find((t) => RE_BALANCE.test(t.name));
  if (!tool) return VACIO;
  const conocidos = new Set(idsDeProyectos);
  if (conocidos.size === 0) return VACIO;

  try {
    return await withQboSession(async (call) => {
      const hoy = new Date().toISOString().slice(0, 10);
      // Variantes de parámetros: el gateway acepta una u otra según cómo esté
      // envuelto. La primera que devuelva algo gana.
      const variantes: Record<string, unknown>[] = [
        { params: { report_date: hoy } },
        { params: {} },
        {},
      ];
      for (const v of variantes) {
        let raw: unknown;
        try {
          raw = await call(tool.name, v);
        } catch {
          continue;
        }
        const out = new Map<string, number>();
        for (const nodo of desenvolver(raw)) cosechar(nodo, out, conocidos);
        if (out.size > 0) return { porProyecto: out, fuente: tool.name };
      }
      return { porProyecto: new Map(), fuente: tool.name };
    });
  } catch {
    return VACIO;
  }
}

export type DiagnosticoCobrado = {
  herramienta: string | null;
  variante: string | null;
  idsEnReporte: string[];   // primeros que trajo el reporte
  totalIdsReporte: number;
  idsQueMatchean: number;
  muestraCruda: string;     // recorte del JSON, para ver la forma real
};

/**
 * Por qué no hay cobrado. Se llama a mano desde la UI: el reporte puede fallar
 * de tres formas —no existe la herramienta, no devuelve filas, o devuelve ids
 * que no son los de nuestros proyectos— y desde afuera las tres se ven igual.
 */
export async function diagnosticarCobrado(idsDeProyectos: string[]): Promise<DiagnosticoCobrado> {
  const base: DiagnosticoCobrado = {
    herramienta: null,
    variante: null,
    idsEnReporte: [],
    totalIdsReporte: 0,
    idsQueMatchean: 0,
    muestraCruda: "",
  };
  const tools = await listQboTools();
  const tool = tools.find((t) => RE_AGED.test(t.name)) ?? tools.find((t) => RE_BALANCE.test(t.name));
  if (!tool) {
    base.muestraCruda = `El gateway no expone ningún reporte de cuentas por cobrar. Tiene: ${tools.map((t) => t.name).slice(0, 40).join(", ")}`;
    return base;
  }
  base.herramienta = tool.name;
  const conocidos = new Set(idsDeProyectos);

  return await withQboSession(async (call) => {
    const hoy = new Date().toISOString().slice(0, 10);
    const variantes: [string, Record<string, unknown>][] = [
      ["params+fecha", { params: { report_date: hoy } }],
      ["params vacío", { params: {} }],
    ];
    for (const [nombre, v] of variantes) {
      let raw: unknown;
      try {
        raw = await call(tool.name, v);
      } catch (e) {
        base.muestraCruda = `variante "${nombre}" falló: ${e instanceof Error ? e.message : "error"}`;
        continue;
      }
      base.variante = nombre;
      // TODOS los ids que aparecen en el JSON, sin filtrar: es lo que revela si
      // el reporte trae sub-clientes o solo padres.
      const todos = new Set<string>();
      const verIds = (n: unknown, d = 0): void => {
        if (!n || d > 12) return;
        if (Array.isArray(n)) return n.forEach((x) => verIds(x, d + 1));
        if (typeof n !== "object") return;
        const o = n as Record<string, unknown>;
        if (typeof o.id === "string" && o.id) todos.add(o.id);
        if (typeof o.customer_id === "string" && o.customer_id) todos.add(o.customer_id);
        Object.values(o).forEach((x) => verIds(x, d + 1));
      };
      for (const nodo of desenvolver(raw)) verIds(nodo);
      base.totalIdsReporte = todos.size;
      base.idsEnReporte = [...todos].slice(0, 15);
      base.idsQueMatchean = [...todos].filter((x) => conocidos.has(x)).length;
      base.muestraCruda = JSON.stringify(raw).slice(0, 1200);
      if (todos.size > 0) break;
    }
    return base;
  });
}

/**
 * Cobrado mes a mes, a nivel EMPRESA.
 *
 * El P&L en base CAJA registra el ingreso cuando entra la plata, no cuando se
 * factura. Sumado por mes, eso es exactamente "cuánto cobramos en cada mes".
 *
 * Una sola llamada, sin aislar por proyecto: la gráfica muestra totales, y
 * duplicar las ~80 consultas por proyecto —que ya son la parte lenta del
 * refresh— para un dato agregado no se paga.
 */
export async function fetchCobradoPorMes(desde: string, hasta: string): Promise<MesCobrado[]> {
  let tools;
  try {
    tools = await listQboTools();
  } catch {
    return [];
  }
  const tool = tools.find((t) => /profit.*loss|profit_loss|\bp_l\b|pnl/i.test(t.name));
  if (!tool) return [];

  try {
    return await withQboSession(async (call) => {
      const raw = await call(tool.name, {
        params: {
          start_date: desde,
          end_date: hasta,
          summarize_column_by: "Month",
          accounting_method: "Cash",
        },
      });
      // parsePnl ya sabe desenvolver y leer la forma de los reportes: el mismo
      // reporte, otra base contable. Reusarlo evita repetir el error de leer
      // mal la estructura, que ya costó dos intentos.
      const pnl = parsePnl(raw as Parameters<typeof parsePnl>[0]);
      if (!pnl) return [];
      return pnl.meses.map((m) => ({ month: m.month, cobrado: m.income }));
    });
  } catch {
    return [];
  }
}

export { calcularCobrado } from "./cobrado-core";
