import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { listQuotes, listTenders, listProjectOptions } from "@/lib/pipeline/queries";
import { syncTendersFromGov } from "./gov-actions";
import { PotencialesScreen } from "./screen";

export const dynamic = "force-dynamic";
// Las server actions de esta ruta (Actualizar / Escaneo completo de PanamaCompra,
// clasificación IA, backfill de precios) pueden tardar; subimos el límite.
export const maxDuration = 300;

export default async function PotencialesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  // `?q=` lo usa el board de Proyectos para saltar a las cotizaciones de un
  // proyecto por su correlativo (ej. /potenciales?q=DS26-19).
  const { q } = await searchParams;
  const orgId = (await getActiveOrgId()) ?? "";
  const supabase = await createClient();

  // Antes de listar: vincular licitaciones sueltas con su proceso del gobierno
  // (por número de acto) y rellenar faltantes — fecha de participación, monto,
  // modalidad, carpeta Dropbox.
  await syncTendersFromGov();
  const [quotes, tenders, projectOptions] = await Promise.all([listQuotes(orgId), listTenders(orgId), listProjectOptions(orgId)]);
  const { data: clientsData } = (await supabase
    .from("clients")
    .select("id, name, client_locations(id, name)")
    .eq("org_id", orgId)
    .order("name")) as { data: { id: string; name: string; client_locations: { id: string; name: string }[] | null }[] | null };
  const clients = (clientsData ?? []).map((c) => ({ id: c.id, name: c.name, locations: c.client_locations ?? [] }));

  return <PotencialesScreen quotes={quotes} tenders={tenders} clients={clients} projectOptions={projectOptions} initialQuery={q ?? ""} />;
}
