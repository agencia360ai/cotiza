import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { ReportPdf, type ReportPdfProps } from "@/lib/pdf/report-pdf";

export const runtime = "nodejs";

type ReportRow = {
  id: string;
  org_id: string;
  client_id: string;
  location_id: string | null;
  report_number: string;
  report_type: string;
  status: string;
  performed_at_start: string;
  performed_by_name: string | null;
  summary_es: string | null;
  trigger_event_es: string | null;
  client: { name: string } | { name: string }[] | null;
  location: { name: string; address: string | null } | { name: string; address: string | null }[] | null;
};

type ItemRow = {
  id: string;
  equipment_status: ReportPdfProps["items"][number]["equipment_status"];
  observations_es: string | null;
  recommendations: ReportPdfProps["items"][number]["recommendations"];
  parts_replaced: ReportPdfProps["items"][number]["parts_replaced"];
  checklist_items: string[];
  photo_paths: string[];
  equipment: ReportPdfProps["items"][number]["equipment"] | ReportPdfProps["items"][number]["equipment"][];
};

function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { data: report } = (await supabase
    .from("maintenance_reports")
    .select(
      "id, org_id, client_id, location_id, report_number, report_type, status, performed_at_start, performed_by_name, summary_es, trigger_event_es, client:clients(name), location:client_locations(name, address)",
    )
    .eq("id", id)
    .single()) as { data: ReportRow | null };
  if (!report) return new NextResponse("Not found", { status: 404 });

  const { data: items } = (await supabase
    .from("report_items")
    .select(
      "id, equipment_status, observations_es, recommendations, parts_replaced, checklist_items, photo_paths, equipment:client_equipment(brand, model, custom_name, location_label)",
    )
    .eq("report_id", id)
    .order("position", { ascending: true })) as { data: ItemRow[] | null };

  const { data: org } = (await supabase
    .from("organizations")
    .select("name, logo_path")
    .eq("id", report.org_id)
    .single()) as { data: { name: string; logo_path: string | null } | null };

  const { data: acceptance } = (await supabase
    .from("report_acceptances")
    .select("signed_by_name, signed_at, signature_path")
    .eq("report_id", id)
    .maybeSingle()) as { data: ReportPdfProps["acceptance"] | null };

  const storageBase = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  const buffer = await renderToBuffer(
    ReportPdf({
      storageBase,
      serviceProvider: { name: org?.name ?? "Reportme.ai", logo_path: org?.logo_path ?? null },
      client: { name: one(report.client)?.name ?? "—" },
      location: one(report.location),
      report,
      items: (items ?? []).map((it) => ({
        id: it.id,
        equipment_status: it.equipment_status,
        observations_es: it.observations_es,
        recommendations: it.recommendations ?? [],
        parts_replaced: it.parts_replaced ?? [],
        checklist_items: it.checklist_items ?? [],
        photo_paths: it.photo_paths ?? [],
        equipment: one(it.equipment),
      })),
      acceptance: acceptance ?? null,
    }),
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${report.report_number}.pdf"`,
    },
  });
}
