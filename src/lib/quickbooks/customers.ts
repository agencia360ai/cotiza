// Trae los customers de QuickBooks vía el gateway MCP y los normaliza a una
// forma estable, sin depender del nombre exacto del tool (hay 144). Estrategia:
//   1. QBO_CUSTOMERS_TOOL (override explícito) si está seteado.
//   2. Descubrir por nombre con scoring (search/list/query *customers*).
//   3. Fallback a un tool de query genérico ("SELECT * FROM Customer").
// Arma los argumentos según el inputSchema del tool (algunos esperan { params: … }).
// Parseo robusto: structuredContent, array JSON, { QueryResponse:{Customer} }, o el
// blob de texto "Found N customers:{…}{…}" que devuelve este server.

import { listQboTools, callQboTool, type QboTool, type QboToolResult } from "./mcp";

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
    const sql = "SELECT * FROM Customer MAXRESULTS 1000";
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

// Extrae objetos {…} de nivel superior de un blob (ignora llaves dentro de strings).
function parseConcatenatedObjects(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          out.push(JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>);
        } catch {
          /* objeto incompleto */
        }
        start = -1;
      }
    }
  }
  return out;
}

function digArray(json: unknown): Record<string, unknown>[] {
  if (json == null || typeof json !== "object") return [];
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  const o = json as Record<string, unknown>;
  const qr = o.QueryResponse as Record<string, unknown> | undefined;
  if (qr && Array.isArray(qr.Customer)) return qr.Customer as Record<string, unknown>[];
  for (const key of ["customers", "Customer", "data", "items", "results", "value"]) {
    if (Array.isArray(o[key])) return o[key] as Record<string, unknown>[];
  }
  if (o.Id || o.id || o.DisplayName || o.displayName) return [o];
  return [];
}

// Saca la lista de customers del tool result, probando todas las formas.
function extractCustomers(result: QboToolResult): Record<string, unknown>[] {
  if (result.structuredContent !== undefined) {
    const a = digArray(result.structuredContent);
    if (a.length) return a;
  }
  const text = (result.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("\n")
    .trim();
  if (!text) return [];
  try {
    const a = digArray(JSON.parse(text));
    if (a.length) return a;
  } catch {
    /* no es JSON limpio: cae al scanner */
  }
  return parseConcatenatedObjects(text);
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}
function nested(o: Record<string, unknown>, a: string, b: string): string | null {
  const x = o[a] as Record<string, unknown> | undefined;
  return x ? str(x[b]) : null;
}

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
  const isProject = Boolean(raw.IsProject ?? raw.isProject ?? raw.Job ?? raw.job ?? false);
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
    fullyQualifiedName: str(raw.FullyQualifiedName) ?? str(raw.fullyQualifiedName),
  };
}

export async function fetchQboCustomers(): Promise<FetchResult> {
  const tools = await listQboTools();
  const pick = pickCustomerTool(tools);
  if (!pick) {
    throw new Error(
      `No encontré un tool de customers entre ${tools.length} tools. ` +
        `Seteá QBO_CUSTOMERS_TOOL con el nombre correcto. Tools: ${tools.map((t) => t.name).slice(0, 40).join(", ")}`,
    );
  }
  const result = await callQboTool(pick.tool, buildArgs(pick.schema, pick.kind));
  const rawList = extractCustomers(result);
  const customers = rawList.map(mapCustomer).filter((c): c is QboCustomer => c !== null);
  return { customers, toolUsed: pick.tool, rawCount: rawList.length };
}
