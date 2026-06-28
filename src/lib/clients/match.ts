import "server-only";
import { createClient } from "@/lib/supabase/server";
import { norm } from "./normalize";

type DB = Awaited<ReturnType<typeof createClient>>;

// Resuelve un cliente para un nombre suelto: primero por alias conocido, luego
// por nombre de cliente normalizado. Devuelve {id, name} o null (sin match).
export async function matchClientByName(
  supabase: DB,
  orgId: string,
  rawName: string | null,
): Promise<{ id: string; name: string } | null> {
  if (!rawName) return null;
  const key = norm(rawName);
  if (!key) return null;

  const { data: a } = (await supabase
    .from("client_aliases")
    .select("client_id, client:clients(name)")
    .eq("org_id", orgId)
    .eq("alias_norm", key)
    .maybeSingle()) as { data: { client_id: string; client: { name: string } | null } | null };
  if (a?.client_id) return { id: a.client_id, name: a.client?.name ?? "" };

  const { data: cs } = (await supabase.from("clients").select("id, name").eq("org_id", orgId)) as {
    data: { id: string; name: string }[] | null;
  };
  for (const c of cs ?? []) if (norm(c.name) === key) return { id: c.id, name: c.name };
  return null;
}
