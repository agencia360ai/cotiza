import "server-only";
import { fetchQboCustomers } from "./customers";
import { listQboTools, callQboTool, type QboToolResult } from "./mcp";

// Un proyecto en QBO = un customer con IsProject=true (bajo el cliente padre).
export type QboProject = {
  id: string;
  name: string; // nombre limpio (hoja, sin "Padre:")
  fullName: string; // displayName completo
  parentId: string | null; // customer padre en QBO (para detectar rollups)
  rubro: string | null; // DC | DM | DS | DV
  year: number | null;
  clientName: string;
  income: number | null;
  cost: number | null;
  margin: number | null; // 0..1
  closed: boolean; // derivado: status === 'cerrado' → no se re-consulta a QBO
  status: ProjectBizStatus; // status de negocio editable en Reportme
  progress: number | null; // avance manual 0-100 (lo setea el equipo, no QBO)
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

  let projects: QboProject[] = customers
    .filter((c) => c.isProject)
    .map((p) => {
      const ry = parseRubroYear(p.displayName) ?? parseRubroYear(p.fullyQualifiedName ?? "");
      const parent = p.parentId ? byId.get(p.parentId) : null;
      return {
        id: p.id,
        name: leafName(p.fullyQualifiedName, p.displayName),
        fullName: p.displayName,
        parentId: p.parentId ?? null,
        rubro: ry?.rubro ?? null,
        year: ry?.year ?? null,
        clientName: parent?.displayName ?? "",
        income: null,
        cost: null,
        margin: null,
        closed: false,
        status: "activo" as ProjectBizStatus,
        progress: null,
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
type Pnl = { income: number; cost: number };
const samePnl = (a: Pnl | null, b: Pnl | null) =>
  !!a && !!b && Math.abs(a.income - b.income) < 0.5 && Math.abs(a.cost - b.cost) < 0.5;

export async function fetchProjectFinancials(
  projects: { id: string; parentId: string | null }[],
): Promise<Map<string, Pnl>> {
  const out = new Map<string, Pnl>();
  if (projects.length === 0) return out;
  const tools = await listQboTools();
  const tool = tools.find((t) => /profit.*loss|profit_loss|\bp_l\b|pnl/i.test(t.name));
  if (!tool) return out;

  const year = new Date().getFullYear();
  const start = `${year}-01-01`;
  const end = new Date().toISOString().slice(0, 10);
  const pnlBy = async (extra: Record<string, unknown>): Promise<Pnl | null> => {
    try {
      return parsePnl(await callQboTool(tool.name, { params: { start_date: start, end_date: end, ...extra } }));
    } catch {
      return null;
    }
  };

  // Guardias de contaminación. El gateway, cuando NO puede aislar un proyecto
  // (vacío, o nombre de parámetro que no reconoce), devuelve un rollup mayor:
  //   - el P&L de TODA la empresa (bug: $657k en un proyecto sin gastos), o
  //   - el P&L del CLIENTE PADRE agrupando sus sub-proyectos ($3,038 de Cirion).
  // Precalculamos ambos baselines; cualquier resultado por-proyecto igual a uno
  // de ellos se descarta. La guardia del padre SOLO aplica si el cliente tiene
  // >1 proyecto (con un solo proyecto, proyecto==cliente es legítimo).
  const company = await pnlBy({});
  const parentCount = new Map<string, number>();
  for (const p of projects) if (p.parentId) parentCount.set(p.parentId, (parentCount.get(p.parentId) ?? 0) + 1);
  const guardedParents = Array.from(parentCount.entries()).filter(([, n]) => n > 1).map(([pid]) => pid);
  const parentPnl = new Map<string, Pnl | null>();
  for (let i = 0; i < guardedParents.length; i += 3) {
    await Promise.all(guardedParents.slice(i, i + 3).map(async (pid) => parentPnl.set(pid, await pnlBy({ customer: pid }))));
    if (i + 3 < guardedParents.length) await new Promise((r) => setTimeout(r, 200));
  }

  const one = async (p: { id: string; parentId: string | null }): Promise<void> => {
    const parentTotal = p.parentId ? parentPnl.get(p.parentId) ?? null : null;
    const variants: Record<string, unknown>[] = [
      { params: { start_date: start, end_date: end, customer: p.id } },
      { params: { start_date: start, end_date: end, customer_id: p.id } },
      { start_date: start, end_date: end, customer: p.id },
    ];
    for (let vi = 0; vi < variants.length; vi++) {
      let fin: Pnl | null;
      try {
        fin = parsePnl(await callQboTool(tool.name, variants[vi]));
      } catch {
        continue; // esta variante falló: probar la siguiente
      }
      if (!fin) continue;
      // Igual al total de la empresa o del cliente padre → el filtro no aisló
      // este proyecto. Descartar y probar otra variante.
      if (samePnl(fin, company) || samePnl(fin, parentTotal)) continue;
      // Sin baseline de empresa no podemos detectar contaminación company-wide:
      // confiamos solo en la 1ª variante para no estampar rollups desde las demás.
      if (!company && vi > 0) continue;
      // Resultado filtrado real — incluye {0,0} = proyecto sin actividad (correcto).
      out.set(p.id, fin);
      return;
    }
  };

  // Concurrencia baja para no saturar el server: de a 3, con respiro entre tandas.
  for (let i = 0; i < projects.length; i += 3) {
    await Promise.all(projects.slice(i, i + 3).map(one));
    if (i + 3 < projects.length) await new Promise((r) => setTimeout(r, 250));
  }
  return out;
}

type PnlRow = { group?: string; Summary?: { ColData?: { value?: string }[] }; Rows?: { Row?: PnlRow[] } };

// Parser del ProfitAndLoss de QBO (un solo customer/project). Toma los totales
// de las secciones de nivel superior; si hay NetIncome, cost = income - net.
function parsePnl(result: QboToolResult): { income: number; cost: number } | null {
  let json: unknown = result.structuredContent;
  if (json === undefined) {
    const text = (result.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n").trim();
    // El gateway antepone "Profit and Loss Report:" antes del JSON → arrancamos en la "{".
    const start = text.indexOf("{");
    if (start < 0) return null;
    try {
      json = JSON.parse(text.slice(start));
    } catch {
      return null;
    }
  }
  const report = (json as { Report?: unknown }).Report ?? json;
  const rows = ((report as { Rows?: { Row?: PnlRow[] } }).Rows?.Row ?? []) as PnlRow[];

  const total = (r: PnlRow): number => {
    const cd = r.Summary?.ColData ?? [];
    for (let i = cd.length - 1; i >= 0; i--) {
      const raw = cd[i].value ?? "";
      if (!raw) continue;
      // Formato contable "(62.00)" = negativo; el replace pelón perdía el signo.
      const neg = /^\s*\(.*\)\s*$/.test(raw);
      const v = Number(raw.replace(/[^0-9.-]/g, ""));
      if (!Number.isNaN(v)) return neg ? -Math.abs(v) : v;
    }
    return 0;
  };

  let income = 0;
  let cost = 0;
  let net: number | null = null;
  for (const r of rows) {
    const g = (r.group ?? "").toLowerCase();
    if (g === "income") income = total(r);
    else if (g === "netincome") net = total(r);
    else if (g === "cogs" || g === "expenses" || g === "otherexpenses" || g.includes("expense")) cost += total(r);
  }
  if (net !== null && income > 0) return { income, cost: income - net };
  return { income, cost };
}
