import "server-only";
import { listQboTools, withQboSession } from "./mcp";
import { extractEntities } from "./parse";
import { agruparEstimados, type PorFacturar } from "./estimados-core";

const HERRAMIENTA = /^(search|find|query)_?invoices$/i;

/**
 * Lo por facturar de todos los proyectos: las EST y las facturas fechadas
 * después de hoy (P26-…). Dos consultas chicas, no una por proyecto.
 * `plata`: lo pagado en dinero por factura; con eso un anticipo cuenta solo la
 * plata, no las notas de crédito.
 * null = no se pudo leer alguna de las dos: quien llama conserva lo guardado,
 * para que un hipo del gateway no haga desaparecer la mitad de lo por facturar.
 */
export async function fetchPorFacturar(plata?: Map<string, number>): Promise<Map<string, PorFacturar> | null> {
  let tool: string | undefined;
  try {
    tool = (await listQboTools()).find((t) => HERRAMIENTA.test(t.name))?.name;
  } catch {
    return null;
  }
  if (!tool) return null;
  const hoy = new Date().toISOString().slice(0, 10);
  try {
    return await withQboSession(async (call) => {
      // LIKE de QuickBooks no distingue mayúsculas: trae "EST…", "Est06" y
      // también cualquier número que tenga "est" en el medio; esos se descartan
      // al agrupar (tiene que empezar con EST).
      const est = await call(tool, { params: { criteria: [{ field: "DocNumber", value: "%EST%", operator: "LIKE" }, { field: "fetchAll", value: true }] } });
      if (est.isError) return null;
      const futuras = await call(tool, { params: { criteria: [{ field: "TxnDate", value: hoy, operator: ">" }, { field: "fetchAll", value: true }] } });
      if (futuras.isError) return null;
      return agruparEstimados([...extractEntities(est, "Invoice"), ...extractEntities(futuras, "Invoice")], hoy, plata);
    });
  } catch {
    return null;
  }
}
