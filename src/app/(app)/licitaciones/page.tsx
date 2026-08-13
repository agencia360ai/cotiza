import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { listTenders } from "@/lib/pipeline/queries";
import { syncTendersFromGov } from "../potenciales/gov-actions";
import { LicitacionesScreen } from "./screen";

export const dynamic = "force-dynamic";
// El escaneo de PanamaCompra y la clasificación IA pueden tardar; sin esto
// Vercel corta en el default.
export const maxDuration = 300;

export default async function LicitacionesPage() {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) redirect("/login");
  const orgId = await getActiveOrgId();
  if (!orgId) redirect("/onboarding");

  // Antes de listar: vincular licitaciones sueltas con su proceso del gobierno
  // (por número de acto) y rellenar faltantes.
  await syncTendersFromGov();

  const [tenders, { data: clientsData }] = await Promise.all([
    listTenders(orgId),
    supabase
      .from("clients")
      .select("id, name, client_locations(id, name)")
      .eq("org_id", orgId)
      .order("name") as unknown as Promise<{
      data: { id: string; name: string; client_locations: { id: string; name: string }[] | null }[] | null;
    }>,
  ]);
  const clients = (clientsData ?? []).map((c) => ({ id: c.id, name: c.name, locations: c.client_locations ?? [] }));

  return <LicitacionesScreen tenders={tenders} clients={clients} />;
}
