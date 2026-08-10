// Trae los customers de QuickBooks vía el gateway MCP y los normaliza a una
// forma estable, sin depender del nombre exacto del tool (hay 144). Estrategia:
//   1. QBO_CUSTOMERS_TOOL (override explícito) si está seteado.
//   2. Descubrir por nombre con scoring (search/list/query *customers*).
//   3. Fallback a un tool de query genérico ("SELECT * FROM Customer").
// Arma los argumentos según el inputSchema del tool (algunos esperan { params: … }).
// Parseo robusto: structuredContent, array JSON, { QueryResponse:{Customer} }, o el
// blob de texto "Found N customers:{…}{…}" que devuelve este server.

import { listQboTools, callQboTool, type QboTool, type QboToolResult } from "./mcp";
import { extractEntities, nested, str, toIsoDate } from "./parse";

export type QboCustomer = {
  id: string;
  displayName: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  contactName: string | null;
  active: boolean;
  parentId: string | null; // sub-customer/job → id del padre
  isProject: boolean; // QBO "IsProject"/"Job": es un proyecto, no una sucursal
  fullyQualifiedName: string | null; // "Padre:Hijo"
  createdAt: string | null; // MetaData.CreateTime → cuándo se abrió en QBO
};

export type FetchResult = {
  customers: QboCustomer[];
  toolUsed: string | null;
  rawCount: number;
};

const NAME_RE = /customer|client/i;
const QUERY_RE = /^(query|run_query|sql|read_query|qbo_query|company_query)$/i;

type Pick = { tool: string; kind: "list" | "query"; schema: unknown };

// Prioriza search/list/query plural por sobre get singular y excluye mutaciones.
function scoreToolName(n: string): number {
  if (!NAME_RE.test(n)) return -1;
  if (/create|update|delete|add|remove|new/i.test(n)) return -1;
  let s = 0;
  if (/customers/i.test(n)) s += 3;
  else s += 1;
  if (/search/i.test(n)) s += 3;
  if (/list/i.test(n)) s += 3;
  if (/query/i.test(n)) s += 2;
  if (/all/i.test(n)) s += 1;
  if (/\bget\b|^get[_-]/i.test(n)) s -= 2; // get singular = una entidad
  return s;
}

function pickCustomerTool(tools: QboTool[]): Pick | null {
  const override = process.env.QBO_CUSTOMERS_TOOL;
  if (override) {
    const t = tools.find((x) => x.name === override);
    const isQuery = QUERY_RE.test(override) || /query/i.test(override);
    return { tool: override, kind: isQuery ? "query" : "list", schema: t?.inputSchema };
  }
  let best: { t: QboTool; s: number } | null = null;
  for (const t of tools) {
    const s = scoreToolName(t.name);
    if (s > 0 && (!best || s > best.s)) best = { t, s };
  }
  if (best) return { tool: best.t.name, kind: "list", schema: best.t.inputSchema };
  const q = tools.find((t) => QUERY_RE.test(t.name));
  if (q) return { tool: q.name, kind: "query", schema: q.inputSchema };
  return null;
}

type JsonSchema = { type?: string; properties?: Record<string, JsonSchema> };

// Arma args según el schema: si hay un objeto `params`, los anida ahí.
function buildArgs(schema: unknown, kind: "list" | "query"): Record<string, unknown> {
  const top = (schema as JsonSchema | undefined)?.properties ?? {};
  const paramsSchema = top.params;
  const wrap = !!paramsSchema && (paramsSchema.type === "object" || !!paramsSchema.properties);
  const props = (wrap ? paramsSchema!.properties : top) ?? {};
  const has = (k: string) => k in props;
  const inner: Record<string, unknown> = {};

  if (kind === "query") {
    const sql = buildCustomerSql(1);
    let placed = false;
    for (const k of ["query", "sql", "statement", "q"]) if (has(k)) (inner[k] = sql), (placed = true);
    if (!placed) inner.query = sql;
  } else {
    if (has("fetchAll")) inner.fetchAll = true;
    else if (has("limit")) inner.limit = 1000;
    else if (has("maxResults")) inner.maxResults = 1000;
    else if (has("max_results")) inner.max_results = 1000;
    if (Object.keys(props).length === 0) {
      inner.fetchAll = true; // sin schema: probar lo más común
      inner.limit = 1000;
    }
  }
  return wrap ? { params: inner } : inner;
}

const extractCustomers = (result: QboToolResult) => extractEntities(result, "Customer");

// Un proyecto de DICEC SIEMPRE se llama con el correlativo "DM26-16" / "DC-2607".
// Sirve de respaldo para reconocerlo cuando QBO no expone la bandera: el campo
// IsProject solo viaja si la API se llama con un minorVersion suficiente, así que
// un proyecto creado en la sección Projects puede llegar SIN IsProject ni Job y
// quedaría invisible (y peor: fuera del cálculo del próximo correlativo, que
// entonces repetiría un número). Exige dígitos DESPUÉS del año para no confundir
// con un cliente que casualmente empiece por esas letras.
const RE_CORRELATIVO = /\bD[CMSV]\s*-?\s*\d{2}\s*-\s*\d/i;

function mapCustomer(raw: Record<string, unknown>): QboCustomer | null {
  const id = str(raw.Id) ?? str(raw.id);
  if (!id) return null;
  const displayName =
    str(raw.DisplayName) ?? str(raw.displayName) ?? str(raw.Name) ?? str(raw.name) ?? str(raw.FullyQualifiedName) ?? `QBO ${id}`;
  const email =
    nested(raw, "PrimaryEmailAddr", "Address") ?? nested(raw, "primaryEmailAddr", "address") ?? str(raw.Email) ?? str(raw.email);
  const phone =
    nested(raw, "PrimaryPhone", "FreeFormNumber") ?? nested(raw, "primaryPhone", "freeFormNumber") ?? str(raw.Phone) ?? str(raw.phone);
  const mobile = nested(raw, "Mobile", "FreeFormNumber") ?? nested(raw, "mobile", "freeFormNumber");
  const given = str(raw.GivenName) ?? str(raw.givenName);
  const family = str(raw.FamilyName) ?? str(raw.familyName);
  const contactName = [given, family].filter(Boolean).join(" ") || null;
  const parentId = nested(raw, "ParentRef", "value") ?? nested(raw, "parentRef", "value") ?? str(raw.ParentRef) ?? str(raw.parentId);
  const fullyQualifiedName = str(raw.FullyQualifiedName) ?? str(raw.fullyQualifiedName);
  // Bandera de QBO y, si no viene, el nombre: un sub-cliente llamado con el
  // correlativo ("DM26-16 …") es un proyecto, no una sucursal.
  const nombreHoja = fullyQualifiedName?.includes(":") ? fullyQualifiedName.split(":").pop()!.trim() : displayName;
  const isProject =
    Boolean(raw.IsProject ?? raw.isProject ?? raw.Job ?? raw.job ?? false) || (!!parentId && RE_CORRELATIVO.test(nombreHoja));
  const activeRaw = raw.Active ?? raw.active;
  return {
    id,
    displayName,
    companyName: str(raw.CompanyName) ?? str(raw.companyName),
    email,
    phone,
    mobile,
    contactName,
    active: activeRaw === undefined ? true : Boolean(activeRaw),
    parentId: parentId ?? null,
    isProject,
    fullyQualifiedName,
    // Cuándo se abrió el proyecto en QuickBooks. Es la única fecha propia del
    // proyecto que la API REST expone (las de la sección Projects viven en la
    // API GraphQL, que pide acceso de partner).
    createdAt: toIsoDate(nested(raw, "MetaData", "CreateTime") ?? nested(raw, "metaData", "createTime")),
  };
}

const QBO_PAGE = 1000;
function buildCustomerSql(startPosition: number): string {
  return `SELECT * FROM Customer STARTPOSITION ${startPosition} MAXRESULTS ${QBO_PAGE}`;
}

// Reemplaza el SQL dentro de los args ya armados (respetando el wrap `params`).
function withSql(args: Record<string, unknown>, sql: string): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...args };
  const target = (clone.params as Record<string, unknown> | undefined) ?? clone;
  const inner = target === clone ? clone : { ...(clone.params as Record<string, unknown>) };
  for (const k of ["query", "sql", "statement", "q"]) if (k in inner) inner[k] = sql;
  if (target !== clone) clone.params = inner;
  return clone;
}

export async function fetchQboCustomers(): Promise<FetchResult> {
  const tools = await listQboTools();
  const pick = pickCustomerTool(tools);
  if (!pick) {
    throw new Error(
      `No encontré un tool de customers entre ${tools.length} tools. ` +
        `Setea QBO_CUSTOMERS_TOOL con el nombre correcto. Tools: ${tools.map((t) => t.name).slice(0, 40).join(", ")}`,
    );
  }
  const baseArgs = buildArgs(pick.schema, pick.kind);
  const result = await callQboTool(pick.tool, baseArgs);
  let rawList = extractCustomers(result);

  // PAGINACIÓN: QBO corta en 1000 por query. Pasado ese punto, los proyectos
  // más nuevos (Id más alto) desaparecerían del listado y el reconcile borraría
  // sus filas. En modo query se pagina con STARTPOSITION; en modo list, si el
  // primer call topó el cap, se completa con el tool de query paginado.
  if (rawList.length >= QBO_PAGE) {
    const seen = new Set(rawList.map((r) => String(r.Id ?? r.id ?? "")));
    const queryTool = pick.kind === "query" ? pick : (() => {
      const q = tools.find((t) => QUERY_RE.test(t.name));
      return q ? { tool: q.name, kind: "query" as const, schema: q.inputSchema } : null;
    })();
    if (queryTool) {
      const qArgs = queryTool === pick ? baseArgs : buildArgs(queryTool.schema, "query");
      for (let pos = QBO_PAGE + 1, page = 0; page < 30; pos += QBO_PAGE, page++) {
        let batch: Record<string, unknown>[] = [];
        try {
          batch = extractCustomers(await callQboTool(queryTool.tool, withSql(qArgs, buildCustomerSql(pos))));
        } catch {
          break; // paginación best-effort: con lo que hay
        }
        const nuevos = batch.filter((r) => !seen.has(String(r.Id ?? r.id ?? "")));
        for (const r of nuevos) seen.add(String(r.Id ?? r.id ?? ""));
        rawList = rawList.concat(nuevos);
        if (batch.length < QBO_PAGE) break;
      }
    }
  }

  const customers = rawList.map(mapCustomer).filter((c): c is QboCustomer => c !== null);
  return { customers, toolUsed: pick.tool, rawCount: rawList.length };
}
