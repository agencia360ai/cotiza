"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";

type Result = { error: string } | { ok: true };

function generateToken(): string {
  return `tec-${randomBytes(8).toString("base64url").toLowerCase().replace(/[_-]/g, "")}`;
}

// Número de WhatsApp normalizado (E.164 sin '+', como llega en el webhook de
// Meta) derivado del teléfono. Panamá: 7-8 dígitos ⇒ prefijar 507. Es la llave
// para identificar al empleado cuando manda su ubicación.
function normalizeWaId(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (/^507\d{7,8}$/.test(digits)) return digits;
  if (/^\d{7,8}$/.test(digits)) return "507" + digits;
  return null;
}

function isMissingColumn(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42703") return true;
  return /does not exist|could not find|schema cache/i.test(error.message ?? "");
}

export async function createTechnician(input: {
  name: string;
  phone: string | null;
  email: string | null;
}): Promise<Result> {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { error: "Sesión expirada" };

  const orgId = await getActiveOrgId();
  if (!orgId) return { error: "Sin organización" };

  const { error } = await supabase.from("technicians").insert({
    org_id: orgId,
    name: input.name,
    phone: input.phone,
    wa_id: normalizeWaId(input.phone),
    email: input.email,
    role: "tecnico",
    active: true,
    access_token: generateToken(),
  });
  if (isMissingColumn(error)) {
    // migración 0031 (wa_id) pendiente: crear sin la columna
    const { error: e2 } = await supabase.from("technicians").insert({
      org_id: orgId, name: input.name, phone: input.phone, email: input.email, role: "tecnico", active: true, access_token: generateToken(),
    });
    if (e2) return { error: e2.message };
    revalidatePath("/personal");
    return { ok: true };
  }
  if (error) return { error: error.message };
  revalidatePath("/personal");
  return { ok: true };
}

export async function updateTechnician(
  id: string,
  patch: { name?: string; phone?: string | null; email?: string | null; active?: boolean },
): Promise<Result> {
  const supabase = await createClient();
  // Si cambió el teléfono, re-derivar el wa_id de WhatsApp.
  const conWa: Record<string, unknown> = { ...patch };
  if ("phone" in patch) conWa.wa_id = normalizeWaId(patch.phone);
  let { error } = await supabase.from("technicians").update(conWa).eq("id", id);
  if (isMissingColumn(error)) {
    delete conWa.wa_id; // migración 0031 pendiente
    ({ error } = await supabase.from("technicians").update(conWa).eq("id", id));
  }
  if (error) return { error: error.message };
  revalidatePath("/personal");
  revalidatePath("/personal/asistencia");
  return { ok: true };
}

export async function regenerateToken(id: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("technicians")
    .update({ access_token: generateToken() })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/personal");
  return { ok: true };
}

export async function deleteTechnician(id: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("technicians").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/personal");
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

  revalidatePath("/personal");
  revalidatePath(`/personal/${technicianId}`);
  return { ok: true };
}
