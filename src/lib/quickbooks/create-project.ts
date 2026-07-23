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

// El tool `create_customer` del gateway declara este shape EXACTO:
//   { params: { customer: <objeto Customer crudo de la API de QBO> } }
// (additionalProperties:false en ambos niveles). Antes envolvíamos los campos
// solo en `params`, SIN el nivel `customer`, así que el handler leía
// params.customer = undefined y mandaba un body VACÍO a Intuit →
// "SAXParseException; Premature end of file". El objeto interno va en la forma
// cruda de QBO (PascalCase), tal como customers.ts ya los LEE.
function qboCustomerObject(f: CreateFields): Record<string, unknown> {
  const o: Record<string, unknown> = { DisplayName: f.displayName };
  if (f.parentId) {
    // Sub-customer/proyecto: Intuit EXIGE Job=true JUNTO con ParentRef para
    // crearlo como hijo del cliente padre. Con solo ParentRef (sin Job=true) la
    // creación falla. BillWithParent=false: el proyecto se factura por separado.
    o.Job = true;
    o.ParentRef = { value: f.parentId };
    o.BillWithParent = false;
  }
  if (f.email) o.PrimaryEmailAddr = { Address: f.email };
  if (f.notes) o.Notes = f.notes;
  return o;
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

// Core: crea un customer (proyecto o cliente padre). El shape del tool está
// CONFIRMADO ({ params: { customer } }), así que se manda uno solo y se reporta
// el error REAL — nada de variantes que enmascaren el fallo con un "params
// Required" espurio. Ante una respuesta ilegible se VERIFICA por búsqueda antes
// de dar error, para no reportar un fallo cuando el registro sí entró.
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

  const args = { params: { customer: qboCustomerObject(f) } };
  let result: QboToolResult | null = null;
  let err = "";
  try {
    // retries: 0 — un create no es idempotente; ante un fallo la verificación
    // por findByName decide, no un reintento a ciegas.
    result = await callQboTool(tool.name, args, { retries: 0 });
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  if (result) {
    const txt = textoDe(result);
    const created = extractCreatedId(result);
    if (created && !esRechazoDefinitivo(txt)) {
      return { id: created.id, name: created.name ?? f.displayName };
    }
    err = txt || (result.isError ? "el gateway devolvió isError sin detalle" : err);
  }

  // Pudo haberse creado aunque la respuesta no se pudiera leer: verificar por
  // búsqueda antes de dar error.
  const check = await findByName(f.displayName);
  if (check) return check;
  throw new Error(
    `QBO no pudo crear "${f.displayName}" (tool: ${tool.name})${err ? ` — ${err.slice(0, 300)}` : ""}. ` +
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

// Clave de comparación laxa: sin acentos, sin puntuación, minúsculas — para
// emparejar el nombre estandarizado ("Smithsonian Tropical Research Institute")
// con su variante en QBO aunque lleve sufijos o siglas ("… (STRI)").
const matchKey = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Busca un cliente PADRE (primer nivel, no proyecto) ya existente por nombre
// igual o muy parecido. Evita duplicar el cliente cuando el diálogo cae en
// "cliente nuevo" (p.ej. QBO no respondió al sugerir la lista y no se preseleccionó).
async function findParentByName(displayName: string): Promise<{ id: string; name: string } | null> {
  try {
    const { customers } = await fetchQboCustomers();
    const target = matchKey(displayName);
    if (target.length < 3) return null;
    const parents = customers.filter((c) => !c.isProject && !c.parentId);
    const exact = parents.find((c) => matchKey(c.displayName) === target);
    if (exact) return { id: exact.id, name: exact.displayName };
    // Contención fuerte (≥6 chars a cada lado) para tolerar sufijos/siglas sin
    // emparejar nombres cortos por accidente.
    const contained = parents.find((c) => {
      const n = matchKey(c.displayName);
      return n.length >= 6 && target.length >= 6 && (n.includes(target) || target.includes(n));
    });
    return contained ? { id: contained.id, name: contained.displayName } : null;
  } catch {
    return null; // sin lista, que el caller siga el flujo normal (crear)
  }
}

// Resuelve el cliente padre del proyecto: si YA existe en QBO lo REUTILIZA (no
// duplica); solo lo crea si de verdad no está. `created` distingue ambos casos.
export async function resolveOrCreateParent(
  displayName: string,
  email: string | null,
): Promise<{ id: string; name: string; created: boolean }> {
  const found = await findParentByName(displayName.trim());
  if (found) return { ...found, created: false };
  const nuevo = await createQboParentCustomer({ displayName, email });
  return { ...nuevo, created: true };
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
