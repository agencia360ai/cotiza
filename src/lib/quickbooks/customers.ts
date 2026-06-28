// Trae los customers de QuickBooks vía el gateway MCP y los normaliza a una
// forma estable, sin depender del nombre exacto del tool (hay 144). Estrategia:
//   1. QBO_CUSTOMERS_TOOL (override explícito) si está seteado.
//   2. Descubrir por nombre: list/query/get/search *customer*.
//   3. Fallback a un tool de query genérico con "SELECT * FROM Customer".
// Mapea los campos estándar del Customer de Intuit, defensivo ante variantes.

import { listQboTools, callQboTool, extractJson, type QboTool } from "./mcp";

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
  fullyQualifiedName: string | null; // "Padre:Hijo"
};

export type FetchResult = {
  customers: QboCustomer[];
  toolUsed: string | null;
  rawCount: number;
};

const NAME_RE = /customer|client/i;
const LIST_RE = /list|query|get|search|all|read/i;
const QUERY_RE = /^(query|run_query|sql|read_query|qbo_query|company_query)$/i;

function pickCustomerTool(tools: QboTool[]): { tool: string; kind: "list" | "query" } | null {
  const override = process.env.QBO_CUSTOMERS_TOOL;
  if (override) {
    const isQuery = QUERY_RE.test(override) || /query/i.test(override);
    return { tool: override, kind: isQuery ? "query" : "list" };
  }
  const names = tools.map((t) => t.name);
  // Preferencia: un tool dedicado a listar customers.
  const dedicated = names.find((n) => NAME_RE.test(n) && LIST_RE.test(n));
  if (dedicated) return { tool: dedicated, kind: "list" };
  // Un tool llamado simplemente "customers".
  const plain = names.find((n) => /^customers?$/i.test(n));
  if (plain) return { tool: plain, kind: "list" };
  // Fallback: tool de query genérico.
  const query = names.find((n) => QUERY_RE.test(n));
  if (query) return { tool: query, kind: "query" };
  return null;
}

// Distintos argumentos según el tool, probando los nombres comunes.
function argsForList(): Record<string, unknown> {
  return { limit: 1000, maxResults: 1000, max_results: 1000, active: true };
}
function argsForQuery(): Record<string, unknown> {
  const sql = "SELECT * FROM Customer MAXRESULTS 1000";
  return { query: sql, sql, statement: sql, q: sql };
}

function asArray(json: unknown): Record<string, unknown>[] {
  if (json == null) return [];
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  if (typeof json !== "object") return [];
  const o = json as Record<string, unknown>;
  // Forma cruda de Intuit: { QueryResponse: { Customer: [...] } }
  const qr = o.QueryResponse as Record<string, unknown> | undefined;
  if (qr && Array.isArray(qr.Customer)) return qr.Customer as Record<string, unknown>[];
  // Wrappers comunes.
  for (const key of ["customers", "Customer", "data", "items", "results", "value"]) {
    if (Array.isArray(o[key])) return o[key] as Record<string, unknown>[];
  }
  // Objeto único que parece un customer.
  if (o.Id || o.id || o.DisplayName || o.displayName) return [o];
  return [];
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
  const parentId =
    nested(raw, "ParentRef", "value") ?? nested(raw, "parentRef", "value") ?? str(raw.ParentRef) ?? str(raw.parentId) ?? null;
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
    parentId,
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
  const result = await callQboTool(pick.tool, pick.kind === "query" ? argsForQuery() : argsForList());
  const json = extractJson(result);
  const rawList = asArray(json);
  const customers = rawList.map(mapCustomer).filter((c): c is QboCustomer => c !== null);
  return { customers, toolUsed: pick.tool, rawCount: rawList.length };
}
