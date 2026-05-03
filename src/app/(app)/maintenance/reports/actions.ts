"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import type { ReportType, ReportSeverity, EquipmentStatus, Recommendation } from "@/lib/maintenance/types";

type Result<T = void> = { error: string } | (T extends void ? { ok: true } : { ok: true; data: T });

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

// PUBLISH / UNPUBLISH / DELETE / SUMMARY (existing)

export async function publishReport(reportId: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("maintenance_reports")
    .update({ status: "published", published_at: new Date().toISOString() })
    .eq("id", reportId);
  if (error) return { error: error.message };
  revalidatePath("/maintenance/reports");
  revalidatePath(`/maintenance/reports/${reportId}`);
  return { ok: true };
}

export async function unpublishReport(reportId: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("maintenance_reports")
    .update({ status: "draft", published_at: null })
    .eq("id", reportId);
  if (error) return { error: error.message };
  revalidatePath("/maintenance/reports");
  revalidatePath(`/maintenance/reports/${reportId}`);
  return { ok: true };
}

export async function deleteReport(reportId: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("maintenance_reports").delete().eq("id", reportId);
  if (error) return { error: error.message };
  revalidatePath("/maintenance/reports");
  return { ok: true };
}

export async function updateReportSummary(reportId: string, summary: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("maintenance_reports")
    .update({ summary_es: summary })
    .eq("id", reportId);
  if (error) return { error: error.message };
  revalidatePath(`/maintenance/reports/${reportId}`);
  return { ok: true };
}

// CREATE INTERNAL REPORT

export async function createInternalReport(input: {
  client_id: string;
  location_id: string;
  report_type: ReportType;
  severity?: ReportSeverity;
  trigger_event?: string;
  performed_by_name?: string;
  technician_id?: string | null;
}) {
  const { supabase, orgId, userId } = await userOrgId();
  const number = `${input.report_type.slice(0, 3).toUpperCase()}-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;
  const { data, error } = await supabase
    .from("maintenance_reports")
    .insert({
      client_id: input.client_id,
      location_id: input.location_id,
      org_id: orgId,
      report_number: number,
      performed_at_start: new Date().toISOString(),
      performed_by_name: input.performed_by_name ?? null,
      report_type: input.report_type,
      severity: input.severity ?? null,
      trigger_event_es: input.trigger_event ?? null,
      status: "draft",
      technician_id: input.technician_id ?? null,
      created_by: userId,
      capture_data: [],
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "No se pudo crear el reporte" };
  revalidatePath("/maintenance/reports");
  redirect(`/maintenance/reports/${data.id}`);
}

// UPDATE REPORT FIELDS

export async function updateReportFields(
  reportId: string,
  patch: Partial<{
    report_type: ReportType;
    severity: ReportSeverity | null;
    trigger_event_es: string | null;
    performed_at_start: string;
    performed_at_end: string | null;
    performed_by_name: string | null;
    performed_by_phone: string | null;
    engineer_name: string | null;
    engineer_phone: string | null;
    engineer_email: string | null;
    next_service_date: string | null;
    technician_id: string | null;
    location_id: string | null;
  }>,
): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("maintenance_reports")
    .update(patch)
    .eq("id", reportId);
  if (error) return { error: error.message };
  revalidatePath(`/maintenance/reports/${reportId}`);
  return { ok: true };
}

// ITEM CRUD

export async function addReportItem(
  reportId: string,
  equipmentId: string,
  initial?: Partial<{
    equipment_status: EquipmentStatus;
    observations_es: string;
  }>,
): Promise<Result<{ id: string }>> {
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("report_items")
    .select("id")
    .eq("report_id", reportId)
    .eq("equipment_id", equipmentId)
    .maybeSingle();
  if (existing) return { error: "Ese equipo ya está en el reporte" };

  const { data: max } = await supabase
    .from("report_items")
    .select("position")
    .eq("report_id", reportId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = (max?.position ?? -1) + 1;

  const { data, error } = await supabase
    .from("report_items")
    .insert({
      report_id: reportId,
      equipment_id: equipmentId,
      equipment_status: initial?.equipment_status ?? "sin_inspeccion",
      observations_es: initial?.observations_es ?? null,
      recommendations: [],
      parts_replaced: [],
      checklist_items: [],
      photo_paths: [],
      position,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "No se pudo agregar" };
  revalidatePath(`/maintenance/reports/${reportId}`);
  return { ok: true, data: { id: data.id } };
}

export async function updateReportItem(
  reportId: string,
  itemId: string,
  patch: Partial<{
    equipment_status: EquipmentStatus;
    observations_es: string | null;
    recommendations: Recommendation[];
    parts_replaced: { name: string; quantity?: number }[];
    checklist_items: string[];
    photo_paths: string[];
  }>,
): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("report_items").update(patch).eq("id", itemId);
  if (error) return { error: error.message };
  revalidatePath(`/maintenance/reports/${reportId}`);
  return { ok: true };
}

export async function deleteReportItem(reportId: string, itemId: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("report_items").delete().eq("id", itemId);
  if (error) return { error: error.message };
  revalidatePath(`/maintenance/reports/${reportId}`);
  return { ok: true };
}

// PHOTO UPLOAD

export async function uploadItemPhoto(
  reportId: string,
  itemId: string,
  formData: FormData,
): Promise<Result<{ path: string }>> {
  const file = formData.get("file") as File | null;
  if (!file) return { error: "Archivo faltante" };
  const { supabase, orgId } = await userOrgId();
  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase();
  const path = `${orgId}/${reportId}/${randomUUID()}.${ext}`;
  const buf = await file.arrayBuffer();
  const { error: upErr } = await supabase.storage
    .from("cotiza-maintenance")
    .upload(path, buf, { contentType: file.type || "image/jpeg" });
  if (upErr) return { error: upErr.message };

  // Append to item.photo_paths
  const { data: item } = await supabase
    .from("report_items")
    .select("photo_paths")
    .eq("id", itemId)
    .single();
  const next = [...((item?.photo_paths as string[]) ?? []), path];
  await supabase.from("report_items").update({ photo_paths: next }).eq("id", itemId);
  revalidatePath(`/maintenance/reports/${reportId}`);
  return { ok: true, data: { path } };
}

export async function removeItemPhoto(
  reportId: string,
  itemId: string,
  path: string,
): Promise<Result> {
  const supabase = await createClient();
  const { data: item } = await supabase
    .from("report_items")
    .select("photo_paths")
    .eq("id", itemId)
    .single();
  const next = ((item?.photo_paths as string[]) ?? []).filter((p) => p !== path);
  await supabase.from("report_items").update({ photo_paths: next }).eq("id", itemId);
  // Best-effort remove from storage if it's a stored path (not URL)
  if (!path.startsWith("http")) {
    await supabase.storage.from("cotiza-maintenance").remove([path]).catch(() => {});
  }
  revalidatePath(`/maintenance/reports/${reportId}`);
  return { ok: true };
}
