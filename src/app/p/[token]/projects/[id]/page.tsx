import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { PublicProjectData } from "@/lib/projects/types";
import { PublicProjectScreen } from "./screen";

export const dynamic = "force-dynamic";

export default async function PublicProjectPage({
  params,
}: {
  params: Promise<{ token: string; id: string }>;
}) {
  const { token, id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_project_by_token", {
    _token: token,
    _project_id: id,
  });
  if (!data) notFound();
  return <PublicProjectScreen token={token} data={data as PublicProjectData} />;
}
