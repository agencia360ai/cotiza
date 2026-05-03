import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { TechnicianReportData } from "@/lib/maintenance/types";
import { ReportScreen } from "./screen";

export const dynamic = "force-dynamic";

async function loadReport(token: string, reportId: string): Promise<TechnicianReportData | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_technician_report", {
    _token: token,
    _report_id: reportId,
  });
  return (data as TechnicianReportData) ?? null;
}

export default async function TechnicianReportPage({
  params,
}: {
  params: Promise<{ token: string; id: string }>;
}) {
  const { token, id } = await params;
  const data = await loadReport(token, id);
  if (!data) notFound();
  return <ReportScreen token={token} initialData={data} />;
}
