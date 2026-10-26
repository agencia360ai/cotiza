import "server-only";
import { listQboTools, withQboSession, QboTransportError, type QboToolResult } from "./mcp";
import { extractEntities } from "./parse";
import { emparejar, palabras, partirHoras, type PersonaQbo, type TipoQbo } from "./personas-core";

// Horas de técnicos cargadas desde la app: se crean en QuickBooks como el
// mismo registro de tiempo (Time Activity) que se cargaba a mano. QuickBooks
// les pone solo el costo por hora del empleado y las vincula al proyecto.

const TOOL = {
  empleados: /^search_?employees$/i,
  proveedores: /^search_?vendors$/i,
  items: /^search_?items$/i,
  crear: /^create_?time_?activit(y|ies)$/i,
  leer: /^get_?time_?activit(y|ies)$/i,
  borrar: /^delete_?time_?activit(y|ies)$/i,
};

async function herramientas(...cuales: (keyof typeof TOOL)[]): Promise<Record<string, string>> {
  const tools = await listQboTools();
  const out: Record<string, string> = {};
  for (const c of cuales) {
    const t = tools.find((x) => TOOL[c].test(x.name));
    if (!t) throw new Error(`El gateway de QuickBooks no tiene la herramienta para ${c}.`);
    out[c] = t.name;
  }
  return out;
}

const texto = (r: QboToolResult) => (r.content ?? []).map((c) => c.text ?? "").join("\n");
const numero = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function errorDe(r: QboToolResult): string | null {
  if (r.isError) return texto(r).slice(0, 300) || "QuickBooks rechazó el pedido";
  const t = texto(r);
  return /^\s*error/i.test(t) ? t.slice(0, 300) : null;
}

/**
 * La ficha de QuickBooks de cada nombre de Personal. Los empleados se traen
 * todos (son pocos); los proveedores se buscan por apellido, porque son
 * cientos (todos los suplidores).
 */
export async function buscarPersonasQbo(nombres: string[]): Promise<Map<string, PersonaQbo | null>> {
  const t = await herramientas("empleados", "proveedores");
  return withQboSession(async (call) => {
    const empleados: PersonaQbo[] = extractEntities(await call(t.empleados, { params: { fetchAll: true } }), "Employee")
      .filter((e) => e.Active !== false && typeof e.Id === "string" && typeof e.DisplayName === "string")
      .map((e) => ({
        tipo: "Employee" as const,
        id: e.Id as string,
        nombre: e.DisplayName as string,
        costoHora: numero(e.CostRate),
        tarifaFactura: e.BillableTime === true ? numero(e.BillRate) : null,
      }));

    const out = new Map<string, PersonaQbo | null>();
    for (const nombre of nombres) {
      const deEmpleados = emparejar(nombre, empleados);
      if (deEmpleados) {
        out.set(nombre, deEmpleados);
        continue;
      }
      // Por apellido, con y sin tilde: el LIKE de QuickBooks las distingue.
      const p = palabras(nombre);
      const apellido = nombre.trim().split(/\s+/).pop() ?? "";
      const busquedas = [...new Set([apellido, p[p.length - 1]].filter((x) => x && x.length >= 3))];
      const proveedores: PersonaQbo[] = [];
      for (const b of busquedas) {
        const r = await call(t.proveedores, { params: { criteria: [{ field: "DisplayName", value: `%${b}%`, operator: "LIKE" }] } });
        for (const v of extractEntities(r, "Vendor")) {
          if (v.Active === false || typeof v.Id !== "string" || typeof v.DisplayName !== "string") continue;
          if (!proveedores.some((x) => x.id === v.Id)) {
            proveedores.push({ tipo: "Vendor", id: v.Id, nombre: v.DisplayName, costoHora: null, tarifaFactura: null });
          }
        }
      }
      out.set(nombre, emparejar(nombre, proveedores));
    }
    return out;
  });
}

export type LineaTiempo = {
  persona: { tipo: TipoQbo; id: string; tarifaFactura: number | null };
  fecha: string;
  horas: number;
  descripcion: string;
};

export type ResultadoTiempo =
  | { ok: true; id: string; costoHora: number; nombre: string }
  // incierto = se cortó la conexión: puede haber quedado guardado.
  | { ok: false; error: string; incierto: boolean };

/**
 * Crea los registros uno por uno, sin reintentar ninguno. Si la conexión se
 * corta a mitad, los que faltan no se intentan: el gateway está inestable y
 * no se sabe si el último quedó.
 */
export async function crearRegistrosDeTiempo(qbJobId: string, lineas: LineaTiempo[]): Promise<ResultadoTiempo[]> {
  const t = await herramientas("crear", "items");
  return withQboSession(async (call) => {
    // El ítem "Hours" es el que llevan las horas cargadas a mano. Sin él igual
    // se crean; es lo que se ve si se facturan.
    let itemHoras: string | null = null;
    try {
      const r = await call(t.items, { params: { criteria: [{ field: "Name", value: "Hours" }] } });
      const it = extractEntities(r, "Item").find((x) => typeof x.Id === "string");
      itemHoras = (it?.Id as string | undefined) ?? null;
    } catch {
      /* sin ítem */
    }

    const out: ResultadoTiempo[] = [];
    let cortado = false;
    for (const l of lineas) {
      if (cortado) {
        out.push({ ok: false, error: "No se intentó: se cortó la conexión con QuickBooks antes.", incierto: false });
        continue;
      }
      const { hours, minutes } = partirHoras(l.horas);
      const facturable = l.persona.tipo === "Employee" && (l.persona.tarifaFactura ?? 0) > 0;
      const params: Record<string, unknown> = {
        name_of: l.persona.tipo,
        [l.persona.tipo === "Employee" ? "employee_ref" : "vendor_ref"]: l.persona.id,
        customer_ref: qbJobId,
        txn_date: l.fecha,
        hours,
        minutes,
        // Igual que las cargadas a mano: los de planilla facturables a su
        // tarifa; los de servicio profesional, no (no deben aparecer al facturar).
        billable_status: facturable ? "Billable" : "NotBillable",
        ...(facturable ? { hourly_rate: l.persona.tarifaFactura } : {}),
        ...(itemHoras ? { item_ref: itemHoras } : {}),
        description: l.descripcion,
      };
      try {
        const r = await call(t.crear, { params }, { reintentar: false });
        const error = errorDe(r);
        const creado = error ? null : extractEntities(r, "TimeActivity").find((x) => typeof x.Id === "string");
        if (!creado) {
          out.push({ ok: false, error: error ?? "QuickBooks no devolvió el registro creado", incierto: false });
          continue;
        }
        const quien = (creado.EmployeeRef ?? creado.VendorRef) as { name?: string } | undefined;
        out.push({ ok: true, id: creado.Id as string, costoHora: numero(creado.CostRate) ?? 0, nombre: quien?.name ?? "" });
      } catch (e) {
        if (e instanceof QboTransportError) {
          cortado = true;
          out.push({ ok: false, error: "Se cortó la conexión con QuickBooks: revisá si quedó antes de volver a cargarla.", incierto: true });
        } else {
          out.push({ ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Error de QuickBooks", incierto: false });
        }
      }
    }
    return out;
  });
}

/** Borra un registro de tiempo. Si ya no existe en QuickBooks, cuenta como borrado. */
export async function borrarRegistroDeTiempo(id: string): Promise<void> {
  const t = await herramientas("leer", "borrar");
  await withQboSession(async (call) => {
    const r = await call(t.leer, { params: { id } });
    const actual = extractEntities(r, "TimeActivity").find((x) => x.Id === id);
    if (!actual) {
      // 610 = no existe (ya lo borraron en QuickBooks).
      if (/"code"\s*:\s*"610"|not found|object not found/i.test(texto(r))) return;
      throw new Error(errorDe(r) ?? "No se encontró el registro en QuickBooks");
    }
    const b = await call(t.borrar, { params: { idOrEntity: { Id: id, SyncToken: actual.SyncToken } } }, { reintentar: false });
    const error = errorDe(b);
    if (error) throw new Error(error);
  });
}
