import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ClientProject, MilestoneStatus, ProjectMilestone } from "@/lib/projects/types";
import { TechnicianProjectScreen } from "./screen";

export const dynamic = "force-dynamic";

type RpcResult = {
  project: ClientProject;
  client: { id: string; name: string };
  location: { id: string; name: string } | null;
  milestones: {
    id: string;
    title: string;
    description_es: string | null;
    status: MilestoneStatus;
    position: number;
    occurred_on: string | null;
    completed_at: string | null;
    created_at: string;
    media: {
      id: string;
      kind: "photo" | "video";
      path: string;
      caption_es: string | null;
      position: number;
    }[];
  }[];
};

export default async function TechnicianProjectPage({
  params,
}: {
  params: Promise<{ token: string; id: string }>;
}) {
  const { token, id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_technician_project", {
    _token: token,
    _project_id: id,
  });
  if (error || !data) notFound();

  const result = data as RpcResult;
  const milestones: ProjectMilestone[] = (result.milestones ?? []).map((m) => ({
    id: m.id,
    title: m.title,
    description_es: m.description_es,
    status: m.status,
    position: m.position,
    occurred_on: m.occurred_on,
    completed_at: m.completed_at,
    created_at: m.created_at,
    media: (m.media ?? []).slice().sort((a, b) => a.position - b.position),
  }));

  return (
    <TechnicianProjectScreen
      token={token}
      project={result.project}
      client={result.client}
      location={result.location}
      milestones={milestones}
    />
  );
}
