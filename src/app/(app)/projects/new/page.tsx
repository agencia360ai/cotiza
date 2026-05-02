import { NewProjectForm } from "./new-project-form";

export default function NewProjectPage() {
  return (
    <div className="px-10 py-8 max-w-xl">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Nuevo proyecto</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Apenas lo crees vas a poder cargar planos y especificaciones.
        </p>
      </header>
      <NewProjectForm />
    </div>
  );
}
