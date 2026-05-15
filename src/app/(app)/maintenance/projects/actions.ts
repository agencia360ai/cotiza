"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import type {
  ClientProject,
  MilestoneStatus,
  ProjectCapture,
  ProjectCaptureKind,
  ProjectStatus,
  ProjectType,
} from "@/lib/projects/types";
import { structureProjectFromCaptures } from "@/lib/ai/structure-project";

type Result<T = void> = { error: string } | (T extends void ? { ok: true } : { ok: true; data: T });

async function currentOrgId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return null;
  const { data } = (await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", u.user.id)
    .limit(1)
    .maybeSingle()) as { data: { org_id: string } | null };
  return data?.org_id ?? null;
}

export async function createProject(input: {
  client_id: string;
  location_id: string | null;
  new_location_label: string | null;
  name: string;
  project_type: ProjectType;
  description_es: string | null;
  expected_start_date: string | null;
  expected_completion_date: string | null;
}) {
  const supabase = await createClient();
  const org_id = await currentOrgId();
  if (!org_id) return { error: "No org" };

  const { data: u } = await supabase.auth.getUser();

  const { data, error } = (await supabase
    .from("client_projects")
    .insert({
      org_id,
      client_id: input.client_id,
      location_id: input.location_id,
      new_location_label: input.new_location_label,
      name: input.name,
      project_type: input.project_type,
      description_es: input.description_es,
      expected_start_date: input.expected_start_date,
      expected_completion_date: input.expected_completion_date,
      status: "planificado",
      created_by_user_id: u.user?.id ?? null,
    })
    .select("id")
    .single()) as { data: { id: string } | null; error: { message: string } | null };

  if (error || !data) return { error: error?.message ?? "Falló crear proyecto" };

  revalidatePath("/maintenance/projects");
  redirect(`/maintenance/projects/${data.id}`);
}

export async function updateProject(
  projectId: string,
  patch: Partial<{
    name: string;
    description_es: string | null;
    project_type: ProjectType;
    status: ProjectStatus;
    expected_start_date: string | null;
    expected_completion_date: string | null;
    started_at: string | null;
    completed_at: string | null;
    cover_photo_path: string | null;
    location_id: string | null;
    new_location_label: string | null;
  }>,
): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("client_projects")
    .update(patch)
    .eq("id", projectId);
  if (error) return { error: error.message };
  revalidatePath(`/maintenance/projects/${projectId}`);
  revalidatePath("/maintenance/projects");
  return { ok: true };
}

export async function deleteProject(projectId: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("client_projects")
    .delete()
    .eq("id", projectId);
  if (error) return { error: error.message };
  revalidatePath("/maintenance/projects");
  return { ok: true };
}

export async function addMilestone(input: {
  project_id: string;
  title: string;
  description_es: string | null;
  occurred_on: string | null;
  status: MilestoneStatus;
}): Promise<Result<{ id: string }>> {
  const supabase = await createClient();
  const org_id = await currentOrgId();
  if (!org_id) return { error: "No org" };

  // Position = max+1
  const { data: maxRow } = (await supabase
    .from("project_milestones")
    .select("position")
    .eq("project_id", input.project_id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle()) as { data: { position: number } | null };
  const nextPos = (maxRow?.position ?? -1) + 1;

  const { data: u } = await supabase.auth.getUser();
  const { data, error } = (await supabase
    .from("project_milestones")
    .insert({
      org_id,
      project_id: input.project_id,
      title: input.title,
      description_es: input.description_es,
      occurred_on: input.occurred_on,
      status: input.status,
      position: nextPos,
      completed_at: input.status === "completado" ? new Date().toISOString() : null,
      created_by_user_id: u.user?.id ?? null,
    })
    .select("id")
    .single()) as { data: { id: string } | null; error: { message: string } | null };

  if (error || !data) return { error: error?.message ?? "Falló crear hito" };

  revalidatePath(`/maintenance/projects/${input.project_id}`);
  return { ok: true, data: { id: data.id } };
}

export async function updateMilestone(
  milestoneId: string,
  projectId: string,
  patch: Partial<{
    title: string;
    description_es: string | null;
    status: MilestoneStatus;
    occurred_on: string | null;
  }>,
): Promise<Result> {
  const supabase = await createClient();
  const update: Record<string, unknown> = { ...patch };
  if (patch.status === "completado") update.completed_at = new Date().toISOString();
  if (patch.status && patch.status !== "completado") update.completed_at = null;

  const { error } = await supabase
    .from("project_milestones")
    .update(update)
    .eq("id", milestoneId);
  if (error) return { error: error.message };
  revalidatePath(`/maintenance/projects/${projectId}`);
  return { ok: true };
}

export async function deleteMilestone(
  milestoneId: string,
  projectId: string,
): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("project_milestones")
    .delete()
    .eq("id", milestoneId);
  if (error) return { error: error.message };
  revalidatePath(`/maintenance/projects/${projectId}`);
  return { ok: true };
}

// Browser uploads to the bucket and then calls this to register the row.
// Tiny payload — works for videos beyond the server-action 4.5MB body limit.
export async function registerMilestoneMedia(
  projectId: string,
  milestoneId: string,
  kind: "photo" | "video",
  path: string,
): Promise<Result<{ id: string; path: string; kind: "photo" | "video" }>> {
  const supabase = await createClient();
  const org_id = await currentOrgId();
  if (!org_id) return { error: "No org" };

  const { data: maxRow } = (await supabase
    .from("project_milestone_media")
    .select("position")
    .eq("milestone_id", milestoneId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle()) as { data: { position: number } | null };
  const nextPos = (maxRow?.position ?? -1) + 1;

  const { data, error } = (await supabase
    .from("project_milestone_media")
    .insert({ org_id, milestone_id: milestoneId, kind, path, position: nextPos })
    .select("id")
    .single()) as { data: { id: string } | null; error: { message: string } | null };

  if (error || !data) return { error: error?.message ?? "Falló registrar media" };

  revalidatePath(`/maintenance/projects/${projectId}`);
  return { ok: true, data: { id: data.id, path, kind } };
}

export async function removeMilestoneMedia(
  projectId: string,
  mediaId: string,
): Promise<Result> {
  const supabase = await createClient();
  const { data: target } = (await supabase
    .from("project_milestone_media")
    .select("path")
    .eq("id", mediaId)
    .single()) as { data: { path: string } | null };

  const { error } = await supabase
    .from("project_milestone_media")
    .delete()
    .eq("id", mediaId);
  if (error) return { error: error.message };

  if (target?.path) {
    await supabase.storage.from("cotiza-projects").remove([target.path]).catch(() => {});
  }

  revalidatePath(`/maintenance/projects/${projectId}`);
  return { ok: true };
}

// Browser uploads cover then registers the path here.
export async function registerCoverPhoto(
  projectId: string,
  path: string,
): Promise<Result<{ path: string }>> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("client_projects")
    .update({ cover_photo_path: path })
    .eq("id", projectId);
  if (error) return { error: error.message };
  revalidatePath(`/maintenance/projects/${projectId}`);
  revalidatePath("/maintenance/projects");
  return { ok: true, data: { path } };
}

export async function shareProjectLink(
  projectId: string,
): Promise<Result<{ url: string; token: string }>> {
  const supabase = await createClient();
  const org_id = await currentOrgId();
  if (!org_id) return { error: "No org" };

  // Reuse an existing project_view link if any, otherwise create one
  const { data: project } = (await supabase
    .from("client_projects")
    .select("client_id")
    .eq("id", projectId)
    .single()) as { data: { client_id: string } | null };
  if (!project) return { error: "Proyecto no encontrado" };

  const { data: existing } = (await supabase
    .from("share_links")
    .select("token")
    .eq("client_id", project.client_id)
    .eq("kind", "project_view")
    .limit(1)
    .maybeSingle()) as { data: { token: string } | null };

  let token = existing?.token;
  if (!token) {
    const newToken = `prj-${randomUUID().slice(0, 12)}`;
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("share_links").insert({
      org_id,
      client_id: project.client_id,
      kind: "project_view",
      token: newToken,
      created_by: u.user?.id ?? null,
    });
    if (error) return { error: error.message };
    token = newToken;
  }

  return { ok: true, data: { token, url: `/p/${token}/projects/${projectId}` } };
}

export type ProjectDetail = {
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

// ============================================================================
// Project captures (admin)
// ============================================================================

async function loadProjectCaptureData(
  projectId: string,
): Promise<{ org_id: string; capture_data: ProjectCapture[] } | null> {
  const supabase = await createClient();
  const { data } = (await supabase
    .from("client_projects")
    .select("org_id, capture_data")
    .eq("id", projectId)
    .maybeSingle()) as {
    data: { org_id: string; capture_data: ProjectCapture[] | null } | null;
  };
  if (!data) return null;
  return { org_id: data.org_id, capture_data: data.capture_data ?? [] };
}

export async function addAdminProjectCapture(
  projectId: string,
  payload: { kind: ProjectCaptureKind; text?: string | null; media_path?: string | null; hint?: string | null },
): Promise<Result<{ capture: ProjectCapture }>> {
  const supabase = await createClient();
  const ctx = await loadProjectCaptureData(projectId);
  if (!ctx) return { error: "Proyecto no encontrado" };

  const newItem: ProjectCapture = {
    id: randomUUID(),
    kind: payload.kind,
    text: payload.text?.trim() || null,
    media_path: payload.media_path ?? null,
    hint: payload.hint?.trim() || null,
    captured_at: new Date().toISOString(),
    processed_at: null,
  };
  const next = [...ctx.capture_data, newItem];

  const { error } = await supabase
    .from("client_projects")
    .update({ capture_data: next })
    .eq("id", projectId);
  if (error) return { error: error.message };

  revalidatePath(`/maintenance/projects/${projectId}`);
  return { ok: true, data: { capture: newItem } };
}

// Browser uploads directly to the bucket then calls this with the path.
export async function registerAdminProjectCaptureMedia(
  projectId: string,
  kind: "photo" | "video",
  path: string,
): Promise<Result<{ capture: ProjectCapture }>> {
  return await addAdminProjectCapture(projectId, { kind, media_path: path });
}

export async function removeAdminProjectCapture(
  projectId: string,
  captureId: string,
): Promise<Result> {
  const supabase = await createClient();
  const ctx = await loadProjectCaptureData(projectId);
  if (!ctx) return { error: "Proyecto no encontrado" };

  const target = ctx.capture_data.find((c) => c.id === captureId);
  const next = ctx.capture_data.filter((c) => c.id !== captureId);

  const { error } = await supabase
    .from("client_projects")
    .update({ capture_data: next })
    .eq("id", projectId);
  if (error) return { error: error.message };

  if (target?.media_path) {
    await supabase.storage.from("cotiza-projects").remove([target.media_path]).catch(() => {});
  }
  revalidatePath(`/maintenance/projects/${projectId}`);
  return { ok: true };
}

export async function structureAdminProjectWithAI(
  projectId: string,
): Promise<Result<{ added: number }>> {
  const supabase = await createClient();
  const ctx = await loadProjectCaptureData(projectId);
  if (!ctx) return { error: "Proyecto no encontrado" };

  const unprocessed = ctx.capture_data.filter((c) => !c.processed_at);
  if (unprocessed.length === 0) return { error: "No hay capturas nuevas para procesar" };

  // Project + client + location + milestone metadata
  type ProjectInfo = {
    id: string;
    name: string;
    project_type: ProjectType;
    description_es: string | null;
    expected_completion_date: string | null;
    client: { name: string } | { name: string }[];
    location: { name: string } | { name: string }[] | null;
  };
  const { data: prj } = (await supabase
    .from("client_projects")
    .select(
      "id, name, project_type, description_es, expected_completion_date, client:clients!inner(name), location:client_locations(name)",
    )
    .eq("id", projectId)
    .single()) as { data: ProjectInfo | null };
  if (!prj) return { error: "Proyecto no encontrado" };
  const client = Array.isArray(prj.client) ? prj.client[0] : prj.client;
  const location = Array.isArray(prj.location) ? prj.location[0] : prj.location;

  type MilestoneRow = {
    id: string;
    title: string;
    status: string;
    description_es: string | null;
    project_milestone_entries: { id: string }[] | null;
  };
  const { data: ms } = (await supabase
    .from("project_milestones")
    .select("id, title, status, description_es, project_milestone_entries(id)")
    .eq("project_id", projectId)) as { data: MilestoneRow[] | null };

  const photoBuffers: { id: string; path: string; data: Buffer; mimeType: string }[] = [];
  for (const c of unprocessed) {
    if (c.kind === "photo" && c.media_path) {
      const { data } = await supabase.storage.from("cotiza-projects").download(c.media_path);
      if (data) {
        photoBuffers.push({
          id: c.id,
          path: c.media_path,
          data: Buffer.from(await data.arrayBuffer()),
          mimeType: data.type || "image/jpeg",
        });
      }
    }
  }

  let result;
  try {
    result = await structureProjectFromCaptures({
      project: {
        id: prj.id,
        name: prj.name,
        project_type: prj.project_type,
        description_es: prj.description_es,
        expected_completion_date: prj.expected_completion_date,
      },
      client_name: client?.name ?? "—",
      location_name: location?.name ?? null,
      existing_milestones: (ms ?? []).map((m) => ({
        id: m.id,
        title: m.title,
        status: m.status,
        description_es: m.description_es,
        entry_count: (m.project_milestone_entries ?? []).length,
      })),
      captures: unprocessed,
      photos: photoBuffers,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falló estructurar con IA" };
  }

  const { error } = await supabase.rpc("apply_admin_project_structuring", {
    _project_id: projectId,
    _structured: result,
  });
  if (error) return { error: error.message };

  revalidatePath(`/maintenance/projects/${projectId}`);
  return { ok: true, data: { added: result.processed_capture_ids.length } };
}
