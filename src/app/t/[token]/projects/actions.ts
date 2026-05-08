"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import type {
  MilestoneStatus,
  ProjectCapture,
  ProjectCaptureKind,
  ProjectStatus,
  ProjectType,
} from "@/lib/projects/types";
import { structureProjectFromCaptures } from "@/lib/ai/structure-project";

type Result<T = void> = { error: string } | (T extends void ? { ok: true } : { ok: true; data: T });

async function loadProjectForToken(
  token: string,
  projectId: string,
): Promise<{
  project: {
    id: string;
    name: string;
    project_type: ProjectType;
    description_es: string | null;
    expected_completion_date: string | null;
    capture_data: ProjectCapture[];
  };
  client: { name: string };
  location: { name: string } | null;
  milestones: { id: string; title: string; status: string; description_es: string | null; entry_count: number }[];
} | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_technician_project", {
    _token: token,
    _project_id: projectId,
  });
  if (!data) return null;
  type RpcShape = {
    project: {
      id: string;
      name: string;
      project_type: ProjectType;
      description_es: string | null;
      expected_completion_date: string | null;
      capture_data: ProjectCapture[];
    };
    client: { name: string };
    location: { name: string } | null;
    milestones: {
      id: string;
      title: string;
      status: string;
      description_es: string | null;
      entries: unknown[];
    }[];
  };
  const r = data as RpcShape;
  return {
    project: r.project,
    client: r.client,
    location: r.location,
    milestones: r.milestones.map((m) => ({
      id: m.id,
      title: m.title,
      status: m.status,
      description_es: m.description_es,
      entry_count: (m.entries ?? []).length,
    })),
  };
}

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

// ============================================================================
// Project captures (raw uploads — accumulated until AI structures them)
// ============================================================================

export async function addProjectCapture(
  token: string,
  projectId: string,
  payload: { kind: ProjectCaptureKind; text?: string | null; media_path?: string | null; hint?: string | null },
): Promise<Result<{ capture: ProjectCapture }>> {
  const supabase = await createClient();
  const { data: project } = (await supabase.rpc("get_technician_project", {
    _token: token,
    _project_id: projectId,
  })) as { data: { project: { capture_data: ProjectCapture[] } } | null };
  if (!project) return { error: "Proyecto no encontrado" };

  const newItem: ProjectCapture = {
    id: randomUUID(),
    kind: payload.kind,
    text: payload.text?.trim() || null,
    media_path: payload.media_path ?? null,
    hint: payload.hint?.trim() || null,
    captured_at: new Date().toISOString(),
    processed_at: null,
  };
  const next = [...(project.project.capture_data ?? []), newItem];

  const { error } = await supabase.rpc("update_technician_project_capture", {
    _token: token,
    _project_id: projectId,
    _capture_data: next,
  });
  if (error) return { error: error.message };

  revalidatePath(`/t/${token}/projects/${projectId}`);
  return { ok: true, data: { capture: newItem } };
}

export async function uploadProjectCaptureMedia(
  token: string,
  projectId: string,
  formData: FormData,
): Promise<Result<{ capture: ProjectCapture }>> {
  const file = formData.get("file") as File | null;
  if (!file) return { error: "Archivo faltante" };

  const supabase = await createClient();
  const isVideo = file.type.startsWith("video/");
  const kind: ProjectCaptureKind = isVideo ? "video" : "photo";
  const ext = (file.name.split(".").pop() ?? (isVideo ? "mp4" : "jpg")).toLowerCase();
  const path = `tech/${token.slice(0, 8)}/${projectId}/captures/${randomUUID()}.${ext}`;

  const buf = await file.arrayBuffer();
  const { error: upErr } = await supabase.storage
    .from("cotiza-projects")
    .upload(path, buf, {
      contentType: file.type || (isVideo ? "video/mp4" : "image/jpeg"),
      upsert: false,
    });
  if (upErr) return { error: `Falló subida: ${upErr.message}` };

  return await addProjectCapture(token, projectId, { kind, media_path: path });
}

export async function removeProjectCapture(
  token: string,
  projectId: string,
  captureId: string,
): Promise<Result> {
  const supabase = await createClient();
  const { data: project } = (await supabase.rpc("get_technician_project", {
    _token: token,
    _project_id: projectId,
  })) as { data: { project: { capture_data: ProjectCapture[] } } | null };
  if (!project) return { error: "Proyecto no encontrado" };

  const target = project.project.capture_data.find((c) => c.id === captureId);
  const next = project.project.capture_data.filter((c) => c.id !== captureId);

  const { error } = await supabase.rpc("update_technician_project_capture", {
    _token: token,
    _project_id: projectId,
    _capture_data: next,
  });
  if (error) return { error: error.message };

  if (target?.media_path) {
    await supabase.storage.from("cotiza-projects").remove([target.media_path]).catch(() => {});
  }
  revalidatePath(`/t/${token}/projects/${projectId}`);
  return { ok: true };
}

export async function structureTechnicianProjectWithAI(
  token: string,
  projectId: string,
): Promise<Result<{ added: number }>> {
  const supabase = await createClient();
  const ctx = await loadProjectForToken(token, projectId);
  if (!ctx) return { error: "Proyecto no encontrado" };

  const unprocessed = (ctx.project.capture_data ?? []).filter((c) => !c.processed_at);
  if (unprocessed.length === 0) return { error: "No hay capturas nuevas para procesar" };

  // Download photos referenced in unprocessed captures
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
      project: ctx.project,
      client_name: ctx.client.name,
      location_name: ctx.location?.name ?? null,
      existing_milestones: ctx.milestones,
      captures: unprocessed,
      photos: photoBuffers,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falló estructurar con IA" };
  }

  const { error } = await supabase.rpc("apply_technician_project_structuring", {
    _token: token,
    _project_id: projectId,
    _structured: result,
  });
  if (error) return { error: error.message };

  revalidatePath(`/t/${token}/projects/${projectId}`);
  return { ok: true, data: { added: result.processed_capture_ids.length } };
}
