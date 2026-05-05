"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import type {
  CaptureItem,
  ReportType,
  ReportSeverity,
  TechnicianReportData,
} from "@/lib/maintenance/types";
import { generateReportFromCapture } from "@/lib/ai/generate-maintenance-report";

type Result<T = void> = { error: string } | (T extends void ? { ok: true } : { ok: true; data: T });

async function loadReport(token: string, reportId: string): Promise<TechnicianReportData | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_technician_report", {
    _token: token,
    _report_id: reportId,
  });
  return (data as TechnicianReportData) ?? null;
}

export async function createReport(
  token: string,
  input: {
    client_id: string;
    location_id: string;
    report_type: ReportType;
    severity?: ReportSeverity;
    trigger_event?: string;
  },
) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_technician_report", {
    _token: token,
    _client_id: input.client_id,
    _location_id: input.location_id,
    _report_type: input.report_type,
    _severity: input.severity ?? null,
    _trigger_event: input.trigger_event ?? null,
  });
  if (error || !data) return { error: error?.message ?? "No se pudo crear el reporte" };
  revalidatePath(`/t/${token}`);
  redirect(`/t/${token}/reports/${data}`);
}

export async function uploadCapture(
  token: string,
  reportId: string,
  formData: FormData,
): Promise<Result<{ capture: CaptureItem }>> {
  const file = formData.get("file") as File | null;
  const equipmentId = (formData.get("equipment_id") as string | null) || null;
  if (!file) return { error: "Archivo faltante" };

  const supabase = await createClient();
  const report = await loadReport(token, reportId);
  if (!report) return { error: "Reporte no encontrado" };

  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase();
  const path = `${report.report.org_id}/${report.report.id}/${randomUUID()}.${ext}`;
  const arrayBuf = await file.arrayBuffer();
  const { error: upErr } = await supabase.storage
    .from("cotiza-maintenance")
    .upload(path, arrayBuf, {
      contentType: file.type || "image/jpeg",
      upsert: false,
    });
  if (upErr) return { error: `Falló subida: ${upErr.message}` };

  const newItem: CaptureItem = {
    id: randomUUID(),
    kind: "photo",
    text: null,
    photo_path: path,
    equipment_id: equipmentId,
    captured_at: new Date().toISOString(),
  };
  const next = [...report.report.capture_data, newItem];
  await supabase.rpc("update_technician_capture", {
    _token: token,
    _report_id: reportId,
    _capture_data: next,
  });

  revalidatePath(`/t/${token}/reports/${reportId}`);
  return { ok: true, data: { capture: newItem } };
}

export async function addTextOrVoiceCapture(
  token: string,
  reportId: string,
  payload: { kind: "voice" | "text"; text: string; equipment_id?: string | null },
): Promise<Result> {
  const supabase = await createClient();
  const report = await loadReport(token, reportId);
  if (!report) return { error: "Reporte no encontrado" };
  const trimmed = payload.text.trim();
  if (!trimmed) return { error: "Texto vacío" };

  const newItem: CaptureItem = {
    id: randomUUID(),
    kind: payload.kind,
    text: trimmed,
    photo_path: null,
    equipment_id: payload.equipment_id ?? null,
    captured_at: new Date().toISOString(),
  };
  const next = [...report.report.capture_data, newItem];
  const { error } = await supabase.rpc("update_technician_capture", {
    _token: token,
    _report_id: reportId,
    _capture_data: next,
  });
  if (error) return { error: error.message };
  revalidatePath(`/t/${token}/reports/${reportId}`);
  return { ok: true };
}

export async function removeCapture(token: string, reportId: string, captureId: string): Promise<Result> {
  const supabase = await createClient();
  const report = await loadReport(token, reportId);
  if (!report) return { error: "Reporte no encontrado" };

  const target = report.report.capture_data.find((c) => c.id === captureId);
  const next = report.report.capture_data.filter((c) => c.id !== captureId);
  const { error } = await supabase.rpc("update_technician_capture", {
    _token: token,
    _report_id: reportId,
    _capture_data: next,
  });
  if (error) return { error: error.message };
  if (target?.photo_path) {
    await supabase.storage.from("cotiza-maintenance").remove([target.photo_path]).catch(() => {});
  }
  revalidatePath(`/t/${token}/reports/${reportId}`);
  return { ok: true };
}

export async function generateWithAI(token: string, reportId: string): Promise<Result> {
  const supabase = await createClient();
  const report = await loadReport(token, reportId);
  if (!report) return { error: "Reporte no encontrado" };
  if (report.report.capture_data.length === 0) {
    return { error: "Capturá al menos una foto, voz o nota antes de generar" };
  }

  // Download photos as buffers for Claude vision
  const photoBuffers: { path: string; data: Buffer; mimeType: string }[] = [];
  for (const item of report.report.capture_data) {
    if (item.kind === "photo" && item.photo_path) {
      const { data } = await supabase.storage
        .from("cotiza-maintenance")
        .download(item.photo_path);
      if (data) {
        const mime = data.type || "image/jpeg";
        const buf = Buffer.from(await data.arrayBuffer());
        photoBuffers.push({ path: item.photo_path, data: buf, mimeType: mime });
      }
    }
  }

  let result;
  try {
    result = await generateReportFromCapture({
      client_name: report.client.name,
      location_name: report.location.name,
      report_type: report.report.report_type,
      severity: report.report.severity,
      trigger_event: report.report.trigger_event_es,
      equipment: report.location.equipment.map((e) => ({
        id: e.id,
        custom_name: e.custom_name,
        brand: e.brand,
        model: e.model,
        category: e.category,
        location_label: e.location_label,
      })),
      captures: report.report.capture_data,
      photos: photoBuffers,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falló la generación con IA" };
  }

  // Process new_equipment: insert any equipment the AI detected as new into client_equipment
  // and remap equipment_id so save_technician_report_items has a valid FK.
  for (const it of result.items) {
    if (!it.equipment_id && it.new_equipment) {
      const ne = it.new_equipment;
      const customName =
        `${ne.brand ?? ""} ${ne.model ?? ""}`.trim() ||
        (ne.category ? ne.category.replace(/_/g, " ") : "Equipo nuevo");
      const { data: inserted, error: eqErr } = (await supabase
        .from("client_equipment")
        .insert({
          org_id: report.report.org_id,
          location_id: report.report.location_id,
          custom_name: customName,
          brand: ne.brand,
          model: ne.model,
          category: ne.category,
          location_label: ne.location_label,
          voltage: ne.voltage,
          capacity_btu: ne.capacity_btu,
        })
        .select("id")
        .single()) as { data: { id: string } | null; error: { message: string } | null };
      if (eqErr || !inserted) {
        return { error: `Falló al agregar equipo nuevo detectado: ${eqErr?.message ?? "sin id"}` };
      }
      it.equipment_id = inserted.id;
    }
  }

  // Save items (drop any item that still has no equipment_id — shouldn't happen but be safe)
  const items = result.items
    .filter((it) => !!it.equipment_id)
    .map((it) => ({
      equipment_id: it.equipment_id as string,
      equipment_status: it.status,
      observations_es: it.observations_es,
      recommendations: it.recommendations,
      parts_replaced: it.parts_replaced,
      checklist_items: it.checklist_items,
      photo_paths: it.photo_paths,
    }));

  const { error: saveErr } = await supabase.rpc("save_technician_report_items", {
    _token: token,
    _report_id: reportId,
    _items: items,
  });
  if (saveErr) return { error: saveErr.message };

  await supabase.rpc("mark_technician_report_ai_drafted", {
    _token: token,
    _report_id: reportId,
    _summary: result.summary_es,
  });

  revalidatePath(`/t/${token}/reports/${reportId}`);
  return { ok: true };
}

export async function updateReportItems(
  token: string,
  reportId: string,
  items: {
    equipment_id: string;
    equipment_status: string;
    observations_es: string | null;
    recommendations: { priority: "alta" | "media" | "baja"; description: string }[];
    parts_replaced: { name: string; quantity?: number }[];
    checklist_items: string[];
    photo_paths: string[];
  }[],
  summary: string | null,
): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_technician_report_items", {
    _token: token,
    _report_id: reportId,
    _items: items,
  });
  if (error) return { error: error.message };
  if (summary !== null) {
    await supabase.rpc("submit_technician_report", {
      _token: token,
      _report_id: reportId,
      _summary: summary,
      _performed_at_end: null,
    });
  }
  revalidatePath(`/t/${token}/reports/${reportId}`);
  return { ok: true };
}

export async function submitReport(
  token: string,
  reportId: string,
  summary: string,
): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_technician_report", {
    _token: token,
    _report_id: reportId,
    _summary: summary,
    _performed_at_end: new Date().toISOString(),
  });
  if (error) return { error: error.message };
  revalidatePath(`/t/${token}`);
  revalidatePath(`/t/${token}/reports/${reportId}`);
  return { ok: true };
}

export async function deleteReport(token: string, reportId: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_technician_report", {
    _token: token,
    _report_id: reportId,
  });
  if (error) return { error: error.message };
  revalidatePath(`/t/${token}`);
  return { ok: true };
}
