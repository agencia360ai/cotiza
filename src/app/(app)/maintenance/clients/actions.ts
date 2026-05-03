"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
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
