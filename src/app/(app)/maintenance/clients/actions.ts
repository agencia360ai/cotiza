"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";

type Result = { error: string } | { ok: true };

async function userOrgId() {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Sesión expirada");
  const { data: m } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", u.user.id)
    .limit(1)
    .single();
  if (!m) throw new Error("Sin organización");
  return { supabase, orgId: m.org_id as string, userId: u.user.id };
}

// CLIENTS

export async function createClientRecord(input: { name: string; brand_color?: string }) {
  const { supabase, orgId } = await userOrgId();
  const { data, error } = await supabase
    .from("clients")
    .insert({ org_id: orgId, name: input.name, brand_color: input.brand_color ?? null })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "No se pudo crear" };
  revalidatePath("/maintenance/clients");
  redirect(`/maintenance/clients/${data.id}`);
}

export async function updateClient(id: string, patch: {
  name?: string;
  category?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  brand_color?: string | null;
  notes?: string | null;
}): Promise<Result> {
  const { supabase } = await userOrgId();
  const { error } = await supabase.from("clients").update(patch).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/maintenance/clients/${id}`);
  return { ok: true };
}

export async function deleteClientRecord(id: string): Promise<Result> {
  const { supabase } = await userOrgId();
  const { error } = await supabase.from("clients").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/maintenance/clients");
  return { ok: true };
}

// LOGO

export async function uploadClientLogo(clientId: string, formData: FormData): Promise<Result> {
  const file = formData.get("file") as File | null;
  if (!file) return { error: "Archivo faltante" };
  const { supabase, orgId } = await userOrgId();
  const ext = (file.name.split(".").pop() ?? "png").toLowerCase();
  const path = `${orgId}/clients/${clientId}/logo-${randomUUID()}.${ext}`;
  const buf = await file.arrayBuffer();
  const { error: upErr } = await supabase.storage
    .from("cotiza-maintenance")
    .upload(path, buf, { contentType: file.type || "image/png", upsert: false });
  if (upErr) return { error: upErr.message };

  const { data: prev } = await supabase
    .from("clients")
    .select("logo_path")
    .eq("id", clientId)
    .single();
  const { error } = await supabase.from("clients").update({ logo_path: path }).eq("id", clientId);
  if (error) return { error: error.message };
  if (prev?.logo_path) {
    await supabase.storage.from("cotiza-maintenance").remove([prev.logo_path]).catch(() => {});
  }
  revalidatePath(`/maintenance/clients/${clientId}`);
  return { ok: true };
}

export async function removeClientLogo(clientId: string): Promise<Result> {
  const { supabase } = await userOrgId();
  const { data: prev } = await supabase
    .from("clients")
    .select("logo_path")
    .eq("id", clientId)
    .single();
  const { error } = await supabase.from("clients").update({ logo_path: null }).eq("id", clientId);
  if (error) return { error: error.message };
  if (prev?.logo_path) {
    await supabase.storage.from("cotiza-maintenance").remove([prev.logo_path]).catch(() => {});
  }
  revalidatePath(`/maintenance/clients/${clientId}`);
  return { ok: true };
}

// SCHEDULES

type Frequency = "mensual" | "bimestral" | "trimestral" | "semestral" | "anual" | "custom";

function addFrequency(date: Date, frequency: Frequency, days: number | null): Date {
  const next = new Date(date);
  switch (frequency) {
    case "mensual":
      next.setMonth(next.getMonth() + 1);
      break;
    case "bimestral":
      next.setMonth(next.getMonth() + 2);
      break;
    case "trimestral":
      next.setMonth(next.getMonth() + 3);
      break;
    case "semestral":
      next.setMonth(next.getMonth() + 6);
      break;
    case "anual":
      next.setFullYear(next.getFullYear() + 1);
      break;
    case "custom":
      next.setDate(next.getDate() + (days ?? 30));
      break;
  }
  return next;
}

export async function createSchedule(
  clientId: string,
  input: {
    location_id: string | null;
    report_type: "preventivo" | "inspeccion" | "instalacion";
    frequency: Frequency;
    frequency_days?: number | null;
    start_date: string;
    assigned_technician_id?: string | null;
    notes?: string | null;
  },
): Promise<Result> {
  const { supabase, orgId } = await userOrgId();
  const start = new Date(input.start_date + "T00:00:00");
  const next = addFrequency(start, input.frequency, input.frequency_days ?? null);
  const { error } = await supabase.from("maintenance_schedules").insert({
    org_id: orgId,
    client_id: clientId,
    location_id: input.location_id,
    report_type: input.report_type,
    frequency: input.frequency,
    frequency_days: input.frequency === "custom" ? input.frequency_days ?? 30 : null,
    start_date: input.start_date,
    next_due_date: next.toISOString().slice(0, 10),
    assigned_technician_id: input.assigned_technician_id ?? null,
    notes: input.notes ?? null,
    active: true,
  });
  if (error) return { error: error.message };
  revalidatePath(`/maintenance/clients/${clientId}`);
  revalidatePath("/maintenance/schedule");
  return { ok: true };
}

export async function updateSchedule(
  id: string,
  clientId: string,
  patch: Partial<{
    frequency: Frequency;
    frequency_days: number | null;
    next_due_date: string;
    assigned_technician_id: string | null;
    notes: string | null;
    active: boolean;
  }>,
): Promise<Result> {
  const { supabase } = await userOrgId();
  const { error } = await supabase.from("maintenance_schedules").update(patch).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/maintenance/clients/${clientId}`);
  revalidatePath("/maintenance/schedule");
  return { ok: true };
}

export async function deleteSchedule(id: string, clientId: string): Promise<Result> {
  const { supabase } = await userOrgId();
  const { error } = await supabase.from("maintenance_schedules").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/maintenance/clients/${clientId}`);
  revalidatePath("/maintenance/schedule");
  return { ok: true };
}

// LOCATIONS

export async function createLocation(clientId: string, input: { name: string; address?: string }): Promise<Result> {
  const { supabase } = await userOrgId();
  const { error } = await supabase
    .from("client_locations")
    .insert({ client_id: clientId, name: input.name, address: input.address ?? null });
  if (error) return { error: error.message };
  revalidatePath(`/maintenance/clients/${clientId}`);
  return { ok: true };
}

export async function updateLocation(id: string, clientId: string, patch: { name?: string; address?: string | null }): Promise<Result> {
  const { supabase } = await userOrgId();
  const { error } = await supabase.from("client_locations").update(patch).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/maintenance/clients/${clientId}`);
  return { ok: true };
}

export async function deleteLocation(id: string, clientId: string): Promise<Result> {
  const { supabase } = await userOrgId();
  const { error } = await supabase.from("client_locations").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/maintenance/clients/${clientId}`);
  return { ok: true };
}

// EQUIPMENT

export async function createEquipment(
  locationId: string,
  clientId: string,
  input: { custom_name: string; brand?: string; model?: string; category?: string; location_label?: string; voltage?: string; capacity_btu?: number },
): Promise<Result> {
  const { supabase } = await userOrgId();
  const { error } = await supabase.from("client_equipment").insert({
    location_id: locationId,
    custom_name: input.custom_name,
    brand: input.brand ?? null,
    model: input.model ?? null,
    category: input.category ?? null,
    location_label: input.location_label ?? null,
    voltage: input.voltage ?? null,
    capacity_btu: input.capacity_btu ?? null,
  });
  if (error) return { error: error.message };
  revalidatePath(`/maintenance/clients/${clientId}`);
  return { ok: true };
}

export async function updateEquipment(
  id: string,
  clientId: string,
  patch: Partial<{ custom_name: string; brand: string | null; model: string | null; category: string | null; location_label: string | null; voltage: string | null; capacity_btu: number | null }>,
): Promise<Result> {
  const { supabase } = await userOrgId();
  const { error } = await supabase.from("client_equipment").update(patch).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/maintenance/clients/${clientId}`);
  return { ok: true };
}

export async function deleteEquipment(id: string, clientId: string): Promise<Result> {
  const { supabase } = await userOrgId();
  const { error } = await supabase.from("client_equipment").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/maintenance/clients/${clientId}`);
  return { ok: true };
}

// SHARE LINKS

function generateShareToken(prefix: string): string {
  return `${prefix}-${randomBytes(6).toString("base64url").toLowerCase().replace(/[_-]/g, "")}`;
}

export async function createShareLink(
  clientId: string,
  input: { expiresInDays?: number | null },
): Promise<Result> {
  const { supabase, orgId, userId } = await userOrgId();
  const { data: client } = await supabase.from("clients").select("name").eq("id", clientId).single();
  if (!client) return { error: "Cliente no encontrado" };
  const slug = client.name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 16);
  const token = generateShareToken(slug || "cliente");
  const expires = input.expiresInDays
    ? new Date(Date.now() + input.expiresInDays * 86400000).toISOString()
    : null;
  const { error } = await supabase.from("share_links").insert({
    org_id: orgId,
    client_id: clientId,
    kind: "client_view",
    token,
    expires_at: expires,
    created_by: userId,
  });
  if (error) return { error: error.message };
  revalidatePath(`/maintenance/clients/${clientId}`);
  return { ok: true };
}

export async function deleteShareLink(id: string, clientId: string): Promise<Result> {
  const { supabase } = await userOrgId();
  const { error } = await supabase.from("share_links").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/maintenance/clients/${clientId}`);
  return { ok: true };
}
