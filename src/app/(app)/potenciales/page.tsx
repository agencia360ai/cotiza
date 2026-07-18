import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { listQuotes, listTenders } from "@/lib/pipeline/queries";
import { syncTenderDropboxLinks } from "./gov-actions";
import { PotencialesScreen } from "./screen";

export const dynamic = "force-dynamic";
// Las server actions de esta ruta (Actualizar / Escaneo completo de PanamaCompra,
// clasificación IA, backfill de precios) pueden tardar; subimos el límite.
export const maxDuration = 300;

export default async function PotencialesPage() {
  const orgId = (await getActiveOrgId()) ?? "";
  const supabase = await createClient();

  // Antes de listar: propagar el link de la carpeta Dropbox del gov_tender a su
  // tender (los seguidos antes de crear la carpeta quedaron sin link).
  await syncTenderDropboxLinks();
  const [quotes, tenders] = await Promise.all([listQuotes(orgId), listTenders(orgId)]);
  const { data: clientsData } = (await supabase
    .from("clients")
    .select("id, name, client_locations(id, name)")
    .eq("org_id", orgId)
    .order("name")) as { data: { id: string; name: string; client_locations: { id: string; name: string }[] | null }[] | null };
  const clients = (clientsData ?? []).map((c) => ({ id: c.id, name: c.name, locations: c.client_locations ?? [] }));

  return <PotencialesScreen quotes={quotes} tenders={tenders} clients={clients} />;
}
