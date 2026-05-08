"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";

type Result<T> = { error: string } | { ok: true; data: T };

export async function acceptProject(
  token: string,
  projectId: string,
  formData: FormData,
): Promise<Result<{ id: string; signature_path: string }>> {
  const file = formData.get("signature") as File | null;
  const name = ((formData.get("name") as string | null) ?? "").trim();
  const email = ((formData.get("email") as string | null) ?? "").trim() || null;

  if (!file) return { error: "Firma faltante" };
  if (!name) return { error: "Nombre faltante" };

  const supabase = await createClient();

  // We don't know org_id at this layer — store the signature under a token-scoped path.
  const path = `accept/${token}/${projectId}/${randomUUID()}.png`;
  const buf = await file.arrayBuffer();
  const { error: upErr } = await supabase.storage
    .from("cotiza-projects")
    .upload(path, buf, { contentType: "image/png", upsert: true });
  if (upErr) return { error: `Falló subida de firma: ${upErr.message}` };

  const { data, error } = await supabase.rpc("submit_project_acceptance", {
    _token: token,
    _project_id: projectId,
    _signed_by_name: name,
    _signed_by_email: email,
    _signature_path: path,
  });
  if (error || !data) return { error: error?.message ?? "No se pudo aceptar" };

  revalidatePath(`/p/${token}/projects/${projectId}`);
  return { ok: true, data: { id: data as string, signature_path: path } };
}
