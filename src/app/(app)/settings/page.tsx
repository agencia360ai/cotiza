import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, Boxes, Users, Wrench, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgContext } from "@/lib/org-context";
import { OrgSettingsForm } from "./form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) redirect("/login");

  const ctx = await getActiveOrgContext();
  if (!ctx) redirect("/onboarding");

  const orgId = ctx.orgId;

  const [{ data: org }, { count: clientsCount }, { count: equipmentCount }, { count: techsCount }, { count: reportsCount }] =
    await Promise.all([
      supabase.from("organizations").select("id, name, slug, logo_path, created_at, focus").eq("id", orgId).single(),
      supabase.from("clients").select("*", { count: "exact", head: true }).eq("org_id", orgId),
      supabase
        .from("client_equipment")
        .select("*, location:client_locations!inner(client:clients!inner(org_id))", { count: "exact", head: true })
        .eq("location.client.org_id", orgId),
      supabase.from("technicians").select("*", { count: "exact", head: true }).eq("org_id", orgId).eq("active", true),
      supabase.from("maintenance_reports").select("*", { count: "exact", head: true }).eq("org_id", orgId),
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
          focus: (org as { focus?: "maintenance" | "projects" | "mixed" }).focus ?? "mixed",
        }}
        userEmail={u.user.email ?? ""}
        userRole={ctx.role}
      />

      <Link
        href="/settings/members"
        className="mt-4 flex items-center gap-3 rounded-2xl border border-border bg-card p-5 transition-all hover:border-slate-300 hover:shadow-sm"
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
          <Users className="size-5" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-slate-900">Miembros del equipo</p>
          <p className="text-xs text-slate-500">
            Agregar contratistas con email + password, asignar roles
          </p>
        </div>
        <span className="text-slate-300">→</span>
      </Link>

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
              {ctx.role}
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
