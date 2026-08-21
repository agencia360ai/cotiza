import "server-only";
import { listQboTools, withQboSession } from "./mcp";

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

// Recorre el JSON del reporte juntando (idCliente, saldo), pero SOLO para ids
// que son proyectos conocidos. Sin ese filtro, un walk genérico levanta
// cualquier objeto con `id` y `total` —una línea de factura, un subtotal— y
// termina inventando un cobrado. Ante la duda es mejor no saber que mentir.
function cosechar(node: unknown, out: Map<string, number>, conocidos: Set<string>, depth = 0): void {
  if (!node || depth > 8) return;
  if (Array.isArray(node)) {
    for (const n of node) cosechar(n, out, conocidos, depth + 1);
    return;
  }
  if (typeof node !== "object") return;
  const o = node as Record<string, unknown>;

  // Una fila del reporte trae el id del cliente y su total. Los nombres varían
  // entre gateways, así que se prueban los habituales en vez de casarse con uno.
  const id =
    (typeof o.customer_id === "string" && o.customer_id) ||
    (typeof o.customerId === "string" && o.customerId) ||
    (typeof o.id === "string" && o.id) ||
    null;
  const total =
    typeof o.balance === "number"
      ? o.balance
      : typeof o.total === "number"
        ? o.total
        : typeof o.amount === "number"
          ? o.amount
          : typeof o.Balance === "number"
            ? o.Balance
            : null;
  if (id && conocidos.has(id) && total !== null && Number.isFinite(total)) {
    // Un cliente puede aparecer en varias filas (una por tramo de antigüedad):
    // el pendiente es la suma, no la última.
    out.set(id, (out.get(id) ?? 0) + total);
  }

  for (const v of Object.values(o)) cosechar(v, out, conocidos, depth + 1);
}

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
        cosechar(raw, out, conocidos);
        if (out.size > 0) return { porProyecto: out, fuente: tool.name };
      }
      return { porProyecto: new Map(), fuente: tool.name };
    });
  } catch {
    return VACIO;
  }
}

export { calcularCobrado } from "./cobrado-core";
