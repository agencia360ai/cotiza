import "server-only";
import { createClient } from "@/lib/supabase/server";

// Contadores de las pastillas del sidebar. Todo con HEAD + count exacto: no se
// trae una sola fila, solo el número, y las 7 consultas van en paralelo — el
// layout corre en CADA navegación y no puede ser el cuello de botella.
//
// Un contador que falla vale null y su pastilla no se pinta. El sidebar tiene
// que renderizar aunque falte una migración o una tabla esté caída.
export type NavCounts = {
  proyectos: number | null; // abiertos
  mantenimiento: number | null; // servicios vencidos — pastilla roja
  leads: number | null; // vivos
  cotizaciones: number | null;
  licitaciones: number | null;
  clientes: number | null;
  personal: number | null;
};

const VACIO: NavCounts = {
  proyectos: null,
  mantenimiento: null,
  leads: null,
  cotizaciones: null,
  licitaciones: null,
  clientes: null,
  personal: null,
};

type Filtro = (q: FiltrableQuery) => FiltrableQuery;
type FiltrableQuery = {
  eq: (c: string, v: unknown) => FiltrableQuery;
  neq: (c: string, v: unknown) => FiltrableQuery;
  lt: (c: string, v: unknown) => FiltrableQuery;
  then: <R>(cb: (r: { count: number | null; error: unknown }) => R) => Promise<R>;
};

export async function getNavCounts(orgId: string): Promise<NavCounts> {
  if (!orgId) return VACIO;
  const supabase = await createClient();

  const contar = async (tabla: string, filtro?: Filtro): Promise<number | null> => {
    try {
      const base = supabase.from(tabla).select("*", { count: "exact", head: true }).eq("org_id", orgId);
      const q = filtro ? filtro(base as unknown as FiltrableQuery) : (base as unknown as FiltrableQuery);
      const { count, error } = await (q as unknown as Promise<{ count: number | null; error: unknown }>);
      return error ? null : count ?? null;
    } catch {
      return null;
    }
  };

  // Hoy en hora de Panamá: un servicio vence al terminar SU día, no a las 7pm
  // del día anterior como pasaría comparando en UTC.
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Panama" });

  const [proyectos, mantenimiento, leads, cotizaciones, licitaciones, clientes, personal] = await Promise.all([
    // Abiertos: el número que importa es en cuántos se está trabajando.
    contar("qbo_project_state", (q) => q.neq("status", "cerrado")),
    contar("maintenance_schedules", (q) => q.eq("active", true).lt("next_due_date", hoy)),
    contar("leads", (q) => q.neq("status", "perdido")),
    contar("sales_quotes"),
    contar("tenders"),
    contar("clients"),
    contar("org_members"),
  ]);

  return { proyectos, mantenimiento, leads, cotizaciones, licitaciones, clientes, personal };
}
