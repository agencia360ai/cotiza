import Link from "next/link";
import { Plus, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  parsing: "Analizando",
  clarifying: "Aclarando datos",
  quoting: "Cotizando",
  completed: "Completado",
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, client_name, scope, status, updated_at")
    .order("updated_at", { ascending: false });

  return (
    <div className="px-4 py-6 md:px-10 md:py-8 max-w-5xl">
      <header className="flex items-center justify-between mb-10">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Proyectos</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cotizaciones HVAC en curso.
          </p>
        </div>
        <Button asChild>
          <Link href="/projects/new">
            <Plus className="size-4" />
            Nuevo proyecto
          </Link>
        </Button>
      </header>

      {projects && projects.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                href={`/projects/${p.id}`}
                className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-accent/40 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{p.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {p.client_name ? `${p.client_name} · ` : ""}
                    {p.scope === "complex" ? "complejo" : "simple"} · {STATUS_LABEL[p.status] ?? p.status}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                  {new Date(p.updated_at).toLocaleDateString("es-PA")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-xl border border-dashed border-border py-20 px-8 flex flex-col items-center text-center">
          <FileText className="size-6 text-muted-foreground mb-3" />
          <p className="text-sm font-medium">Sin proyectos aún</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs mb-4">
            Creá tu primer proyecto, cargá los planos y la IA te arma una cotización.
          </p>
          <Button asChild>
            <Link href="/projects/new">
              <Plus className="size-4" />
              Crear primer proyecto
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
