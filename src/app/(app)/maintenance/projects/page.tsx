import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, MapPin, Building2, Plus, Hammer, Calendar as CalendarIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  PROJECT_STATUS_COLOR,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_TINT,
  PROJECT_TYPE_COLOR,
  PROJECT_TYPE_LABEL,
  projectImageUrl,
  type ProjectStatus,
  type ProjectType,
} from "@/lib/projects/types";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type ProjectRow = {
  id: string;
  name: string;
  project_type: ProjectType;
  status: ProjectStatus;
  cover_photo_path: string | null;
  expected_completion_date: string | null;
  started_at: string | null;
  completed_at: string | null;
  client: { id: string; name: string } | { id: string; name: string }[];
  location: { id: string; name: string } | { id: string; name: string }[] | null;
  milestones: { status: string }[];
};

function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  if (Array.isArray(v)) return v[0] ?? null;
  return v;
}

export default async function ProjectsListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) redirect("/login");

  let q = supabase
    .from("client_projects")
    .select(
      "id, name, project_type, status, cover_photo_path, expected_completion_date, started_at, completed_at, client:clients!inner(id, name), location:client_locations(id, name), milestones:project_milestones(status)",
    )
    .order("created_at", { ascending: false });
  if (sp.status) q = q.eq("status", sp.status);
  const { data } = (await q) as { data: ProjectRow[] | null };
  const rows = data ?? [];

  // counts per status (overall)
  const { data: allRows } = (await supabase.from("client_projects").select("status")) as {
    data: { status: ProjectStatus }[] | null;
  };
  const statusCounts = new Map<ProjectStatus, number>();
  for (const r of allRows ?? []) statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1);

  const allStatuses: ProjectStatus[] = [
    "planificado",
    "en_progreso",
    "pausado",
    "completado",
    "aceptado",
  ];

  return (
    <div className="px-4 py-6 md:px-10 md:py-8 max-w-6xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Proyectos</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Tracking de instalaciones y obras nuevas para tus clientes
          </p>
        </div>
        <Link
          href="/maintenance/projects/new"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          <Plus className="size-4" />
          Nuevo proyecto
        </Link>
      </header>

      {(allRows ?? []).length > 0 ? (
        <div className="mb-6 flex flex-wrap items-center gap-1.5">
          <Link
            href="/maintenance/projects"
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium",
              !sp.status
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200",
            )}
          >
            Todos
            <span className={cn("ml-1 tabular-nums", sp.status ? "text-slate-400" : "text-white/70")}>
              {(allRows ?? []).length}
            </span>
          </Link>
          {allStatuses
            .filter((s) => (statusCounts.get(s) ?? 0) > 0)
            .map((s) => (
              <Link
                key={s}
                href={`/maintenance/projects?status=${s}`}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium",
                  sp.status === s
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200",
                )}
              >
                {PROJECT_STATUS_LABEL[s]}
                <span className={cn("ml-1 tabular-nums", sp.status === s ? "text-white/70" : "text-slate-400")}>
                  {statusCounts.get(s)}
                </span>
              </Link>
            ))}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card py-16 px-6 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
            <Hammer className="size-6" />
          </div>
          <p className="text-sm font-semibold text-slate-900">Sin proyectos aún</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Creá un proyecto cuando tengas una instalación o obra nueva para un cliente.
          </p>
          <Link
            href="/maintenance/projects/new"
            className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            <Plus className="size-4" />
            Crear primer proyecto
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((p) => {
            const client = one(p.client);
            const location = one(p.location);
            const total = p.milestones.length;
            const done = p.milestones.filter((m) => m.status === "completado").length;
            const pct = total === 0 ? 0 : Math.round((done / total) * 100);
            return (
              <li key={p.id}>
                <Link
                  href={`/maintenance/projects/${p.id}`}
                  className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div
                    className="relative aspect-[16/10] w-full bg-slate-100"
                    style={{
                      backgroundImage: p.cover_photo_path
                        ? `url(${projectImageUrl(p.cover_photo_path)})`
                        : undefined,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }}
                  >
                    {!p.cover_photo_path ? (
                      <div className="flex h-full w-full items-center justify-center">
                        <Hammer className="size-10 text-slate-300" />
                      </div>
                    ) : null}
                    <span
                      className={cn(
                        "absolute left-3 top-3 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ring-inset",
                        PROJECT_STATUS_TINT[p.status],
                      )}
                    >
                      <span className="size-1.5 rounded-full" style={{ backgroundColor: PROJECT_STATUS_COLOR[p.status] }} />
                      {PROJECT_STATUS_LABEL[p.status]}
                    </span>
                    <span
                      className="absolute right-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
                      style={{ backgroundColor: PROJECT_TYPE_COLOR[p.project_type] }}
                    >
                      {PROJECT_TYPE_LABEL[p.project_type]}
                    </span>
                  </div>

                  <div className="flex flex-1 flex-col p-4">
                    <p className="truncate font-semibold text-slate-900">{p.name}</p>
                    <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <Building2 className="size-3" />
                        {client?.name ?? "—"}
                      </span>
                      {location ? (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3" />
                          {location.name}
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-3">
                      <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        <span>{done}/{total} hitos</span>
                        <span>{pct}%</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, backgroundColor: PROJECT_STATUS_COLOR[p.status] }}
                        />
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                      {p.expected_completion_date ? (
                        <span className="inline-flex items-center gap-1">
                          <CalendarIcon className="size-3" />
                          Entrega {new Date(p.expected_completion_date).toLocaleDateString("es-PA", { day: "2-digit", month: "short" })}
                        </span>
                      ) : (
                        <span />
                      )}
                      <ChevronRight className="size-4 text-slate-300 transition-transform group-hover:translate-x-1" />
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
