import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProjectEditor } from "./editor";
import type { ClientProject, MilestoneStatus, ProjectMilestone } from "@/lib/projects/types";

export const dynamic = "force-dynamic";

type ProjectRow = ClientProject & {
  client: { id: string; name: string } | { id: string; name: string }[];
  location: { id: string; name: string } | { id: string; name: string }[] | null;
};

type MilestoneRow = {
  id: string;
  title: string;
  description_es: string | null;
  status: MilestoneStatus;
  position: number;
  occurred_on: string | null;
  completed_at: string | null;
  created_at: string;
  media:
    | {
        id: string;
        kind: "photo" | "video";
        path: string;
        caption_es: string | null;
        position: number;
      }[]
    | null;
};

function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) redirect("/login");

  const { data: row } = (await supabase
    .from("client_projects")
    .select(
      "*, client:clients!inner(id, name), location:client_locations(id, name)",
    )
    .eq("id", id)
    .maybeSingle()) as { data: ProjectRow | null };

  if (!row) notFound();

  const { data: milestones } = (await supabase
    .from("project_milestones")
    .select(
      "id, title, description_es, status, position, occurred_on, completed_at, created_at, media:project_milestone_media(id, kind, path, caption_es, position)",
    )
    .eq("project_id", id)
    .order("position", { ascending: true })) as { data: MilestoneRow[] | null };

  const sortedMilestones: ProjectMilestone[] = (milestones ?? []).map((m) => ({
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

  const client = one(row.client);
  const location = one(row.location);

  return (
    <ProjectEditor
      project={row as ClientProject}
      client={client ?? { id: "", name: "—" }}
      location={location}
      milestones={sortedMilestones}
    />
  );
}
