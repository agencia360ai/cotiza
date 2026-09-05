import "server-only";
import { fetchQboCustomers } from "./customers";
import { listQboTools, withQboSession } from "./mcp";
import { parsePnl, type MonthPnl, type Pnl } from "./parse";

// Un proyecto en QBO = un customer con IsProject=true (bajo el cliente padre).
export type QboProject = {
  id: string;
  name: string; // nombre limpio (hoja, sin "Padre:")
  fullName: string; // displayName completo
  parentId: string | null; // customer padre en QBO (para detectar rollups)
  siblings: number; // proyectos TOTALES del mismo padre en QBO (todos los años,
  // abiertos y cerrados) — para la guardia anti-rollup; no se persiste
  rubro: string | null; // DC | DM | DS | DV
  year: number | null;
  clientName: string;
  income: number | null; // FACTURADO — el total del proyecto según QuickBooks
  paid: number | null;   // COBRADO de verdad. null = no se pudo determinar
  cost: number | null;
  margin: number | null; // 0..1
  closed: boolean; // derivado: status === 'cerrado' → no se re-consulta a QBO
  status: ProjectBizStatus; // status de negocio editable en Reportme
  progress: number | null; // avance manual 0-100 (lo setea el equipo, no QBO)
  startDate: string | null; // inicio del contrato (0022) — para prorrateo
  endDate: string | null; // fin del contrato
  contractTotal: number | null; // monto total del contrato (0023) — se prorratea
  quoteNumber: string | null; // cotización de origen ("COT DC 26-141") — 0037
  // Fechas REALES de QuickBooks (0045). No las pone nadie a mano.
  qboCreatedAt: string | null; // MetaData.CreateTime del customer
  firstTxnDate: string | null; // primer movimiento (mes del P&L, o TxnDate real)
  lastTxnDate: string | null; // último movimiento
  // De dónde salieron las dos de arriba. "mes" = del reporte mensual, así que
  // el día cae siempre en 1 y no significa nada. "transaccion" = TxnDate real.
  txnDatesSource: "mes" | "transaccion" | null;
  meses: MonthPnl[]; // movimiento mes a mes (vacío = sin data mensual todavía)
};


export type ProjectBizStatus = "activo" | "por_cobrar" | "cerrado";

// "DC25-02", "DC-2501", "DC2601", "DS25-27", "DM 26" → { rubro, year(20YY) }.
// Sin \b final: pegado a más dígitos ("DC-2501") el límite de palabra caía
// entre dos dígitos y no matcheaba. Los primeros 2 dígitos tras el prefijo
// (con separador opcional) son el año.
function parseRubroYear(name: string): { rubro: string; year: number } | null {
  const m = name.match(/\b(D[CMSV])\s*-?\s*(\d{2})/i);
  if (!m) return null;
  return { rubro: m[1].toUpperCase(), year: 2000 + Number(m[2]) };
}

function leafName(fullyQualified: string | null, displayName: string): string {
  if (fullyQualified && fullyQualified.includes(":")) return fullyQualified.split(":").pop()!.trim();
  return displayName;
}

// Solo la LISTA de projects (1 llamada a QBO). Sin financials. La orquestación
// (estado cerrado/abierto + financials de los abiertos) vive en la action.
export async function fetchQboProjectsList(opts?: { year?: number }): Promise<QboProject[]> {
  const { customers } = await fetchQboCustomers();
  const byId = new Map(customers.map((c) => [c.id, c]));

  // Hermanos por padre sobre la lista COMPLETA (todos los años, cerrados
  // incluidos). La guardia anti-rollup necesita saber si el cliente tiene más
  // proyectos en QBO — contarlos solo dentro del subset abierto+año la dejaba
  // ciega en el caso más común (un abierto + varios cerrados/de años previos).
  const hijosPorPadre = new Map<string, number>();
  for (const c of customers) {
    if (c.isProject && c.parentId) hijosPorPadre.set(c.parentId, (hijosPorPadre.get(c.parentId) ?? 0) + 1);
  }

  let projects: QboProject[] = customers
    .filter((c) => c.isProject)
    .map((p) => {
      const ry = parseRubroYear(p.displayName) ?? parseRubroYear(p.fullyQualifiedName ?? "");
      const parent = p.parentId ? byId.get(p.parentId) : null;
      return {
        qboCreatedAt: p.createdAt,
        firstTxnDate: null, // lo llena el P&L mensual y luego lo afina fechas.ts
        lastTxnDate: null,
        txnDatesSource: null,
        meses: [] as MonthPnl[],
        id: p.id,
        name: leafName(p.fullyQualifiedName, p.displayName),
        fullName: p.displayName,
        parentId: p.parentId ?? null,
        siblings: p.parentId ? (hijosPorPadre.get(p.parentId) ?? 1) : 1,
        rubro: ry?.rubro ?? null,
        year: ry?.year ?? null,
        clientName: parent?.displayName ?? "",
        income: null,
        paid: null,
        cost: null,
        margin: null,
        closed: false,
        status: "activo" as ProjectBizStatus,
        progress: null,
        startDate: null,
        endDate: null,
        contractTotal: null,
        quoteNumber: null, // lo aporta el state guardado, no QBO
      };
    });

  if (opts?.year) projects = projects.filter((p) => p.year === opts.year);
  return projects.sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export function marginOf(income: number | null, cost: number | null): number | null {
  if (income === null || cost === null || income <= 0) return null;
  return (income - cost) / income;
}

// ── Rentabilidad por proyecto ────────────────────────────────────────────────
// QBO calcula el Income vs Cost por project. Lo sacamos con get_profit_and_loss
// FILTRADO por customer = el project (cada project es un customer). Una llamada
// por proyecto (chunked); el reporte es el formato estándar de Intuit.
//
// Se pide con summarize_column_by=Month: el reporte trae UNA COLUMNA POR MES
// más la del total, así que la misma llamada que antes daba solo el total ahora
// también dice EN QUÉ MESES hubo movimiento. De ahí salen tres cosas que antes
// se adivinaban: la ventana real del proyecto, el monto que de verdad cae dentro
// de un rango (sumar meses, no prorratear un total anual) y la gráfica por mes.

// Dos P&L son "el mismo" si coinciden los totales — el desglose mensual no
// entra en la comparación porque las guardias anti-rollup razonan sobre totales.
const samePnl = (a: Pnl | null, b: Pnl | null) =>
  !!a && !!b && Math.abs(a.income - b.income) < 0.5 && Math.abs(a.cost - b.cost) < 0.5;

export type FinancialsResult = {
  fin: Map<string, Pnl>;
  // Proyectos donde TODAS las variantes fallaron/no parsearon (transitorio):
  // el caller debe CONSERVAR los números previos, no ponerlos en null.
  errored: Set<string>;
  desde: string; // inicio de la ventana consultada (para saber qué cubre la data)
};

// Ventana del P&L: desde enero del año PASADO hasta hoy. Antes era solo el año
// corriente, y por eso filtrar "Año pasado" en el board devolvía una fracción de
// números del año actual — un dato que se veía plausible y estaba mal.
const ANIOS_ATRAS = 1;

export async function fetchProjectFinancials(
  projects: { id: string; parentId: string | null; siblings?: number }[],
): Promise<FinancialsResult> {
  const out = new Map<string, Pnl>();
  const errored = new Set<string>();
  const year = new Date().getFullYear();
  const start = `${year - ANIOS_ATRAS}-01-01`;
  const end = new Date().toISOString().slice(0, 10);
  if (projects.length === 0) return { fin: out, errored, desde: start };
  const tools = await listQboTools();
  const tool = tools.find((t) => /profit.*loss|profit_loss|\bp_l\b|pnl/i.test(t.name));
  if (!tool) return { fin: out, errored, desde: start };

  const PORMES = { summarize_column_by: "Month" };

  // TODAS las llamadas P&L sobre UNA sola sesión (un handshake, no ~8s de
  // initialize por proyecto) y SECUENCIALES — nada de Promise.all: dos requests
  // a la vez cuelgan el bridge stateful en hosts chicos (un e2-micro). El caller
  // ya sólo manda los proyectos ABIERTOS, así que el lote es acotado.
  await withQboSession(async (call) => {
    const pnlBy = async (extra: Record<string, unknown>): Promise<Pnl | null> => {
      try {
        return parsePnl(await call(tool.name, { params: { start_date: start, end_date: end, ...PORMES, ...extra } }));
      } catch {
        return null;
      }
    };

    // Guardias de contaminación. El gateway, cuando NO puede aislar un proyecto
    // (vacío, o nombre de parámetro que no reconoce), devuelve un rollup mayor:
    //   - el P&L de TODA la empresa (bug: $657k en un proyecto sin gastos), o
    //   - el P&L del CLIENTE PADRE agrupando sus sub-proyectos ($3,038 de Cirion).
    // Precalculamos ambos baselines; cualquier resultado por-proyecto igual a uno
    // de ellos se descarta. La guardia del padre aplica si el cliente tiene >1
    // proyecto EN QBO (todos los años, cerrados incluidos — `siblings`): contarlos
    // solo dentro del subset abierto+año dejaba la guardia ciega en el caso más
    // común (un abierto + cerrados previos) y el rollup del padre se aceptaba.
    const company = await pnlBy({});
    // Sin baseline de empresa no podemos detectar contaminación company-wide.
    // Mejor NO devolver nada: el caller conserva los números previos y el próximo
    // refresh (con baseline) se recupera solo.
    if (!company) {
      for (const p of projects) errored.add(p.id);
      return;
    }
    const parentCount = new Map<string, number>();
    for (const p of projects) {
      if (!p.parentId) continue;
      const enSubset = (parentCount.get(p.parentId) ?? 0) + 1;
      parentCount.set(p.parentId, Math.max(enSubset, p.siblings ?? 0));
    }
    const guardedParents = Array.from(parentCount.entries()).filter(([, n]) => n > 1).map(([pid]) => pid);
    const parentPnl = new Map<string, Pnl | null>();
    for (const pid of guardedParents) parentPnl.set(pid, await pnlBy({ customer: pid }));

    // Un baseline {0,0} no discrimina nada (empresa/cliente sin actividad): un
    // proyecto legítimamente en {0,0} no debe descartarse por "igualar" ese cero.
    const esCero = (x: Pnl | null) => !!x && x.income === 0 && x.cost === 0;

    // Proyectos cuyo P&L igualó al de su cliente en TODAS las variantes. No se
    // decide en el momento: ver abajo por qué hace falta el lote completo.
    const igualaronAlPadre: { id: string; parentId: string; pnl: Pnl }[] = [];

    const one = async (p: { id: string; parentId: string | null; siblings?: number }): Promise<void> => {
      const parentTotal = p.parentId ? parentPnl.get(p.parentId) ?? null : null;
      const variants: Record<string, unknown>[] = [
        { params: { start_date: start, end_date: end, ...PORMES, customer: p.id } },
        { params: { start_date: start, end_date: end, ...PORMES, customer_id: p.id } },
        { start_date: start, end_date: end, ...PORMES, customer: p.id },
      ];
      let algunaParseo = false;
      let comoElPadre: Pnl | null = null;
      for (const variant of variants) {
        let fin: Pnl | null;
        try {
          fin = parsePnl(await call(tool.name, variant));
        } catch {
          continue; // esta variante falló: probar la siguiente
        }
        if (!fin) continue;
        algunaParseo = true;
        // Igual al total de la empresa → el filtro no aisló nada. Descartar.
        if (!esCero(company) && samePnl(fin, company)) continue;
        // Igual al total del cliente: AMBIGUO. Puede ser el rollup del padre o
        // que este proyecto sea toda la actividad del cliente en el período.
        // Se guarda como sospechoso y se sigue probando variantes por si otra
        // sí aísla; si ninguna lo hace, decide el desempate de más abajo.
        if (!esCero(parentTotal) && samePnl(fin, parentTotal)) {
          comoElPadre = fin;
          continue;
        }
        // Resultado filtrado real — incluye {0,0} = proyecto sin actividad (correcto).
        out.set(p.id, fin);
        return;
      }
      if (comoElPadre && p.parentId) {
        igualaronAlPadre.push({ id: p.id, parentId: p.parentId, pnl: comoElPadre });
        return;
      }
      // Nada parseó (red/gateway caído para este proyecto) → transitorio, no
      // "descartado por rollup": conservar los números previos.
      if (!algunaParseo) errored.add(p.id);
    };

    for (const p of projects) await one(p); // secuencial, sobre la misma sesión

    // Desempate del caso ambiguo, ya con el lote completo: ¿CUÁNTOS proyectos
    // del mismo cliente igualaron su total?
    //   - Varios → el filtro no aisló: todos recibieron el mismo rollup del
    //     padre. Contaminación real: se descartan.
    //   - Uno solo → ese proyecto ES toda la actividad del cliente en el
    //     período (lo normal en clientes de un solo proyecto activo), así que el
    //     número es correcto y antes se perdía: se guarda.
    const porPadre = new Map<string, typeof igualaronAlPadre>();
    for (const s of igualaronAlPadre) {
      const l = porPadre.get(s.parentId) ?? [];
      l.push(s);
      porPadre.set(s.parentId, l);
    }
    for (const [, lista] of porPadre) {
      if (lista.length === 1) out.set(lista[0].id, lista[0].pnl);
    }
  });

  return { fin: out, errored, desde: start };
}


// ── Diagnóstico de UN proyecto ───────────────────────────────────────────────
// Cuando un proyecto sale "sin datos de QBO" hay varias razones posibles
// (el gateway no aisló el P&L, la respuesta no parseó, el proyecto está
// cerrado…) y desde afuera se ven igual. Esto corre las MISMAS llamadas que el
// refresh para un solo proyecto y devuelve lo que contestó QBO en cada paso,
// para no tener que adivinar.
export type PnlDiagnostico = {
  proyecto: { id: string; nombre: string; parentId: string | null; siblings: number; cerrado: boolean };
  empresa: Pnl | null;
  cliente: Pnl | null;
  variantes: { args: string; pnl: Pnl | null; error: string | null; veredicto: string }[];
  conclusion: string;
};

export async function diagnosticarPnl(
  qbJobId: string,
  cerrado: boolean,
): Promise<PnlDiagnostico | { error: string }> {
  const lista = await fetchQboProjectsList();
  const p = lista.find((x) => x.id === qbJobId);
  if (!p) return { error: `El proyecto ${qbJobId} no aparece en la lista de QBO (¿lo reconoce como Project?).` };

  const tools = await listQboTools();
  const tool = tools.find((t) => /profit.*loss|profit_loss|\bp_l\b|pnl/i.test(t.name));
  if (!tool) return { error: "El gateway no expone un tool de Profit & Loss." };

  const year = new Date().getFullYear();
  const start = `${year}-01-01`;
  const end = new Date().toISOString().slice(0, 10);

  return withQboSession(async (call) => {
    const pnlDe = async (extra: Record<string, unknown>) => {
      try {
        return parsePnl(await call(tool.name, { params: { start_date: start, end_date: end, ...extra } }));
      } catch {
        return null;
      }
    };
    const empresa = await pnlDe({});
    const cliente = p.parentId ? await pnlDe({ customer: p.parentId }) : null;
    const esCero = (x: Pnl | null) => !!x && x.income === 0 && x.cost === 0;

    const variants: Record<string, unknown>[] = [
      { params: { start_date: start, end_date: end, customer: p.id } },
      { params: { start_date: start, end_date: end, customer_id: p.id } },
      { start_date: start, end_date: end, customer: p.id },
    ];
    const out: PnlDiagnostico["variantes"] = [];
    let aceptada = false;
    let igualóAlCliente = false;
    for (const v of variants) {
      let pnl: Pnl | null = null;
      let error: string | null = null;
      try {
        pnl = parsePnl(await call(tool.name, v));
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      let veredicto: string;
      if (error) veredicto = "la llamada falló";
      else if (!pnl) veredicto = "la respuesta no se pudo interpretar";
      else if (!esCero(empresa) && samePnl(pnl, empresa)) veredicto = "DESCARTADA — igual al total de la empresa";
      else if (!esCero(cliente) && samePnl(pnl, cliente)) {
        veredicto = "igual al total del cliente (ambiguo)";
        igualóAlCliente = true;
      } else {
        veredicto = "ACEPTADA";
        aceptada = true;
      }
      out.push({ args: JSON.stringify(v), pnl, error, veredicto });
      if (aceptada) break;
    }

    const conclusion = cerrado
      ? "El proyecto está marcado CERRADO: el refresh no le consulta números a QBO. Cámbialo a Activo y actualiza."
      : aceptada
        ? "Alguna variante dio un P&L válido: al darle Actualizar debería mostrar números."
        : igualóAlCliente
          ? "Todas las variantes dieron el mismo total que el cliente. Si es el único proyecto del cliente con actividad, el número es correcto y ahora se acepta."
          : !empresa
            ? "No se pudo leer el P&L de la empresa (gateway caído o lento): sin ese baseline el refresh conserva los números previos."
            : "Ninguna variante devolvió un P&L aislado para este proyecto.";

    return {
      proyecto: { id: p.id, nombre: p.fullName, parentId: p.parentId, siblings: p.siblings, cerrado },
      empresa,
      cliente,
      variantes: out,
      conclusion,
    };
  });
}
