import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardPage() {
  return (
    <div className="px-10 py-8 max-w-5xl">
      <header className="flex items-center justify-between mb-10">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Proyectos</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cotizaciones HVAC en curso.
          </p>
        </div>
        <Button disabled>
          <Plus />
          Nuevo proyecto
        </Button>
      </header>

      <div className="rounded-xl border border-dashed border-border py-20 px-8 flex flex-col items-center text-center">
        <p className="text-sm font-medium">Sin proyectos aún</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-xs">
          En la próxima fase vas a poder cargar planos en PDF y armar cotizaciones con IA.
        </p>
      </div>
    </div>
  );
}
