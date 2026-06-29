"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgContext } from "@/lib/org-context";

type Result = { error: string } | { ok: true };

async function userOrg() {
  const ctx = await getActiveOrgContext();
  if (!ctx) throw new Error("Sin organización");
  const supabase = await createClient();
  return { supabase, orgId: ctx.orgId, role: ctx.role };
}

export async function updateOrgName(name: string): Promise<Result> {
  if (!name.trim()) return { error: "El nombre no puede estar vacío" };
  const { supabase, orgId } = await userOrg();
  const { error } = await supabase
    .from("organizations")
    .update({ name: name.trim() })
    .eq("id", orgId);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function uploadOrgLogo(formData: FormData): Promise<Result> {
  const file = formData.get("file") as File | null;
  if (!file) return { error: "Archivo faltante" };
  const { supabase, orgId } = await userOrg();
  const ext = (file.name.split(".").pop() ?? "png").toLowerCase();
  const path = `orgs/${orgId}/logo-${randomUUID()}.${ext}`;
  const buf = await file.arrayBuffer();
  const { error: upErr } = await supabase.storage
    .from("cotiza-maintenance")
    .upload(path, buf, { contentType: file.type || "image/png" });
  if (upErr) return { error: upErr.message };

  const { data: prev } = await supabase
    .from("organizations")
    .select("logo_path")
    .eq("id", orgId)
    .single();
  const { error } = await supabase
    .from("organizations")
    .update({ logo_path: path })
    .eq("id", orgId);
  if (error) return { error: error.message };
  if (prev?.logo_path) {
    await supabase.storage.from("cotiza-maintenance").remove([prev.logo_path]).catch(() => {});
  }
  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeOrgLogo(): Promise<Result> {
  const { supabase, orgId } = await userOrg();
  const { data: prev } = await supabase
    .from("organizations")
    .select("logo_path")
    .eq("id", orgId)
    .single();
  const { error } = await supabase
    .from("organizations")
    .update({ logo_path: null })
    .eq("id", orgId);
  if (error) return { error: error.message };
  if (prev?.logo_path) {
    await supabase.storage.from("cotiza-maintenance").remove([prev.logo_path]).catch(() => {});
  }
  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateOrgFocus(focus: "maintenance" | "projects" | "mixed"): Promise<Result> {
  if (!["maintenance", "projects", "mixed"].includes(focus)) {
    return { error: "Foco inválido" };
  }
  const { supabase, orgId, role } = await userOrg();
  if (role !== "owner" && role !== "admin") {
    return { error: "Solo owner/admin pueden cambiar el foco" };
  }
  const { error } = await supabase
    .from("organizations")
    .update({ focus })
    .eq("id", orgId);
  if (error) return { error: error.message };
  revalidatePath("/inicio");
  revalidatePath("/settings");
  return { ok: true };
}
