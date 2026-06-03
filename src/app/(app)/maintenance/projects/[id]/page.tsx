import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { ProjectEditor } from "./editor";
import type {
  ClientProject,
  MilestoneStatus,
  ProjectCapture,
  ProjectMilestone,
  ProjectSection,
  SectionColor,
} from "@/lib/projects/types";

export const dynamic = "force-dynamic";

type ProjectRow = ClientProject & {
  client: { id: string; name: string } | { id: string; name: string }[];
  location: { id: string; name: string } | { id: string; name: string }[] | null;
};

type MediaRow = {
  id: string;
  kind: "photo" | "video";
  path: string;
  caption_es: string | null;
  position: number;
  entry_id: string | null;
};

type EntryRow = {
  id: string;
  occurred_on: string | null;
  text_es: string | null;
  position: number;
  ai_generated: boolean;
  created_at: string;
};

type MilestoneRow = {
  id: string;
  section_id: string | null;
  title: string;
  description_es: string | null;
  status: MilestoneStatus;
  position: number;
  occurred_on: string | null;
  completed_at: string | null;
  created_at: string;
  media: MediaRow[] | null;
  entries: EntryRow[] | null;
};

type SectionRow = {
  id: string;
  name: string;
  color: string;
  position: number;
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
  const orgId = await getActiveOrgId();
  if (!orgId) redirect("/onboarding");

  const { data: row } = (await supabase
    .from("client_projects")
    .select(
      "*, client:clients!inner(id, name), location:client_locations(id, name)",
    )
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle()) as { data: ProjectRow | null };

  if (!row) notFound();

  const { data: milestones } = (await supabase
    .from("project_milestones")
    .select(
      "id, section_id, title, description_es, status, position, occurred_on, completed_at, created_at, media:project_milestone_media(id, kind, path, caption_es, position, entry_id), entries:project_milestone_entries(id, occurred_on, text_es, position, ai_generated, created_at)",
    )
    .eq("project_id", id)
    .order("position", { ascending: true })) as { data: MilestoneRow[] | null };

  const { data: sectionsRaw } = (await supabase
    .from("project_sections")
    .select("id, name, color, position")
    .eq("project_id", id)
    .eq("archived", false)
    .order("position", { ascending: true })) as { data: SectionRow[] | null };
  const sections: ProjectSection[] = (sectionsRaw ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color as SectionColor,
    position: s.position,
  }));

  const sortedMilestones: ProjectMilestone[] = (milestones ?? []).map((m) => {
    const allMedia = (m.media ?? []).slice().sort((a, b) => a.position - b.position);
    const milestoneOnly = allMedia.filter((mm) => !mm.entry_id);
    const entryMedia = new Map<string, MediaRow[]>();
    for (const mm of allMedia) {
      if (!mm.entry_id) continue;
      const arr = entryMedia.get(mm.entry_id) ?? [];
      arr.push(mm);
      entryMedia.set(mm.entry_id, arr);
    }

    const entries = (m.entries ?? [])
      .slice()
      .sort((a, b) => {
        const ad = a.occurred_on ?? "";
        const bd = b.occurred_on ?? "";
        if (ad !== bd) return ad < bd ? -1 : 1;
        return a.position - b.position;
      })
      .map((e) => ({
        id: e.id,
        occurred_on: e.occurred_on,
        text_es: e.text_es,
        position: e.position,
        ai_generated: e.ai_generated,
        created_at: e.created_at,
        media: (entryMedia.get(e.id) ?? []).map((mm) => ({
          id: mm.id,
          kind: mm.kind,
          path: mm.path,
          caption_es: mm.caption_es,
          position: mm.position,
        })),
      }));

    return {
      id: m.id,
      section_id: m.section_id,
      title: m.title,
      description_es: m.description_es,
      status: m.status,
      position: m.position,
      occurred_on: m.occurred_on,
      completed_at: m.completed_at,
      created_at: m.created_at,
      entries,
      media: milestoneOnly.map((mm) => ({
        id: mm.id,
        kind: mm.kind,
        path: mm.path,
        caption_es: mm.caption_es,
        position: mm.position,
      })),
    };
  });

  const client = one(row.client);
  const location = one(row.location);
  const captureData = (row.capture_data as ProjectCapture[] | undefined) ?? [];

  const { data: clientLocations } = (await supabase
    .from("client_locations")
    .select("id, name")
    .eq("client_id", client?.id ?? "")
    .order("name")) as { data: { id: string; name: string }[] | null };

  return (
    <ProjectEditor
      project={row as ClientProject}
      client={client ?? { id: "", name: "—" }}
      location={location}
      clientLocations={clientLocations ?? []}
      milestones={sortedMilestones}
      sections={sections}
      captures={captureData}
    />
  );
}
