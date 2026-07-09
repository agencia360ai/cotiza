import "server-only";
import { listQboTools, callQboTool, type QboTool, type QboToolResult } from "./mcp";
import { fetchQboCustomers, type QboCustomer } from "./customers";

// Crear un PROYECTO en QuickBooks desde una cotización aprobada. En QBO un
// proyecto es un sub-customer (Job/IsProject) bajo el cliente padre. Misma
// estrategia adaptativa que customers.ts: descubrir el tool de crear customer
// por nombre + armar los args según su inputSchema (con QBO_CREATE_CUSTOMER_TOOL
// como override explícito). Si el gateway no expone un tool de creación, se
// devuelve un error claro — nunca se marca nada como enviado sin un Id real.

const CREATE_RE = /(create|add|new)[-_]?customer|customer[-_]?(create|add)/i;

function pickCreateTool(tools: QboTool[]): QboTool | null {
  const override = process.env.QBO_CREATE_CUSTOMER_TOOL;
  if (override) return tools.find((t) => t.name === override) ?? null;
  let best: { t: QboTool; s: number } | null = null;
  for (const t of tools) {
    if (!CREATE_RE.test(t.name)) continue;
    if (/sub[-_]?customer|payment|invoice|estimate|memo/i.test(t.name) && !/customer/i.test(t.name)) continue;
    let s = 1;
    if (/^create[-_]customer$/i.test(t.name)) s += 3;
    if (/customer/i.test(t.name)) s += 1;
    if (!best || s > best.s) best = { t, s };
  }
  return best?.t ?? null;
}

type JsonSchema = { type?: string; properties?: Record<string, JsonSchema> };

export type QboProjectInput = {
  displayName: string; // "DC26-08 Instalación … - STRI"
  parentId: string; // customer padre en QBO
  parentName: string; // para FullyQualifiedName-style fallbacks
  email: string | null;
  notes: string | null; // notas + fechas que el tool no soporte van acá
  startDate: string | null; // YYYY-MM-DD (best-effort: solo si el schema lo tiene)
  endDate: string | null;
};

type CreateFields = {
  displayName: string;
  parentId: string | null; // null = cliente padre de primer nivel
  email: string | null;
  notes: string | null;
};

// Variante 1: guiada por el schema del tool (cada campo solo si está declarado).
function argsFromSchema(schema: unknown, f: CreateFields): Record<string, unknown> {
  const top = (schema as JsonSchema | undefined)?.properties ?? {};
  const paramsSchema = top.params;
  const wrap = !!paramsSchema && (paramsSchema.type === "object" || !!paramsSchema.properties);
  const props = (wrap ? paramsSchema!.properties : top) ?? {};
  const has = (k: string) => k in props;
  const inner: Record<string, unknown> = {};

  let named = false;
  for (const k of ["DisplayName", "displayName", "display_name", "name", "Name"]) {
    if (has(k)) {
      inner[k] = f.displayName;
      named = true;
      break;
    }
  }
  if (!named) inner.DisplayName = f.displayName;

  if (f.parentId) {
    if (has("ParentRef")) inner.ParentRef = { value: f.parentId };
    else if (has("parentRef")) inner.parentRef = { value: f.parentId };
    else if (has("parent_id")) inner.parent_id = f.parentId;
    else if (has("parentId")) inner.parentId = f.parentId;
    else if (has("customer_id")) inner.customer_id = f.parentId;
    else inner.ParentRef = { value: f.parentId };
    if (has("Job")) inner.Job = true;
    if (has("job")) inner.job = true;
    if (has("IsProject")) inner.IsProject = true;
    if (has("is_project")) inner.is_project = true;
    if (has("BillWithParent")) inner.BillWithParent = false;
  }
  if (f.email) {
    if (has("PrimaryEmailAddr")) inner.PrimaryEmailAddr = { Address: f.email };
    else if (has("email")) inner.email = f.email;
    else if (has("Email")) inner.Email = f.email;
  }
  if (f.notes) {
    if (has("Notes")) inner.Notes = f.notes;
    else if (has("notes")) inner.notes = f.notes;
    else if (has("description")) inner.description = f.notes;
    else inner.Notes = f.notes;
  }
  return wrap ? { params: inner } : inner;
}

// Variante 2: shape del API de QBO (Customer object puro).
function argsQboApi(f: CreateFields): Record<string, unknown> {
  const o: Record<string, unknown> = { DisplayName: f.displayName };
  if (f.parentId) {
    o.ParentRef = { value: f.parentId };
    o.Job = true;
    o.BillWithParent = false;
  }
  if (f.email) o.PrimaryEmailAddr = { Address: f.email };
  if (f.notes) o.Notes = f.notes;
  return o;
}

// Variante 3: camelCase plano (wrappers Node típicos). Para el padre se mandan
// varias claves redundantes — los servers ignoran las desconocidas y con que
// una aterrice el proyecto queda colgado del cliente correcto.
function argsCamel(f: CreateFields): Record<string, unknown> {
  const o: Record<string, unknown> = { displayName: f.displayName };
  if (f.parentId) {
    o.parentId = f.parentId;
    o.parentRef = { value: f.parentId };
    o.parent_id = f.parentId;
    o.job = true;
  }
  if (f.email) o.email = f.email;
  if (f.notes) o.notes = f.notes;
  return o;
}

// Escalera de payloads: schema-driven primero, después los shapes conocidos,
// cada uno directo y envuelto en {params}. Deduplicadas por contenido.
function buildVariants(schema: unknown, f: CreateFields): Record<string, unknown>[] {
  const raw = [argsFromSchema(schema, f), argsQboApi(f), argsCamel(f)];
  const all: Record<string, unknown>[] = [];
  for (const a of raw) {
    all.push(a);
    if (!("params" in a)) all.push({ params: a });
  }
  const seen = new Set<string>();
  return all.filter((a) => {
    const k = JSON.stringify(a);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ¿El error del gateway es un RECHAZO definitivo de QBO (no se creó nada)?
// "SAXParseException / Premature end of file" = el body llegó vacío a QBO →
// el shape de args era el equivocado; reintentar con la siguiente variante es
// SEGURO porque QBO rechazó la operación.
function esRechazoDefinitivo(txt: string): boolean {
  return /premature end of file|unsupported operation|validationfault|saxparse|invalid_request|bad request|required param|missing/i.test(
    txt,
  );
}

function textoDe(result: QboToolResult): string {
  return (result.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join(" ")
    .trim();
}

const normName = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

// Saca el Id del customer creado, probando todas las formas de respuesta.
function extractCreatedId(result: QboToolResult): { id: string; name: string | null } | null {
  const dig = (json: unknown): { id: string; name: string | null } | null => {
    if (json == null || typeof json !== "object") return null;
    const o = json as Record<string, unknown>;
    const c = (o.Customer ?? o.customer ?? o) as Record<string, unknown>;
    const id = c.Id ?? c.id;
    if (id != null && String(id).trim()) {
      return { id: String(id).trim(), name: (c.DisplayName ?? c.displayName ?? null) as string | null };
    }
    for (const v of Object.values(o)) {
      if (v && typeof v === "object") {
        const r = dig(v);
        if (r) return r;
      }
    }
    return null;
  };
  if (result.structuredContent !== undefined) {
    const r = dig(result.structuredContent);
    if (r) return r;
  }
  const text = (result.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("\n")
    .trim();
  if (!text) return null;
  const start = text.indexOf("{");
  if (start >= 0) {
    try {
      const r = dig(JSON.parse(text.slice(start)));
      if (r) return r;
    } catch {
      /* no era JSON limpio */
    }
  }
  // Último recurso: "Id: 123" / "id 123" en el texto.
  const m = text.match(/\bid["\s:]+(\d+)/i);
  return m ? { id: m[1], name: null } : null;
}

// Busca un customer por nombre exacto (normalizado). Se usa como guard de
// idempotencia (reintento tras un fallo a medias) y como verificación cuando
// la respuesta del gateway no se pudo parsear.
async function findByName(displayName: string): Promise<{ id: string; name: string } | null> {
  try {
    const { customers } = await fetchQboCustomers();
    const target = normName(displayName);
    const hit = customers.find((c) => normName(c.displayName) === target);
    return hit ? { id: hit.id, name: hit.displayName } : null;
  } catch {
    return null; // sin lista no hay verificación — el caller decide
  }
}

// Core: crea un customer (proyecto o cliente padre) probando variantes de
// payload. El "Premature end of file" de QBO significa que el body llegó VACÍO
// (shape de args equivocado → QBO rechazó): reintentar con otra variante es
// seguro. Ante una respuesta ambigua (sin Id y sin rechazo claro) se VERIFICA
// por búsqueda antes de reintentar — jamás se crean duplicados a ciegas.
async function createQboCustomer(f: CreateFields): Promise<{ id: string; name: string }> {
  const tools = await listQboTools();
  const tool = pickCreateTool(tools);
  if (!tool) {
    throw new Error(
      "El gateway de QBO no expone un tool para crear customers/proyectos. " +
        "Setea QBO_CREATE_CUSTOMER_TOOL en Vercel con el nombre del tool correcto.",
    );
  }

  // Idempotencia: si YA existe con ese nombre exacto (reintento después de un
  // fallo a medias), usarlo en vez de duplicar.
  const existing = await findByName(f.displayName);
  if (existing) return existing;

  const variants = buildVariants(tool.inputSchema, f);
  let lastErr = "";
  for (const args of variants) {
    let result: QboToolResult;
    try {
      result = await callQboTool(tool.name, args);
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      continue; // error de transporte: probar la siguiente variante
    }
    const txt = textoDe(result);
    const created = extractCreatedId(result);
    if (created && !esRechazoDefinitivo(txt)) {
      return { id: created.id, name: created.name ?? f.displayName };
    }
    if (esRechazoDefinitivo(txt) || result.isError) {
      lastErr = txt || "error del gateway";
      continue; // QBO rechazó la operación → nada creado → siguiente shape
    }
    // Ambiguo (sin Id y sin rechazo reconocible): pudo haberse creado —
    // verificar por búsqueda antes de intentar otra variante.
    lastErr = txt || lastErr;
    const check = await findByName(f.displayName);
    if (check) return check;
  }

  // Última verificación (por si la creación entró pero ninguna respuesta se
  // pudo leer) y error detallado con lo que dijo el gateway.
  const final = await findByName(f.displayName);
  if (final) return final;
  throw new Error(
    `QBO no aceptó la creación con ningún formato de argumentos${lastErr ? ` — último error: ${lastErr.slice(0, 250)}` : ""}. ` +
      "Si el tool correcto es otro, setea QBO_CREATE_CUSTOMER_TOOL en Vercel.",
  );
}

export async function createQboProject(input: QboProjectInput): Promise<{ id: string; name: string }> {
  // Las fechas van dentro de las notas (el create-customer de QBO no tiene
  // campos de fechas de proyecto); en Reportme quedan como columnas propias.
  const fechasTxt = [
    input.startDate ? `Inicio: ${input.startDate}` : null,
    input.endDate ? `Entrega: ${input.endDate}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const notes = [input.notes, fechasTxt || null].filter(Boolean).join("\n") || null;
  return createQboCustomer({ displayName: input.displayName, parentId: input.parentId, email: input.email, notes });
}

// Cliente padre nuevo en QBO (cuando el cliente de la cotización todavía no
// existe): customer de primer nivel; el proyecto se cuelga después.
export async function createQboParentCustomer(input: { displayName: string; email: string | null }): Promise<{ id: string; name: string }> {
  return createQboCustomer({ displayName: input.displayName.trim(), parentId: null, email: input.email, notes: null });
}

// ── Próximo número de contrato (DC26-08, DM26-15…) ───────────────────────────
// El correlativo REAL vive en los nombres de los proyectos de QBO. Cubre los
// dos formatos que usa DICEC: "DC26-07 …" y "DC-2607 …".
export function parseContractSeq(name: string, rubro: string, yy: string): number | null {
  const esc = rubro.toUpperCase();
  let m = name.toUpperCase().match(new RegExp(`\\b${esc}\\s*${yy}\\s*-\\s*(\\d{1,3})\\b`));
  if (m) return parseInt(m[1], 10);
  m = name.toUpperCase().match(new RegExp(`\\b${esc}\\s*-\\s*${yy}(\\d{2})\\b`));
  if (m) return parseInt(m[1], 10);
  return null;
}

export type NextNumber = { numero: string; maxSeq: number; base: number };

export function nextContractNumber(names: string[], rubro: string, year: number): NextNumber {
  const yy = String(year).slice(2);
  let max = 0;
  for (const n of names) {
    const s = parseContractSeq(n, rubro, yy);
    if (s !== null && s > max) max = s;
  }
  return { numero: `${rubro.toUpperCase()}${yy}-${String(max + 1).padStart(2, "0")}`, maxSeq: max, base: max + 1 };
}

export type QboParentOption = { id: string; name: string };

// Sugerencia en vivo: lista de QBO (autoridad del correlativo) + clientes padre
// para elegir a quién colgarle el proyecto.
export async function suggestFromQbo(
  rubro: string,
  year: number,
): Promise<{ numero: NextNumber; parents: QboParentOption[]; projectNames: string[] }> {
  const { customers } = await fetchQboCustomers();
  const projectNames = customers.filter((c: QboCustomer) => c.isProject).map((c) => c.displayName);
  const parents = customers
    .filter((c) => !c.isProject && c.active)
    .map((c) => ({ id: c.id, name: c.displayName }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { numero: nextContractNumber(projectNames, rubro, year), parents, projectNames };
}
