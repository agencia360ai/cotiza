import "server-only";
import { redirect } from "next/navigation";
import { getActiveOrgContext } from "@/lib/org-context";
import { primeraRuta, seccionesVisibles, verConfiguracion, type Seccion } from "@/lib/secciones";

// Guardias del lado de la app. Las filas ya las filtra la base (0050); esto
// cubre lo que la base no puede: redirigir en vez de mostrar una página vacía,
// y frenar las acciones que leen de afuera —QuickBooks, Dropbox, PanamaCompra—
// o con el admin client, adonde RLS no llega.

/** Para el layout de cada sección: quien no la tiene va a la primera que sí. */
export async function exigirSeccion(seccion: Seccion): Promise<void> {
  const ctx = await getActiveOrgContext();
  if (!ctx) redirect("/onboarding");
  if (!seccionesVisibles(ctx.role, ctx.secciones).includes(seccion)) {
    redirect(primeraRuta(ctx.role, ctx.secciones));
  }
}

export async function exigirConfiguracion(): Promise<void> {
  const ctx = await getActiveOrgContext();
  if (!ctx) redirect("/onboarding");
  if (!verConfiguracion(ctx.role, ctx.secciones)) redirect(primeraRuta(ctx.role, ctx.secciones));
}

/**
 * Para server actions: null si puede, o el error a devolver.
 *
 * Alcanza con UNA de las secciones: gov-actions lo usan Licitaciones y
 * Cotizaciones, y cualquiera de las dos abre la puerta.
 */
export async function sinAcceso(...secciones: Seccion[]): Promise<string | null> {
  const ctx = await getActiveOrgContext();
  if (!ctx) return "Sin organización";
  const visibles = seccionesVisibles(ctx.role, ctx.secciones);
  return secciones.some((s) => visibles.includes(s)) ? null : "No tenés acceso a esta sección.";
}
