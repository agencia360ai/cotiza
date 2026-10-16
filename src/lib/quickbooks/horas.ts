import "server-only";
import { listQboTools, withQboSession, type QboToolResult } from "./mcp";
import { agruparHoras, extraerRegistros, type HorasProyecto } from "./horas-core";

// Horas de técnicos de TODOS los proyectos en una sola llamada al gateway.
//
// Una llamada y agrupar en memoria, igual que las fechas y el cobrado: preguntar
// proyecto por proyecto serían ~90 llamadas secuenciales dentro de un refresh
// que tiene 300s en total.

const HERRAMIENTA = /(search|find|list|query)_?time_?activit(y|ies)$/i;

// QuickBooks devuelve como mucho 1000 registros por consulta. Si llegan 1000,
// pueden faltar: ahí se pregunta por proyecto, solo por los abiertos.
const TOPE = 1000;
// El fallback por proyecto es secuencial (la sesión del gateway no tolera
// llamadas en paralelo): se corta a tiempo para no comerse el refresh.
const PRESUPUESTO_MS = 60_000;

const fallo = (r: QboToolResult) => r.isError === true;

/**
 * Horas por proyecto (id del customer de QuickBooks).
 *
 * null = no se pudo leer (sin herramienta, error del gateway, o una respuesta
 * sin un solo registro). Quien llama conserva lo que ya tenía guardado: un
 * hipo del gateway no puede borrar las horas de todos los proyectos.
 */
export async function fetchHorasTecnicos(idsAbiertos: string[]): Promise<Map<string, HorasProyecto> | null> {
  let tool: string | undefined;
  try {
    tool = (await listQboTools()).find((t) => HERRAMIENTA.test(t.name))?.name;
  } catch {
    return null;
  }
  if (!tool) return null;

  try {
    return await withQboSession(async (call) => {
      // El gateway acepta el filtro de una forma u otra según la versión; la
      // primera que devuelva registros gana. Los filtros por fecha están rotos en
      // el gateway actual ("Error parsing query"), así que se pide todo.
      const variantes: Record<string, unknown>[] = [{ params: { limit: TOPE } }, { params: {} }, {}];
      let registros: ReturnType<typeof extraerRegistros> = [];
      for (const v of variantes) {
        try {
          const r = await call(tool, v);
          if (fallo(r)) continue;
          registros = extraerRegistros(r);
          if (registros.length > 0) break;
        } catch {
          /* probar la siguiente forma */
        }
      }
      if (registros.length === 0) return null;

      const porProyecto = agruparHoras(registros);
      if (registros.length < TOPE) return porProyecto;

      // Tope alcanzado: lo de los proyectos abiertos se pide por separado para
      // no perder horas. Los cerrados conservan lo que ya tenían.
      const hasta = Date.now() + PRESUPUESTO_MS;
      for (const id of idsAbiertos) {
        if (Date.now() > hasta) break;
        try {
          const r = await call(tool, { params: { customer_ref: id, limit: TOPE } });
          if (fallo(r)) continue;
          const propios = extraerRegistros(r).filter((x) => x.proyecto === id);
          const h = agruparHoras(propios).get(id);
          if (h) porProyecto.set(id, h);
        } catch {
          /* ese proyecto queda con lo de la consulta general */
        }
      }
      return porProyecto;
    });
  } catch {
    return null;
  }
}
