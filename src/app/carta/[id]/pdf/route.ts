import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { sinAcceso } from "@/lib/acceso";
import { previewQuotePdf, type Db } from "@/lib/quotes/store";
import type { LetterData } from "@/lib/quotes/letter";

export const runtime = "nodejs";

// El PDF de una cotización guardada, tal como se publicaría. Lo usa "Ver carta"
// para el formato Propuesta, que se ve como PDF y no como página editable.
// Los route handlers no pasan por el layout de /carta: el permiso de la
// sección se revisa acá.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return new NextResponse("Sesión expirada", { status: 401 });
  const orgId = await getActiveOrgId();
  if (!orgId) return new NextResponse("Sin organización", { status: 403 });
  const sinPermiso = await sinAcceso("cotizaciones");
  if (sinPermiso) return new NextResponse(sinPermiso, { status: 403 });

  const { data: q } = (await supabase
    .from("sales_quotes")
    .select("quote_number, client_name, letter, client:clients(name)")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle()) as {
    data: { quote_number: string; client_name: string | null; letter: LetterData | null; client: { name: string } | null } | null;
  };
  if (!q?.letter) return new NextResponse("Cotización no encontrada", { status: 404 });

  const pdf = await previewQuotePdf(supabase as unknown as Db, orgId, {
    quote_number: q.quote_number,
    client_name: q.client?.name ?? q.client_name ?? "Cliente",
    letter: q.letter,
  });
  const descargar = new URL(req.url).searchParams.has("descargar");
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${descargar ? "attachment" : "inline"}; filename="${q.quote_number.replace(/[^\w .-]+/g, "")}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
