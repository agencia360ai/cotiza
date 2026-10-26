"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgContext } from "@/lib/org-context";
import { sinAcceso } from "@/lib/acceso";
import { hasQboConfig, QboTransportError } from "@/lib/quickbooks/mcp";
import { ajustarHoras, normalizarHoras, type EntradaHoras, type HorasProyecto } from "@/lib/quickbooks/horas-core";
import type { TipoQbo } from "@/lib/quickbooks/personas-core";
import { borrarRegistroDeTiempo, buscarPersonasQbo, crearRegistrosDeTiempo } from "@/lib/quickbooks/tiempo";

type Result<T> = { error: string } | { ok: true; data: T };
type DB = Awaited<ReturnType<typeof createClient>>;

const FALTA_MIGRACION = "Falta correr la migración 0053 (horas desde la app) en Supabase.";
const faltaColumna = (e: { message?: string; code?: string } | null) =>
  !!e && (e.code === "42703" || e.code === "42P01" || /does not exist|could not find|schema cache/i.test(e.message ?? ""));

async function ctx(escribir = false) {
  const c = await getActiveOrgContext();
  if (!c) return { ok: false as const, error: "Sesión expirada" };
  const sinPermiso = await sinAcceso("proyectos");
  if (sinPermiso) return { ok: false as const, error: sinPermiso };
  // Cargar horas escribe en la contabilidad: un viewer mira, no carga.
  if (escribir && !["owner", "admin", "engineer"].includes(c.role)) {
    return { ok: false as const, error: "Tu usuario es de solo lectura: pedile a un admin que te deje cargar horas." };
  }
  return { ok: true as const, supabase: await createClient(), orgId: c.orgId, userId: c.user.id };
}

function mensajeQbo(e: unknown): string {
  if (e instanceof QboTransportError) return `${e.message}. Probá de nuevo en un minuto.`;
  return e instanceof Error ? e.message : "Error hablando con QuickBooks";
}

export type MiembroEquipo = {
  id: string;
  nombre: string;
  tipo: TipoQbo | null; // null = no se encontró en QuickBooks
  qboNombre: string | null;
  costoHora: number | null;
};

type FilaTecnico = {
  id: string;
  name: string;
  qbo_tipo: TipoQbo | null;
  qbo_id: string | null;
  qbo_nombre: string | null;
  qbo_costo_hora: number | string | null;
  qbo_tarifa_factura: number | string | null;
  qbo_vinculado_at: string | null;
};

const COLS_TECNICO = "id, name, qbo_tipo, qbo_id, qbo_nombre, qbo_costo_hora, qbo_tarifa_factura, qbo_vinculado_at";
const n = (v: number | string | null) => (v === null ? null : Number(v));

/**
 * El equipo de Personal con su ficha de QuickBooks. Los que todavía no están
 * vinculados se buscan en QuickBooks por nombre (una vez: queda guardado);
 * con `revincular` se vuelve a buscar a todos, p. ej. después de que
 * contabilidad les puso la tarifa.
 */
export async function getEquipoHoras(revincular = false): Promise<Result<MiembroEquipo[]>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const leer = () =>
    c.supabase.from("technicians").select(COLS_TECNICO).eq("org_id", c.orgId).eq("active", true).order("name") as unknown as Promise<{
      data: FilaTecnico[] | null;
      error: { message: string; code?: string } | null;
    }>;
  let { data, error } = await leer();
  if (faltaColumna(error)) return { error: FALTA_MIGRACION };
  if (error) return { error: error.message };

  // Solo los que nunca se buscaron: alguien que no está en QuickBooks no se
  // vuelve a buscar cada vez que se abre el formulario.
  const pendientes = (data ?? []).filter((t) => revincular || !t.qbo_vinculado_at);
  if (pendientes.length > 0 && hasQboConfig()) {
    try {
      const encontrados = await buscarPersonasQbo(pendientes.map((t) => t.name));
      const ahora = new Date().toISOString();
      for (const t of pendientes) {
        const p = encontrados.get(t.name) ?? null;
        await c.supabase
          .from("technicians")
          .update({
            qbo_tipo: p?.tipo ?? null,
            qbo_id: p?.id ?? null,
            qbo_nombre: p?.nombre ?? null,
            qbo_costo_hora: p?.costoHora ?? null,
            qbo_tarifa_factura: p?.tarifaFactura ?? null,
            qbo_vinculado_at: ahora,
          })
          .eq("id", t.id)
          .eq("org_id", c.orgId);
      }
      ({ data, error } = await leer());
      if (error) return { error: error.message };
    } catch (e) {
      // Sin QuickBooks se muestran igual los que ya estaban vinculados.
      if (!(data ?? []).some((t) => t.qbo_id)) return { error: mensajeQbo(e) };
    }
  }

  return {
    ok: true,
    data: (data ?? []).map((t) => ({
      id: t.id,
      nombre: t.name,
      tipo: t.qbo_id ? t.qbo_tipo : null,
      qboNombre: t.qbo_nombre,
      costoHora: n(t.qbo_costo_hora),
    })),
  };
}

export type HoraCargada = {
  id: string;
  tecnico: string;
  tipo: TipoQbo;
  fecha: string;
  horas: number;
  costoHora: number;
  nota: string | null;
  creada: string;
};

/** Lo último que se cargó desde la app en este proyecto. */
export async function getHorasCargadas(qbJobId: string): Promise<Result<HoraCargada[]>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const { data, error } = (await c.supabase
    .from("horas_cargadas")
    .select("id, tecnico, qbo_tipo, fecha, horas, costo_hora, nota, created_at")
    .eq("org_id", c.orgId)
    .eq("qb_job_id", qbJobId)
    .order("created_at", { ascending: false })
    .limit(30)) as {
    data: { id: string; tecnico: string; qbo_tipo: TipoQbo; fecha: string; horas: number | string; costo_hora: number | string; nota: string | null; created_at: string }[] | null;
    error: { message: string; code?: string } | null;
  };
  if (faltaColumna(error)) return { error: FALTA_MIGRACION };
  if (error) return { error: error.message };
  return {
    ok: true,
    data: (data ?? []).map((r) => ({
      id: r.id,
      tecnico: r.tecnico,
      tipo: r.qbo_tipo,
      fecha: r.fecha,
      horas: Number(r.horas),
      costoHora: Number(r.costo_hora),
      nota: r.nota,
      creada: r.created_at,
    })),
  };
}

export type LineaHoras = { technicianId: string; fecha: string; horas: number; nota: string };

const hoyPanama = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Panama" });

function validar(l: LineaHoras): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(l.fecha)) return "fecha inválida";
  if (l.fecha > hoyPanama()) return "la fecha es futura";
  const haceUnAnio = new Date(Date.now() - 366 * 864e5).toISOString().slice(0, 10);
  if (l.fecha < haceUnAnio) return "la fecha tiene más de un año";
  if (!(l.horas > 0) || l.horas > 24) return "las horas tienen que estar entre 0 y 24";
  return null;
}

async function leerHoras(supabase: DB, orgId: string, qbJobId: string): Promise<HorasProyecto | null> {
  const { data } = (await supabase
    .from("qbo_project_state")
    .select("horas_tecnicos")
    .eq("org_id", orgId)
    .eq("qb_job_id", qbJobId)
    .maybeSingle()) as { data: { horas_tecnicos: unknown } | null };
  return normalizarHoras(data?.horas_tecnicos);
}

export type ResultadoCarga = {
  horas: HorasProyecto | null;
  creadas: number;
  problemas: { linea: number; tecnico: string; error: string }[];
};

/**
 * Crea las horas en QuickBooks, en el proyecto, como se cargaban a mano. Lo
 * que se crea queda anotado para poder borrarlo desde la app, y las horas del
 * proyecto se actualizan en el momento.
 */
export async function cargarHoras(qbJobId: string, lineas: LineaHoras[]): Promise<Result<ResultadoCarga>> {
  const c = await ctx(true);
  if (!c.ok) return { error: c.error };
  if (!hasQboConfig()) return { error: "QBO_MCP_URL no está configurada (seteala en Vercel)." };
  if (lineas.length === 0) return { error: "No hay horas para cargar" };
  if (lineas.length > 40) return { error: "Son demasiadas líneas para una carga: partilo en dos." };

  for (const [i, l] of lineas.entries()) {
    const malo = validar(l);
    if (malo) return { error: `Línea ${i + 1}: ${malo}` };
  }

  const { data: proyecto } = (await c.supabase
    .from("qbo_project_state")
    .select("name")
    .eq("org_id", c.orgId)
    .eq("qb_job_id", qbJobId)
    .maybeSingle()) as { data: { name: string | null } | null };
  if (!proyecto) return { error: "No encontré el proyecto" };

  const ids = [...new Set(lineas.map((l) => l.technicianId))];
  const { data: tecnicos, error } = (await c.supabase
    .from("technicians")
    .select(COLS_TECNICO)
    .eq("org_id", c.orgId)
    .in("id", ids)) as { data: FilaTecnico[] | null; error: { message: string; code?: string } | null };
  if (faltaColumna(error)) return { error: FALTA_MIGRACION };
  if (error) return { error: error.message };
  const porId = new Map((tecnicos ?? []).map((t) => [t.id, t]));
  for (const [i, l] of lineas.entries()) {
    const t = porId.get(l.technicianId);
    if (!t) return { error: `Línea ${i + 1}: técnico no encontrado` };
    if (!t.qbo_id || !t.qbo_tipo) return { error: `${t.name} no está vinculado a QuickBooks: no se le pueden cargar horas.` };
  }

  let resultados;
  try {
    resultados = await crearRegistrosDeTiempo(
      qbJobId,
      lineas.map((l) => {
        const t = porId.get(l.technicianId)!;
        return {
          persona: { tipo: t.qbo_tipo!, id: t.qbo_id!, tarifaFactura: n(t.qbo_tarifa_factura) },
          fecha: l.fecha,
          horas: Math.round(l.horas * 100) / 100,
          descripcion: l.nota.trim() || proyecto.name || "Horas de técnicos",
        };
      }),
    );
  } catch (e) {
    return { error: mensajeQbo(e) };
  }

  const entradas: EntradaHoras[] = [];
  const filas: Record<string, unknown>[] = [];
  const problemas: ResultadoCarga["problemas"] = [];
  resultados.forEach((r, i) => {
    const l = lineas[i];
    const t = porId.get(l.technicianId)!;
    if (!r.ok) {
      problemas.push({ linea: i + 1, tecnico: t.name, error: r.error });
      return;
    }
    const nombre = r.nombre || t.qbo_nombre || t.name;
    entradas.push({ nombre, fecha: l.fecha, horas: l.horas, costoHora: r.costoHora, proveedor: t.qbo_tipo === "Vendor" });
    filas.push({
      org_id: c.orgId,
      qb_job_id: qbJobId,
      technician_id: t.id,
      tecnico: nombre,
      qbo_tipo: t.qbo_tipo,
      fecha: l.fecha,
      horas: l.horas,
      costo_hora: r.costoHora,
      nota: l.nota.trim() || null,
      qbo_time_id: r.id,
      created_by: c.userId,
    });
  });

  // Lo de QuickBooks ya quedó: si anotarlo falla, se dice pero no se deshace.
  if (filas.length > 0) {
    const { error: insErr } = await c.supabase.from("horas_cargadas").insert(filas);
    if (insErr) problemas.push({ linea: 0, tecnico: "", error: `Quedaron en QuickBooks, pero no se pudieron anotar para borrarlas desde acá: ${insErr.message}` });
  }

  let horas = await leerHoras(c.supabase, c.orgId, qbJobId);
  if (entradas.length > 0) {
    horas = ajustarHoras(horas, entradas);
    await c.supabase.from("qbo_project_state").update({ horas_tecnicos: horas }).eq("org_id", c.orgId).eq("qb_job_id", qbJobId);
    revalidatePath("/proyectos");
  }
  return { ok: true, data: { horas, creadas: entradas.length, problemas } };
}

/** Borra en QuickBooks una carga hecha desde la app (por si se cargó mal). */
export async function borrarHoraCargada(id: string): Promise<Result<{ horas: HorasProyecto | null }>> {
  const c = await ctx(true);
  if (!c.ok) return { error: c.error };
  if (!hasQboConfig()) return { error: "QBO_MCP_URL no está configurada (seteala en Vercel)." };
  const { data: fila, error } = (await c.supabase
    .from("horas_cargadas")
    .select("qb_job_id, tecnico, qbo_tipo, fecha, horas, costo_hora, qbo_time_id")
    .eq("org_id", c.orgId)
    .eq("id", id)
    .maybeSingle()) as {
    data: { qb_job_id: string; tecnico: string; qbo_tipo: TipoQbo; fecha: string; horas: number | string; costo_hora: number | string; qbo_time_id: string } | null;
    error: { message: string; code?: string } | null;
  };
  if (faltaColumna(error)) return { error: FALTA_MIGRACION };
  if (error || !fila) return { error: error?.message ?? "No encontré esa carga" };

  try {
    await borrarRegistroDeTiempo(fila.qbo_time_id);
  } catch (e) {
    return { error: mensajeQbo(e) };
  }
  await c.supabase.from("horas_cargadas").delete().eq("org_id", c.orgId).eq("id", id);
  const horas = ajustarHoras(
    await leerHoras(c.supabase, c.orgId, fila.qb_job_id),
    [{ nombre: fila.tecnico, fecha: fila.fecha, horas: Number(fila.horas), costoHora: Number(fila.costo_hora), proveedor: fila.qbo_tipo === "Vendor" }],
    -1,
  );
  await c.supabase.from("qbo_project_state").update({ horas_tecnicos: horas }).eq("org_id", c.orgId).eq("qb_job_id", fila.qb_job_id);
  revalidatePath("/proyectos");
  return { ok: true, data: { horas } };
}
