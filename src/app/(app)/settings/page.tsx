import { redirect } from "next/navigation";
import { Building2, Boxes, Users, Wrench, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { OrgSettingsForm } from "./form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) redirect("/login");

  const { data: m } = await supabase
    .from("org_members")
    .select("org_id, role")
    .eq("user_id", u.user.id)
    .limit(1)
    .single();
  if (!m) redirect("/onboarding");

  const orgId = m.org_id as string;

  const [{ data: org }, { count: clientsCount }, { count: equipmentCount }, { count: techsCount }, { count: reportsCount }] =
    await Promise.all([
      supabase.from("organizations").select("id, name, slug, logo_path, created_at").eq("id", orgId).single(),
      supabase.from("clients").select("*", { count: "exact", head: true }),
      supabase.from("client_equipment").select("*", { count: "exact", head: true }),
      supabase.from("technicians").select("*", { count: "exact", head: true }).eq("active", true),
      supabase.from("maintenance_reports").select("*", { count: "exact", head: true }),
    ]);

  if (!org) redirect("/onboarding");

  return (
    <div className="px-4 py-6 md:px-10 md:py-8 max-w-4xl">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Configuración</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Editá los datos de tu organización — todo lo que ven tus clientes en sus portales
        </p>
      </header>

      <OrgSettingsForm
        org={{
          id: org.id,
          name: org.name,
          slug: org.slug,
          logo_path: org.logo_path,
          created_at: org.created_at,
        }}
        userEmail={u.user.email ?? ""}
        userRole={m.role as string}
      />

      <section className="mt-8 rounded-2xl border border-border bg-card p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          Resumen de tu cuenta
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat icon={Building2} label="Clientes" value={clientsCount ?? 0} />
          <Stat icon={Boxes} label="Equipos" value={equipmentCount ?? 0} />
          <Stat icon={Users} label="Técnicos activos" value={techsCount ?? 0} />
          <Stat icon={Wrench} label="Reportes totales" value={reportsCount ?? 0} />
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-border bg-card p-5 text-sm">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Tu sesión</h2>
        <div className="space-y-1 text-slate-600">
          <p className="flex items-center gap-2">
            <Mail className="size-3.5 text-slate-400" />
            <span className="font-mono text-xs">{u.user.email}</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
              {m.role as string}
            </span>
          </p>
          <p className="text-xs text-slate-500">
            Org creada: {new Date(org.created_at).toLocaleDateString("es-PA", { day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
      </section>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Building2; label: string; value: number }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <div className="flex items-center gap-1.5 text-slate-500">
        <Icon className="size-3.5" />
        <p className="text-[10px] font-semibold uppercase tracking-wider">{label}</p>
      </div>
      <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}
