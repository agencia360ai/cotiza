"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type Result = { error: string } | { ok: true };

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

export async function updateReportSummary(
  reportId: string,
  summary: string,
): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("maintenance_reports")
    .update({ summary_es: summary })
    .eq("id", reportId);
  if (error) return { error: error.message };
  revalidatePath(`/maintenance/reports/${reportId}`);
  return { ok: true };
}
