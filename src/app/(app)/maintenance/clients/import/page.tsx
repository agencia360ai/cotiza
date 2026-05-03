import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { ImportWizard } from "./wizard";

export const dynamic = "force-dynamic";

export default function ImportClientPage() {
  return (
    <div className="px-10 py-8 max-w-4xl">
      <Link
        href="/maintenance/clients"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="size-4" />
        Volver a clientes
      </Link>

      <header className="mb-6 flex items-start gap-3">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-blue-600 text-white">
          <Sparkles className="size-6" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Crear cliente con IA</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pegá una descripción, una lista de equipos, o subí un PDF/foto. La IA arma el cliente
            completo con sus sucursales, equipos y mantenimientos programados — vos revisás y
            guardás.
          </p>
        </div>
      </header>

      <ImportWizard />
    </div>
  );
}
