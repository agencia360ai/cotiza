import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

// La creación de organizaciones está ESCONDIDA por ahora (modo single-org
// DICEC): quien llegue aquí es un usuario sin membresía — que pida acceso.
// Para reactivar multi-org: restaurar <OnboardingForm /> (sigue en el repo).
export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: memberships } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", user.id)
    .limit(1);

  if (memberships && memberships.length > 0) redirect("/");

  return (
    <div className="flex min-h-screen w-full items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-slate-900 text-white">
          <Building2 className="size-6" />
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Tu cuenta aún no tiene acceso</h1>
          <p className="text-sm text-muted-foreground">
            Iniciaste sesión como <span className="font-medium text-foreground">{user.email}</span>, pero esta
            cuenta no pertenece a la organización de DICEC. Pide a un administrador que te agregue desde
            Configuración → Miembros.
          </p>
        </div>
        <form action="/logout" method="post">
          <button
            type="submit"
            className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            Cerrar sesión
          </button>
        </form>
      </div>
    </div>
  );
}
