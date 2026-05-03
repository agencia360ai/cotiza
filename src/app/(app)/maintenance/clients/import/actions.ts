"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseClientFromText, type ImportedClient } from "@/lib/ai/parse-client";

type ParseResult = { error: string } | { ok: true; data: ImportedClient };

export async function parseClientFromInput(formData: FormData): Promise<ParseResult> {
  const text = (formData.get("text") as string | null) ?? "";
  const files = formData.getAll("files") as File[];

  if (!text.trim() && files.length === 0) {
    return { error: "Pegá texto o adjuntá un archivo" };
  }

  const attachments: { mimeType: string; data: Buffer; filename: string }[] = [];
  for (const f of files) {
    if (!f || typeof f === "string") continue;
    const mime = f.type || "application/octet-stream";
    if (!mime.startsWith("image/") && mime !== "application/pdf") continue;
    const buf = Buffer.from(await f.arrayBuffer());
    if (buf.length === 0) continue;
    attachments.push({ mimeType: mime, data: buf, filename: f.name || "adjunto" });
  }

  try {
    const { data } = await parseClientFromText({ text, attachments });
    return { ok: true, data };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falló la IA" };
  }
}

type SaveResult = { error: string } | { ok: true; clientId: string };

function frequencyToDate(start: Date, frequency: string, days: number | null): Date {
  const next = new Date(start);
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
    default:
      next.setMonth(next.getMonth() + 2);
  }
  return next;
}

export async function bulkCreateClient(payload: ImportedClient & { brand_color?: string }): Promise<SaveResult> {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { error: "Sesión expirada" };

  const { data: m } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", u.user.id)
    .limit(1)
    .single();
  if (!m) return { error: "Sin organización" };
  const orgId = m.org_id as string;

  // 1. Create client
  const { data: client, error: cErr } = await supabase
    .from("clients")
    .insert({
      org_id: orgId,
      name: payload.client.name,
      contact_email: payload.client.contact_email,
      contact_phone: payload.client.contact_phone,
      brand_color: payload.brand_color ?? "#0EA5E9",
      notes: payload.client.notes,
    })
    .select("id")
    .single();
  if (cErr || !client) return { error: cErr?.message ?? "No se pudo crear cliente" };

  // 2. Create locations
  const locationIdByName = new Map<string, string>();
  for (const loc of payload.locations) {
    const { data: created, error: lErr } = await supabase
      .from("client_locations")
      .insert({ client_id: client.id, name: loc.name, address: loc.address })
      .select("id")
      .single();
    if (lErr || !created) continue;
    locationIdByName.set(loc.name, created.id);

    // 3. Equipment per location
    if (loc.equipment.length > 0) {
      const equipmentRows = loc.equipment.map((e) => ({
        location_id: created.id,
        custom_name: e.custom_name,
        brand: e.brand,
        model: e.model,
        category: e.category && e.category !== "otro" ? e.category : null,
        location_label: e.location_label,
        voltage: e.voltage,
        capacity_btu: e.capacity_btu,
      }));
      await supabase.from("client_equipment").insert(equipmentRows);
    }
  }

  // 4. Schedules
  if (payload.schedules.length > 0) {
    const today = new Date();
    const scheduleRows = payload.schedules
      .map((s) => {
        const locId = locationIdByName.get(s.location_name);
        if (!locId) return null;
        const next = frequencyToDate(today, s.frequency, s.frequency_days);
        return {
          org_id: orgId,
          client_id: client.id,
          location_id: locId,
          report_type: s.report_type,
          frequency: s.frequency,
          frequency_days: s.frequency === "custom" ? s.frequency_days ?? 30 : null,
          start_date: today.toISOString().slice(0, 10),
          next_due_date: next.toISOString().slice(0, 10),
          active: true,
        };
      })
      .filter((r) => r !== null);
    if (scheduleRows.length > 0) {
      await supabase.from("maintenance_schedules").insert(scheduleRows);
    }
  }

  revalidatePath("/maintenance/clients");
  return { ok: true, clientId: client.id };
}

export async function bulkCreateClientAndRedirect(payload: ImportedClient & { brand_color?: string }) {
  const r = await bulkCreateClient(payload);
  if ("error" in r) return r;
  redirect(`/maintenance/clients/${r.clientId}`);
}
