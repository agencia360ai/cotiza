import "server-only";
import { createClient } from "@/lib/supabase/server";
import { norm } from "./normalize";

type DB = Awaited<ReturnType<typeof createClient>>;

// Resuelve un cliente para un nombre suelto: primero por alias conocido, luego
// por nombre de cliente normalizado. Devuelve {id, name} o null (sin match).
export type ClientMatch = { id: string; name: string; location_id: string | null; location_name: string | null };

export async function matchClientByName(supabase: DB, orgId: string, rawName: string | null): Promise<ClientMatch | null> {
  if (!rawName) return null;
  const key = norm(rawName);
  if (!key) return null;

  const { data: a } = (await supabase
    .from("client_aliases")
    .select("client_id, location_id, client:clients(name), location:client_locations(name)")
    .eq("org_id", orgId)
    .eq("alias_norm", key)
    .maybeSingle()) as {
    data: { client_id: string; location_id: string | null; client: { name: string } | null; location: { name: string } | null } | null;
  };
  if (a?.client_id)
    return { id: a.client_id, name: a.client?.name ?? "", location_id: a.location_id ?? null, location_name: a.location?.name ?? null };

  const { data: cs } = (await supabase.from("clients").select("id, name").eq("org_id", orgId)) as {
    data: { id: string; name: string }[] | null;
  };
  for (const c of cs ?? []) if (norm(c.name) === key) return { id: c.id, name: c.name, location_id: null, location_name: null };
  return null;
}
