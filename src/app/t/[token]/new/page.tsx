import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { TechnicianPortalData } from "@/lib/maintenance/types";
import { NewReportWizard } from "./wizard";

export const dynamic = "force-dynamic";

async function loadPortal(token: string): Promise<TechnicianPortalData | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_technician_portal", { _token: token });
  return (data as TechnicianPortalData) ?? null;
}

export default async function NewReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await loadPortal(token);
  if (!data) notFound();

  return (
    <div className="mx-auto max-w-2xl px-5 py-6 sm:py-10">
      <Link
        href={`/t/${token}`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="size-4" />
        Volver al portal
      </Link>

      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          Nuevo reporte
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
          ¿Dónde estás trabajando hoy?
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Elegí cliente, sucursal y tipo. Después capturás fotos y notas, la IA arma el reporte.
        </p>
      </header>

      <NewReportWizard token={token} clients={data.clients} />
    </div>
  );
}
