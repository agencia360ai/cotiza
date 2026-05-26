import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { ReportPdf, type ReportPdfProps } from "@/lib/pdf/report-pdf";

export const runtime = "nodejs";

type RpcData = {
  client: { name: string };
  service_provider: { name: string; logo_path: string | null };
  location: { name: string; address: string | null } | null;
  report: ReportPdfProps["report"];
  items: ReportPdfProps["items"];
  acceptance: ReportPdfProps["acceptance"];
};

export async function GET(
  _: Request,
  { params }: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_public_report", { _token: token, _report_id: id });
  if (!data) return new NextResponse("Not found", { status: 404 });

  const d = data as RpcData;
  const storageBase = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  const buffer = await renderToBuffer(
    ReportPdf({
      storageBase,
      serviceProvider: d.service_provider,
      client: d.client,
      location: d.location,
      report: d.report,
      items: d.items ?? [],
      acceptance: d.acceptance,
    }),
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${d.report.report_number}.pdf"`,
    },
  });
}
