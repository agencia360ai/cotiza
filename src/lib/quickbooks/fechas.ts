import "server-only";
import { listQboTools, withQboSession } from "./mcp";
import { desenvolver } from "./cobrado-core";
import { cosecharFechas, fusionar, type RangoTxn } from "./fechas-core";

// Fechas reales de actividad por proyecto, leídas de las TRANSACCIONES.
//
// Costo: UNA llamada por tipo de transacción para TODA la ventana, no una por
// proyecto. Preguntar por los ~90 proyectos uno por uno serían 360 llamadas
// contra un gateway que ya es la parte lenta del refresh; pedir todo el período
// y agrupar en memoria son cuatro. La diferencia no es de estilo: el refresh
// entero corre dentro de un maxDuration de 300s.

export type FechasReales = {
  /** qb_job_id → primera y última fecha de transacción. */
  porProyecto: Map<string, RangoTxn>;
  /** Qué herramientas dieron datos. Vacío = no se pudo leer nada. */
  fuentes: string[];
};

const VACIO: FechasReales = { porProyecto: new Map(), fuentes: [] };

// Las cuatro cosas que marcan que un proyecto está vivo: lo que se le facturó
// al cliente y lo que se gastó en él. Los pagos de facturas quedan afuera a
// propósito —mueven plata pero no son trabajo— y correrían el "fin" al día del
// último cobro, que es otra cosa.
const FUENTES: { re: RegExp; nombre: string }[] = [
  { re: /(search|find|list)_?invoices?$/i, nombre: "facturas" },
  { re: /(search|find|list)_?sales_?receipts?$/i, nombre: "recibos" },
  { re: /(search|find|list)_?purchases?$/i, nombre: "compras" },
  { re: /(search|find|list)_?bills?$/i, nombre: "gastos" },
];

// El gateway acepta el criterio de varias formas según cómo esté envuelto; la
// primera que devuelva fechas gana. Mismo patrón que en el cobrado, y por el
// mismo motivo: la forma real no está documentada y adivinarla ya costó caro.
function variantes(desde: string): Record<string, unknown>[] {
  return [
    { params: { criteria: [{ field: "TxnDate", value: desde, operator: ">=" }, { field: "fetchAll", value: true }] } },
    { params: { criteria: [{ field: "TxnDate", value: desde, operator: ">=" }] } },
    { params: { criteria: { TxnDate: desde, fetchAll: true } } },
    { params: { criteria: [] } },
    { params: {} },
  ];
}

/**
 * Rango real de actividad de cada proyecto.
 *
 * Devuelve el mapa vacío —no lanza— cuando el gateway no expone las
 * herramientas o falla: sin esto, un problema leyendo transacciones tiraría
 * abajo un refresh que por lo demás funcionó. Las fechas por mes que ya
 * estaban siguen sirviendo; estas solo las mejoran.
 */
export async function fetchFechasReales(
  idsDeProyectos: string[],
  desde: string,
): Promise<FechasReales> {
  const conocidos = new Set(idsDeProyectos);
  if (conocidos.size === 0) return VACIO;

  let tools;
  try {
    tools = await listQboTools();
  } catch {
    return VACIO;
  }

  const elegidas = FUENTES.map((f) => ({ ...f, tool: tools.find((t) => f.re.test(t.name)) })).filter(
    (f): f is typeof f & { tool: { name: string } } => !!f.tool,
  );
  if (elegidas.length === 0) return VACIO;

  try {
    return await withQboSession(async (call) => {
      const porProyecto = new Map<string, RangoTxn>();
      const fuentes: string[] = [];
      for (const f of elegidas) {
        for (const v of variantes(desde)) {
          let raw: unknown;
          try {
            raw = await call(f.tool.name, v);
          } catch {
            continue; // esa variante no le gustó al gateway: probar la siguiente
          }
          const parcial = new Map<string, RangoTxn>();
          for (const nodo of desenvolver(raw)) cosecharFechas(nodo, parcial, conocidos);
          if (parcial.size > 0) {
            fusionar(porProyecto, parcial);
            fuentes.push(f.nombre);
            break; // esta fuente ya dio; pasar a la siguiente
          }
        }
      }
      return { porProyecto, fuentes };
    });
  } catch {
    return VACIO;
  }
}

export type DiagnosticoFechas = {
  herramientas: string[];
  probadas: { tool: string; variante: string; error?: string; idsQueMatchean: number; fechasVistas: number }[];
  muestraCruda: string;
};

/**
 * Por qué no hay fechas reales. Se corre a mano desde la UI.
 *
 * Puede fallar de cuatro formas —no existe la herramienta, el criterio no se
 * acepta, no devuelve transacciones, o devuelve ids que no son los de nuestros
 * proyectos— y desde afuera las cuatro se ven igual: "sigue diciendo jul 2026".
 */
export async function diagnosticarFechas(
  idsDeProyectos: string[],
  desde: string,
): Promise<DiagnosticoFechas> {
  const conocidos = new Set(idsDeProyectos);
  const tools = await listQboTools();
  const base: DiagnosticoFechas = {
    herramientas: tools.map((t) => t.name).filter((n) => /invoice|purchase|bill|receipt/i.test(n)),
    probadas: [],
    muestraCruda: "",
  };
  const elegidas = FUENTES.map((f) => ({ ...f, tool: tools.find((t) => f.re.test(t.name)) })).filter(
    (f): f is typeof f & { tool: { name: string } } => !!f.tool,
  );
  if (elegidas.length === 0) {
    base.muestraCruda = `Ninguna herramienta de transacciones matcheó. El gateway expone: ${base.herramientas.join(", ") || "(ninguna)"}`;
    return base;
  }

  return await withQboSession(async (call) => {
    for (const f of elegidas) {
      const vs = variantes(desde);
      for (let i = 0; i < vs.length; i++) {
        let raw: unknown;
        try {
          raw = await call(f.tool.name, vs[i]);
        } catch (e) {
          base.probadas.push({
            tool: f.tool.name,
            variante: `#${i + 1}`,
            error: e instanceof Error ? e.message.slice(0, 160) : "error",
            idsQueMatchean: 0,
            fechasVistas: 0,
          });
          continue;
        }
        // Sin filtrar: revela si el problema es que no hay transacciones o que
        // los ids que trae no son los de nuestros proyectos.
        const todos = new Map<string, RangoTxn>();
        const nuestros = new Map<string, RangoTxn>();
        for (const nodo of desenvolver(raw)) {
          cosecharFechas(nodo, nuestros, conocidos);
          cosecharFechas(nodo, todos, new Set([...conocidos, ...idsSueltos(raw)]));
        }
        base.probadas.push({
          tool: f.tool.name,
          variante: `#${i + 1}`,
          idsQueMatchean: nuestros.size,
          fechasVistas: todos.size,
        });
        if (!base.muestraCruda) base.muestraCruda = JSON.stringify(raw).slice(0, 1500);
        if (nuestros.size > 0) break;
      }
    }
    return base;
  });
}

// Todos los ids de cliente del payload, sin filtrar: solo para el diagnóstico.
function idsSueltos(raw: unknown): string[] {
  const out = new Set<string>();
  const ver = (n: unknown, d = 0): void => {
    if (!n || d > 14) return;
    if (Array.isArray(n)) return n.forEach((x) => ver(x, d + 1));
    if (typeof n !== "object") return;
    const o = n as Record<string, unknown>;
    const ref = o.CustomerRef;
    if (typeof ref === "string") out.add(ref);
    else if (ref && typeof ref === "object") {
      const v = (ref as Record<string, unknown>).value;
      if (typeof v === "string") out.add(v);
    }
    Object.values(o).forEach((x) => ver(x, d + 1));
  };
  for (const nodo of desenvolver(raw)) ver(nodo);
  return [...out];
}
