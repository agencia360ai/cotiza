import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { QuotePdf } from "./quote-pdf";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { data: quote } = await supabase
    .from("quotes")
    .select("*, project:projects(name, client_name, org_id), org:organizations(name)")
    .eq("id", id)
    .single();
  if (!quote) return new NextResponse("Not found", { status: 404 });

  const { data: items } = await supabase
    .from("quote_items")
    .select("name, quantity, unit_price_usd, line_total_usd, ai_reasoning")
    .eq("quote_id", id)
    .order("position", { ascending: true });

  const project = quote.project as { name: string; client_name: string | null };
  const org = quote.org as { name: string } | null;

  const buffer = await renderToBuffer(
    QuotePdf({
      org: { name: org?.name ?? "Cotiza" },
      quote: {
        quote_number: quote.quote_number,
        subtotal_usd: Number(quote.subtotal_usd),
        tax_rate: Number(quote.tax_rate),
        tax_usd: Number(quote.tax_usd),
        total_usd: Number(quote.total_usd),
        notes: quote.notes,
        created_at: quote.created_at,
      },
      project,
      items: (items ?? []).map((it) => ({
        name: it.name,
        quantity: Number(it.quantity),
        unit_price_usd: Number(it.unit_price_usd),
        line_total_usd: Number(it.line_total_usd),
        ai_reasoning: it.ai_reasoning,
      })),
    }),
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${quote.quote_number}.pdf"`,
    },
  });
}
