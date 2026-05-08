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

export type AssignmentInput = { client_id: string; location_id: string | null };

export async function setTechnicianAssignments(
  technicianId: string,
  assignments: AssignmentInput[],
): Promise<Result> {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { error: "Sesión expirada" };

  const { data: tech } = (await supabase
    .from("technicians")
    .select("org_id")
    .eq("id", technicianId)
    .single()) as { data: { org_id: string } | null };
  if (!tech) return { error: "Personal no encontrado" };

  // Replace all assignments for this tech atomically.
  const { error: delErr } = await supabase
    .from("technician_assignments")
    .delete()
    .eq("technician_id", technicianId);
  if (delErr) return { error: delErr.message };

  if (assignments.length > 0) {
    const rows = assignments.map((a) => ({
      org_id: tech.org_id,
      technician_id: technicianId,
      client_id: a.client_id,
      location_id: a.location_id,
    }));
    const { error: insErr } = await supabase.from("technician_assignments").insert(rows);
    if (insErr) return { error: insErr.message };
  }

  revalidatePath("/maintenance/technicians");
  revalidatePath(`/maintenance/technicians/${technicianId}`);
  return { ok: true };
}
