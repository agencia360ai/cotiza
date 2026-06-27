import { getActiveOrgId } from "@/lib/org-context";
import { getPipelineData } from "@/lib/pipeline/queries";
import { PotencialesScreen } from "./screen";

export const dynamic = "force-dynamic";

export default async function PotencialesPage() {
  const orgId = await getActiveOrgId();
  const data = await getPipelineData(orgId ?? "");
  return <PotencialesScreen data={data} />;
}
