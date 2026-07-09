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

// Arma el payload según las propiedades REALES del schema del tool. Cada campo
// se manda solo si el tool lo declara — así no rompemos gateways estrictos.
function buildCreateArgs(schema: unknown, input: QboProjectInput): Record<string, unknown> {
  const top = (schema as JsonSchema | undefined)?.properties ?? {};
  const paramsSchema = top.params;
  const wrap = !!paramsSchema && (paramsSchema.type === "object" || !!paramsSchema.properties);
  const props = (wrap ? paramsSchema!.properties : top) ?? {};
  const has = (k: string) => k in props;
  const inner: Record<string, unknown> = {};

  // Nombre
  let named = false;
  for (const k of ["DisplayName", "displayName", "display_name", "name", "Name"]) {
    if (has(k)) {
      inner[k] = input.displayName;
      named = true;
      break;
    }
  }
  if (!named) inner.DisplayName = input.displayName;

  // Padre (sub-customer). QBO API usa ParentRef:{value}; gateways sueltos usan
  // parentId/parent_id/customerId.
  if (has("ParentRef")) inner.ParentRef = { value: input.parentId };
  else if (has("parentRef")) inner.parentRef = { value: input.parentId };
  else if (has("parent_id")) inner.parent_id = input.parentId;
  else if (has("parentId")) inner.parentId = input.parentId;
  else if (has("customer_id")) inner.customer_id = input.parentId;
  else inner.ParentRef = { value: input.parentId };

  // Marca de sub-customer/proyecto (solo si el schema los declara).
  if (has("Job")) inner.Job = true;
  if (has("job")) inner.job = true;
  if (has("IsProject")) inner.IsProject = true;
  if (has("is_project")) inner.is_project = true;
  // BillWithParent explícito en false: el proyecto factura por sí mismo.
  if (has("BillWithParent")) inner.BillWithParent = false;

  if (input.email) {
    if (has("PrimaryEmailAddr")) inner.PrimaryEmailAddr = { Address: input.email };
    else if (has("email")) inner.email = input.email;
    else if (has("Email")) inner.Email = input.email;
  }

  // Notas: el tool puede llamarlas Notes/notes/description. Las fechas de QBO
  // Projects (start/end) rara vez existen en un create-customer: si el schema
  // no las tiene, van dentro de las notas para no perder la info.
  const fechasTxt = [
    input.startDate ? `Inicio: ${input.startDate}` : null,
    input.endDate ? `Entrega: ${input.endDate}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  let fechasEnCampo = false;
  for (const [k, v] of [
    ["StartDate", input.startDate],
    ["start_date", input.startDate],
    ["EndDate", input.endDate],
    ["end_date", input.endDate],
  ] as const) {
    if (v && has(k)) {
      inner[k] = v;
      fechasEnCampo = true;
    }
  }
  const notas = [input.notes, fechasEnCampo ? null : fechasTxt || null].filter(Boolean).join("\n");
  if (notas) {
    if (has("Notes")) inner.Notes = notas;
    else if (has("notes")) inner.notes = notas;
    else if (has("description")) inner.description = notas;
    else inner.Notes = notas;
  }

  return wrap ? { params: inner } : inner;
}

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

export async function createQboProject(input: QboProjectInput): Promise<{ id: string; name: string }> {
  const tools = await listQboTools();
  const tool = pickCreateTool(tools);
  if (!tool) {
    throw new Error(
      "El gateway de QBO no expone un tool para crear customers/proyectos. " +
        "Setea QBO_CREATE_CUSTOMER_TOOL en Vercel con el nombre del tool correcto.",
    );
  }
  const result = await callQboTool(tool.name, buildCreateArgs(tool.inputSchema, input));
  if (result.isError) {
    const txt = (result.content ?? []).map((c) => c.text ?? "").join(" ").slice(0, 300);
    throw new Error(`QBO rechazó la creación: ${txt || "error del gateway"}`);
  }
  const created = extractCreatedId(result);
  if (!created) {
    const txt = (result.content ?? []).map((c) => c.text ?? "").join(" ").slice(0, 300);
    throw new Error(`QBO no devolvió el Id del proyecto creado${txt ? ` — respuesta: ${txt}` : ""}.`);
  }
  return { id: created.id, name: created.name ?? input.displayName };
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
