import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { StandardizeReview } from "./review";

export const dynamic = "force-dynamic";

export default async function StandardizePage() {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) redirect("/login");
  const orgId = await getActiveOrgId();
  if (!orgId) redirect("/onboarding");

  const [{ data: clients }, { count: quotesUnlinked }, { count: tendersUnlinked }] = await Promise.all([
    supabase.from("clients").select("id, name").eq("org_id", orgId).order("name"),
    supabase.from("sales_quotes").select("id", { count: "exact", head: true }).eq("org_id", orgId).is("client_id", null),
    supabase.from("tenders").select("id", { count: "exact", head: true }).eq("org_id", orgId).is("client_id", null),
  ]);

  return (
    <div className="px-4 py-6 md:px-10 md:py-8 max-w-4xl">
      <Link href="/clientes" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> Clientes
      </Link>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Estandarizar nombres de cliente</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          La IA agrupa los nombres sueltos de cotizaciones y licitaciones en clientes reales. Revisás, ajustás y aplicás —
          se crean los clientes, sus sucursales y se linkean las cotizaciones.
        </p>
      </header>

      <StandardizeReview
        clients={(clients ?? []) as { id: string; name: string }[]}
        quotesUnlinked={quotesUnlinked ?? 0}
        tendersUnlinked={tendersUnlinked ?? 0}
      />
    </div>
  );
}
