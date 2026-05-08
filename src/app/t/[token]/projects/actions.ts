"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import type { MilestoneStatus, ProjectStatus, ProjectType } from "@/lib/projects/types";

type Result<T = void> = { error: string } | (T extends void ? { ok: true } : { ok: true; data: T });

export async function createTechnicianProject(
  token: string,
  input: {
    client_id: string;
    location_id: string | null;
    new_location_label: string | null;
    name: string;
    project_type: ProjectType;
    description: string | null;
  },
) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_technician_project", {
    _token: token,
    _client_id: input.client_id,
    _location_id: input.location_id,
    _new_location_label: input.new_location_label,
    _name: input.name,
    _project_type: input.project_type,
    _description: input.description,
  });
  if (error || !data) return { error: error?.message ?? "No se pudo crear el proyecto" };
  revalidatePath(`/t/${token}`);
  redirect(`/t/${token}/projects/${data}`);
}

export async function updateTechnicianProject(
  token: string,
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
  const { error } = await supabase.rpc("update_technician_project", {
    _token: token,
    _project_id: projectId,
    _patch: patch,
  });
  if (error) return { error: error.message };
  revalidatePath(`/t/${token}/projects/${projectId}`);
  revalidatePath(`/t/${token}`);
  return { ok: true };
}

export async function deleteTechnicianProject(token: string, projectId: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_technician_project", {
    _token: token,
    _project_id: projectId,
  });
  if (error) return { error: error.message };
  revalidatePath(`/t/${token}`);
  return { ok: true };
}

export async function addTechnicianMilestone(
  token: string,
  input: {
    project_id: string;
    title: string;
    description: string | null;
    occurred_on: string | null;
    status: MilestoneStatus;
  },
): Promise<Result<{ id: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_technician_milestone", {
    _token: token,
    _project_id: input.project_id,
    _title: input.title,
    _description: input.description,
    _occurred_on: input.occurred_on,
    _status: input.status,
  });
  if (error || !data) return { error: error?.message ?? "Falló crear hito" };
  revalidatePath(`/t/${token}/projects/${input.project_id}`);
  return { ok: true, data: { id: data as string } };
}

export async function updateTechnicianMilestone(
  token: string,
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
  const { error } = await supabase.rpc("update_technician_milestone", {
    _token: token,
    _milestone_id: milestoneId,
    _title: patch.title ?? null,
    _description: patch.description_es ?? null,
    _status: patch.status ?? null,
    _occurred_on: patch.occurred_on ?? null,
  });
  if (error) return { error: error.message };
  revalidatePath(`/t/${token}/projects/${projectId}`);
  return { ok: true };
}

export async function deleteTechnicianMilestone(
  token: string,
  milestoneId: string,
  projectId: string,
): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_technician_milestone", {
    _token: token,
    _milestone_id: milestoneId,
  });
  if (error) return { error: error.message };
  revalidatePath(`/t/${token}/projects/${projectId}`);
  return { ok: true };
}

export async function uploadTechnicianMilestoneMedia(
  token: string,
  projectId: string,
  milestoneId: string,
  formData: FormData,
): Promise<Result<{ id: string; path: string; kind: "photo" | "video" }>> {
  const file = formData.get("file") as File | null;
  if (!file) return { error: "Archivo faltante" };

  const supabase = await createClient();
  const isVideo = file.type.startsWith("video/");
  const kind: "photo" | "video" = isVideo ? "video" : "photo";
  const ext = (file.name.split(".").pop() ?? (isVideo ? "mp4" : "jpg")).toLowerCase();
  const path = `tech/${token.slice(0, 8)}/${projectId}/${milestoneId}/${randomUUID()}.${ext}`;

  const buf = await file.arrayBuffer();
  const { error: upErr } = await supabase.storage
    .from("cotiza-projects")
    .upload(path, buf, {
      contentType: file.type || (isVideo ? "video/mp4" : "image/jpeg"),
      upsert: false,
    });
  if (upErr) return { error: `Falló subida: ${upErr.message}` };

  const { data, error } = await supabase.rpc("add_technician_milestone_media", {
    _token: token,
    _milestone_id: milestoneId,
    _kind: kind,
    _path: path,
  });
  if (error || !data) {
    await supabase.storage.from("cotiza-projects").remove([path]).catch(() => {});
    return { error: error?.message ?? "Falló registrar media" };
  }

  revalidatePath(`/t/${token}/projects/${projectId}`);
  return { ok: true, data: { id: data as string, path, kind } };
}

export async function removeTechnicianMilestoneMedia(
  token: string,
  projectId: string,
  mediaId: string,
): Promise<Result> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_technician_milestone_media", {
    _token: token,
    _media_id: mediaId,
  });
  if (error) return { error: error.message };
  if (data) {
    await supabase.storage.from("cotiza-projects").remove([data as string]).catch(() => {});
  }
  revalidatePath(`/t/${token}/projects/${projectId}`);
  return { ok: true };
}

export async function setTechnicianProjectCover(
  token: string,
  projectId: string,
  formData: FormData,
): Promise<Result<{ path: string }>> {
  const file = formData.get("file") as File | null;
  if (!file) return { error: "Archivo faltante" };

  const supabase = await createClient();
  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase();
  const path = `tech/${token.slice(0, 8)}/${projectId}/cover-${randomUUID()}.${ext}`;
  const buf = await file.arrayBuffer();

  const { error: upErr } = await supabase.storage
    .from("cotiza-projects")
    .upload(path, buf, { contentType: file.type || "image/jpeg", upsert: false });
  if (upErr) return { error: `Falló subida: ${upErr.message}` };

  const { error } = await supabase.rpc("update_technician_project", {
    _token: token,
    _project_id: projectId,
    _patch: { cover_photo_path: path },
  });
  if (error) return { error: error.message };

  revalidatePath(`/t/${token}/projects/${projectId}`);
  revalidatePath(`/t/${token}`);
  return { ok: true, data: { path } };
}
