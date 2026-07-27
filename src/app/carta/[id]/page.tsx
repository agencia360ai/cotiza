import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import type { LetterData } from "@/lib/quotes/letter";
import { CartaEditor } from "./editor";

export const dynamic = "force-dynamic";

type QuoteForLetter = {
  quote_number: string;
  sent_date: string | null;
  client_name: string | null;
  description: string | null;
  amount_usd: number | null;
  letter: LetterData | null;
  client: { name: string } | null;
  location: { name: string } | null;
};

export default async function CartaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) redirect("/login");
  const orgId = await getActiveOrgId();
  if (!orgId) redirect("/onboarding");

  const run = (cols: string) =>
    supabase.from("sales_quotes").select(cols).eq("id", id).eq("org_id", orgId).maybeSingle();
  let res = (await run(
    "quote_number, sent_date, client_name, description, amount_usd, letter, client:clients(name), location:client_locations(name)",
  )) as { data: QuoteForLetter | null; error: { message: string } | null };
  if (res.error) {
    // Migración 0008 pendiente: sin la columna letter.
    res = (await run(
      "quote_number, sent_date, client_name, description, amount_usd, client:clients(name), location:client_locations(name)",
    )) as { data: QuoteForLetter | null; error: { message: string } | null };
  }
  const q = res.data;
  if (!q) notFound();

  const letter: LetterData =
    q.letter ?? {
      fecha: q.sent_date ?? new Date().toISOString().slice(0, 10),
      ubicacion: q.location?.name ?? null,
      tipo: "realizar",
      items: [{ cant: 1, desc: q.description ?? "Trabajos según cotización", precio: q.amount_usd ?? 0 }],
      aplica_itbms: false,
      tasa: 7,
      validez: null,
      condiciones: null,
      elaborado: null,
    };
  const cliente = q.client?.name ?? q.client_name ?? "Cliente";

  // Firma seleccionada (best-effort: sin la 0036 o si se borró, va sin firma).
  let firmaUrl: string | null = null;
  if (letter.firma?.id) {
    const { data: sig } = (await supabase
      .from("quote_signatures")
      .select("data_url")
      .eq("id", letter.firma.id)
      .eq("org_id", orgId)
      .maybeSingle()) as { data: { data_url: string } | null };
    firmaUrl = sig?.data_url ?? null;
  }

  return (
    <div className="min-h-screen bg-slate-200 px-4 py-6 print:bg-white print:p-0">
      <CartaEditor
        quoteId={id}
        quoteNumber={q.quote_number}
        cliente={cliente}
        letter={letter}
        firmaUrlInicial={firmaUrl}
      />
    </div>
  );
}
