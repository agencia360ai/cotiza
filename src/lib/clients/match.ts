import "server-only";
import { createClient } from "@/lib/supabase/server";
import { norm } from "./normalize";

type DB = Awaited<ReturnType<typeof createClient>>;

export type ClientMatch = { id: string; name: string; location_id: string | null; location_name: string | null };

// Resuelve cliente + sucursal para un nombre suelto:
//   1. Cliente: por alias conocido, si no por nombre de cliente normalizado.
//   2. Sucursal: la del alias; si no la tiene, la deriva del nombre crudo
//      (ej. "Esa Flaca Rica – David" → location "David") contra las sucursales
//      del cliente. Así las nuevas importaciones traen el lugar aunque el alias
//      todavía no lo tenga guardado.
export async function matchClientByName(supabase: DB, orgId: string, rawName: string | null): Promise<ClientMatch | null> {
  if (!rawName) return null;
  const key = norm(rawName);
  if (!key) return null;

  let clientId: string | null = null;
  let clientName = "";
  let locationId: string | null = null;
  let locationName: string | null = null;

  const { data: a } = (await supabase
    .from("client_aliases")
    .select("client_id, location_id, client:clients(name), location:client_locations(name)")
    .eq("org_id", orgId)
    .eq("alias_norm", key)
    .maybeSingle()) as {
    data: { client_id: string; location_id: string | null; client: { name: string } | null; location: { name: string } | null } | null;
  };
  if (a?.client_id) {
    clientId = a.client_id;
    clientName = a.client?.name ?? "";
    locationId = a.location_id ?? null;
    locationName = a.location?.name ?? null;
  } else {
    const { data: cs } = (await supabase.from("clients").select("id, name").eq("org_id", orgId)) as {
      data: { id: string; name: string }[] | null;
    };
    for (const c of cs ?? [])
      if (norm(c.name) === key) {
        clientId = c.id;
        clientName = c.name;
        break;
      }
  }
  if (!clientId) return null;

  // Derivar la sucursal del nombre crudo si no vino del alias.
  if (!locationId) {
    const { data: locs } = (await supabase.from("client_locations").select("id, name").eq("client_id", clientId)) as {
      data: { id: string; name: string }[] | null;
    };
    for (const l of locs ?? []) {
      const ln = norm(l.name);
      if (ln.length >= 3 && key.includes(ln)) {
        locationId = l.id;
        locationName = l.name;
        break;
      }
    }
  }

  return { id: clientId, name: clientName, location_id: locationId, location_name: locationName };
}
