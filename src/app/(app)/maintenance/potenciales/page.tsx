import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { listQuotes, listTenders } from "@/lib/pipeline/queries";
import { PotencialesScreen } from "./screen";

export const dynamic = "force-dynamic";

export default async function PotencialesPage() {
  const orgId = (await getActiveOrgId()) ?? "";
  const supabase = await createClient();

  const [quotes, tenders] = await Promise.all([listQuotes(orgId), listTenders(orgId)]);
  const { data: clientsData } = await supabase
    .from("clients")
    .select("id, name")
    .eq("org_id", orgId)
    .order("name");
  const clients = (clientsData ?? []) as { id: string; name: string }[];

  return <PotencialesScreen quotes={quotes} tenders={tenders} clients={clients} />;
}
