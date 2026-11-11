import "server-only";
import { listQboTools, withQboSession } from "./mcp";
import { extractEntities } from "./parse";
import { agruparEstimados, type PorFacturar } from "./estimados-core";

const HERRAMIENTA = /^(search|find|query)_?invoices$/i;

/**
 * Las facturas EST de todos los proyectos, en una sola consulta (son pocas).
 * null = no se pudo leer: quien llama conserva lo que ya tenía guardado.
 */
export async function fetchPorFacturar(): Promise<Map<string, PorFacturar> | null> {
  let tool: string | undefined;
  try {
    tool = (await listQboTools()).find((t) => HERRAMIENTA.test(t.name))?.name;
  } catch {
    return null;
  }
  if (!tool) return null;
  try {
    return await withQboSession(async (call) => {
      // LIKE de QuickBooks no distingue mayúsculas: trae "EST…", "Est06" y
      // también cualquier número que tenga "est" en el medio; esos se descartan
      // al agrupar (tiene que empezar con EST).
      const r = await call(tool, { params: { criteria: [{ field: "DocNumber", value: "%EST%", operator: "LIKE" }] } });
      if (r.isError) return null;
      return agruparEstimados(extractEntities(r, "Invoice"));
    });
  } catch {
    return null;
  }
}
