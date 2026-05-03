import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ClientDetailEditor } from "./client-detail";

export const dynamic = "force-dynamic";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) redirect("/login");

  const { data: client } = await supabase.from("clients").select("*").eq("id", id).single();
  if (!client) notFound();

  const { data: locationsRaw } = await supabase
    .from("client_locations")
    .select("*, equipment:client_equipment(*)")
    .eq("client_id", id)
    .order("name", { ascending: true });

  const { data: shareLinks } = await supabase
    .from("share_links")
    .select("*")
    .eq("client_id", id)
    .eq("kind", "client_view")
    .order("created_at", { ascending: false });

  const { data: schedules } = await supabase
    .from("maintenance_schedules")
    .select("*")
    .eq("client_id", id)
    .order("next_due_date", { ascending: true });

  const { data: technicians } = await supabase
    .from("technicians")
    .select("id, name, active")
    .eq("active", true)
    .order("name", { ascending: true });

  return (
    <div className="px-10 py-8 max-w-5xl">
      <Link
        href="/maintenance/clients"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="size-4" />
        Volver a clientes
      </Link>

      <ClientDetailEditor
        client={client}
        locations={locationsRaw ?? []}
        shareLinks={shareLinks ?? []}
        schedules={schedules ?? []}
        technicians={technicians ?? []}
      />
    </div>
  );
}
