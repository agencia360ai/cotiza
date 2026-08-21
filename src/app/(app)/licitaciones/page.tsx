import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { listTenders } from "@/lib/pipeline/queries";
import { syncTendersFromGov } from "../potenciales/gov-actions";
import { LicitacionesScreen } from "./screen";
import { ESTADOS_VIGILADOS } from "@/lib/panamacompra/vigilancia-core";
import type { Vigilada } from "./vigilancia-panel";

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

  const [tenders, { data: clientsData }, { data: vigData }] = await Promise.all([
    listTenders(orgId),
    supabase
      .from("clients")
      .select("id, name, client_locations(id, name)")
      .eq("org_id", orgId)
      .order("name") as unknown as Promise<{
      data: { id: string; name: string; client_locations: { id: string; name: string }[] | null }[] | null;
    }>,
    supabase
      .from("tenders")
      .select("id, acto_number, objeto, entity, pc_cambio, pc_changed_at, pc_checked_at, pc_visto_at")
      .eq("org_id", orgId)
      .is("archived_at", null)
      .in("status", ESTADOS_VIGILADOS as unknown as string[]) as unknown as Promise<{
      data:
        | {
            id: string;
            acto_number: string | null;
            objeto: string | null;
            entity: string | null;
            pc_cambio: string | null;
            pc_changed_at: string | null;
            pc_checked_at: string | null;
            pc_visto_at: string | null;
          }[]
        | null;
    }>,
  ]);
  const clients = (clientsData ?? []).map((c) => ({ id: c.id, name: c.name, locations: c.client_locations ?? [] }));

  // Sin la 0047 esta consulta falla y vigData viene null: el panel no se pinta
  // y el resto de la pantalla sigue funcionando igual.
  const vigiladas: Vigilada[] = (vigData ?? []).map((t) => ({
    id: t.id,
    acto: t.acto_number,
    objeto: t.objeto,
    entidad: t.entity,
    cambio: t.pc_cambio,
    cambiadoAt: t.pc_changed_at,
    revisadoAt: t.pc_checked_at,
    vistoAt: t.pc_visto_at,
  }));

  return <LicitacionesScreen tenders={tenders} clients={clients} vigiladas={vigiladas} />;
}
