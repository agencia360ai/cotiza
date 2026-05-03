"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";

type Result = { error: string } | { ok: true };

function generateToken(): string {
  return `tec-${randomBytes(8).toString("base64url").toLowerCase().replace(/[_-]/g, "")}`;
}

export async function createTechnician(input: {
  name: string;
  phone: string | null;
  email: string | null;
}): Promise<Result> {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { error: "Sesión expirada" };

  const { data: membership } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", u.user.id)
    .limit(1)
    .single();
  if (!membership) return { error: "Sin organización" };

  const { error } = await supabase.from("technicians").insert({
    org_id: membership.org_id,
    name: input.name,
    phone: input.phone,
    email: input.email,
    role: "tecnico",
    active: true,
    access_token: generateToken(),
  });
  if (error) return { error: error.message };
  revalidatePath("/maintenance/technicians");
  return { ok: true };
}

export async function updateTechnician(
  id: string,
  patch: { name?: string; phone?: string | null; email?: string | null; active?: boolean },
): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("technicians").update(patch).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/maintenance/technicians");
  return { ok: true };
}

export async function regenerateToken(id: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("technicians")
    .update({ access_token: generateToken() })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/maintenance/technicians");
  return { ok: true };
}

export async function deleteTechnician(id: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("technicians").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/maintenance/technicians");
  return { ok: true };
}
