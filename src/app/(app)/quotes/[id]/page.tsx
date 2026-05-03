import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronRight, Download } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { QuoteItemsEditor } from "./quote-items-editor";

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: quote } = await supabase
    .from("quotes")
    .select("*, project:projects(id, name, client_name)")
    .eq("id", id)
    .single();
  if (!quote) notFound();

  const { data: items } = await supabase
    .from("quote_items")
    .select("id, position, name, description, quantity, unit_price_usd, line_total_usd, ai_reasoning")
    .eq("quote_id", id)
    .order("position", { ascending: true });

  const project = quote.project as { id: string; name: string; client_name: string | null };

  return (
    <div className="px-4 py-6 md:px-10 md:py-8 max-w-5xl">
      <nav className="mb-3 text-sm text-muted-foreground flex items-center gap-1.5">
        <Link href="/dashboard" className="hover:text-foreground">Proyectos</Link>
        <ChevronRight className="size-3.5" />
        <Link href={`/projects/${project.id}`} className="hover:text-foreground">{project.name}</Link>
        <ChevronRight className="size-3.5" />
        <span>{quote.quote_number}</span>
      </nav>

      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{quote.quote_number}</h1>
          <p className="text-sm text-muted-foreground mt-1">{project.name}{project.client_name ? ` · ${project.client_name}` : ""}</p>
        </div>
        <a
          href={`/quotes/${quote.id}/export`}
          className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90"
        >
          <Download className="size-4" />
          Exportar PDF
        </a>
      </header>

      <QuoteItemsEditor quoteId={quote.id} items={items ?? []} />

      <div className="mt-8 ml-auto max-w-sm">
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="tabular-nums">USD {Number(quote.subtotal_usd).toLocaleString("en-US", { minimumFractionDigits: 2 })}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">ITBMS ({(Number(quote.tax_rate) * 100).toFixed(0)}%)</dt>
            <dd className="tabular-nums">USD {Number(quote.tax_usd).toLocaleString("en-US", { minimumFractionDigits: 2 })}</dd>
          </div>
          <div className="flex justify-between border-t border-border pt-2 mt-2 font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">USD {Number(quote.total_usd).toLocaleString("en-US", { minimumFractionDigits: 2 })}</dd>
          </div>
        </dl>
      </div>

      {quote.notes && (
        <div className="mt-8 rounded-xl border border-border bg-muted/20 p-4 text-sm">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Notas de la IA</p>
          <p>{quote.notes}</p>
        </div>
      )}
    </div>
  );
}
