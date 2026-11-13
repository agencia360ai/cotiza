import "server-only";
import { listQboTools, withQboSession } from "./mcp";
import { extractEntities } from "./parse";
import { plataPorFactura } from "./pagos-core";

const HERRAMIENTA = /^(search|find|query|list)_?payments?$/i;
// El gateway no acepta filtro por fecha en los pagos (falla el parser de
// QuickBooks), así que se piden todos con un tope. Si se llega al tope la
// lista puede venir cortada, y una lista cortada daría facturas pagadas como
// "sin cobrar": en ese caso no se usa.
const TOPE = 1000;

/**
 * Plata recibida por factura, de todos los pagos de QuickBooks (una consulta).
 * null = no se pudo leer completa: quien llama conserva lo que tenía.
 */
export async function fetchPlataPorFactura(): Promise<Map<string, number> | null> {
  let tool: string | undefined;
  try {
    tool = (await listQboTools()).find((t) => HERRAMIENTA.test(t.name))?.name;
  } catch {
    return null;
  }
  if (!tool) return null;
  try {
    return await withQboSession(async (call) => {
      for (const v of [{ params: { limit: TOPE } }, { params: {} }]) {
        let r;
        try {
          r = await call(tool, v);
        } catch {
          continue;
        }
        if (r.isError) continue;
        const pagos = extractEntities(r, "Payment").filter((p) => p.TotalAmt !== undefined);
        if (pagos.length === 0) continue;
        if (pagos.length >= TOPE) return null;
        return plataPorFactura(pagos);
      }
      return null;
    });
  } catch {
    return null;
  }
}
