"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  parseLocationsFromInput,
  type ParsedLocationBatch,
} from "@/lib/ai/parse-locations";

type ParseResult =
  | { error: string }
  | { ok: true; data: ParsedLocationBatch };

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
  return { supabase, orgId: m.org_id as string };
}

export async function parseLocationsForClient(
  clientId: string,
  formData: FormData,
): Promise<ParseResult> {
  const text = (formData.get("text") as string | null) ?? "";
  const files = formData.getAll("files") as File[];

  if (!text.trim() && files.length === 0) {
    return { error: "Pegá texto o adjuntá un archivo" };
  }

  const { supabase } = await userOrgId();
  const { data: client } = (await supabase
    .from("clients")
    .select("name")
    .eq("id", clientId)
    .single()) as { data: { name: string } | null };
  if (!client) return { error: "Cliente no encontrado" };

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
    const { data } = await parseLocationsFromInput({
      client_name: client.name,
      text,
      attachments,
    });
    return { ok: true, data };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falló la IA" };
  }
}

function frequencyToDate(start: Date, frequency: string, days: number | null): Date {
  const next = new Date(start);
  switch (frequency) {
    case "mensual": next.setMonth(next.getMonth() + 1); break;
    case "bimestral": next.setMonth(next.getMonth() + 2); break;
    case "trimestral": next.setMonth(next.getMonth() + 3); break;
    case "semestral": next.setMonth(next.getMonth() + 6); break;
    case "anual": next.setFullYear(next.getFullYear() + 1); break;
    case "custom": next.setDate(next.getDate() + (days ?? 30)); break;
    default: next.setMonth(next.getMonth() + 2);
  }
  return next;
}

export async function bulkCreateLocationsForClient(
  clientId: string,
  batch: ParsedLocationBatch,
): Promise<{ error: string } | { ok: true; createdCount: number }> {
  const { supabase, orgId } = await userOrgId();
  const { data: client } = (await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .single()) as { data: { id: string } | null };
  if (!client) return { error: "Cliente no encontrado" };

  let created = 0;
  for (const loc of batch.locations) {
    const { data: newLoc, error: locErr } = (await supabase
      .from("client_locations")
      .insert({
        client_id: clientId,
        name: loc.name,
        address: loc.address,
        notes: loc.notes,
      })
      .select("id")
      .single()) as { data: { id: string } | null; error: { message: string } | null };
    if (locErr || !newLoc) continue;
    created++;

    if (loc.equipment.length > 0) {
      const rows = loc.equipment.map((e) => ({
        location_id: newLoc.id,
        custom_name: e.custom_name,
        brand: e.brand,
        model: e.model,
        category: e.category,
        location_label: e.location_label,
        voltage: e.voltage,
        capacity_btu: e.capacity_btu,
      }));
      await supabase.from("client_equipment").insert(rows);
    }

    if (loc.schedules.length > 0) {
      const today = new Date();
      const scheduleRows = loc.schedules.map((s) => {
        const next = frequencyToDate(today, s.frequency, s.frequency_days);
        return {
          org_id: orgId,
          client_id: clientId,
          location_id: newLoc.id,
          report_type: s.report_type,
          frequency: s.frequency,
          frequency_days: s.frequency === "custom" ? s.frequency_days ?? 30 : null,
          start_date: today.toISOString().slice(0, 10),
          next_due_date: next.toISOString().slice(0, 10),
          active: true,
        };
      });
      await supabase.from("maintenance_schedules").insert(scheduleRows);
    }
  }

  if (created === 0) return { error: "No se pudo crear ninguna sucursal" };
  revalidatePath(`/maintenance/clients/${clientId}`);
  return { ok: true, createdCount: created };
}
