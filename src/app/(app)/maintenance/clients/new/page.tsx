import Link from "next/link";
import { ArrowLeft, Building2, Sparkles } from "lucide-react";
import { NewClientForm } from "./new-form";

export const dynamic = "force-dynamic";

export default function NewClientPage() {
  return (
    <div className="px-4 py-6 md:px-10 md:py-8 max-w-2xl">
      <Link
        href="/maintenance/clients"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="size-4" />
        Volver a clientes
      </Link>

      <header className="mb-6 flex items-start gap-3">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white">
          <Building2 className="size-6" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Nuevo cliente</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cargá los datos básicos. Después agregás sucursales y equipos desde el detalle.
          </p>
        </div>
      </header>

      <NewClientForm />

      <div className="mt-6 rounded-xl border border-dashed border-violet-200 bg-violet-50/40 p-4">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-violet-600" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-900">¿Tenés mucho que cargar?</p>
            <p className="mt-0.5 text-xs text-slate-600">
              Si tenés un PDF, email o lista con clientes y equipos, la IA puede armar todo de un saque.
            </p>
            <Link
              href="/maintenance/clients/import"
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-violet-700 hover:underline"
            >
              Crear con IA →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
