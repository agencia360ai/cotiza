import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Calendar,
  AlertTriangle,
  ChevronRight,
  MapPin,
  User,
  Filter,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { REPORT_TYPE_COLOR, REPORT_TYPE_LABEL_SHORT } from "@/lib/maintenance/types";
import { ReportTypeIcon } from "@/components/maintenance/report-type-badge";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type ScheduleRow = {
  id: string;
  client_id: string;
  location_id: string | null;
  report_type: "preventivo" | "inspeccion" | "instalacion";
  frequency: string;
  next_due_date: string;
  last_completed_at: string | null;
  assigned_technician_id: string | null;
  active: boolean;
  client: { name: string; brand_color: string | null } | null;
  location: { name: string } | null;
  technician: { name: string } | null;
};

const MONTH_NAMES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function bucketFor(date: Date): "overdue" | "today" | "thisWeek" | "thisMonth" | "later" {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const diff = Math.floor((target.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff <= 7) return "thisWeek";
  if (diff <= 30) return "thisMonth";
  return "later";
}

const BUCKET_CONFIG = {
  overdue: { label: "Vencidos", tint: "bg-red-50 text-red-700 ring-red-600/30", color: "#EF4444" },
  today: { label: "Hoy", tint: "bg-orange-50 text-orange-700 ring-orange-600/30", color: "#F97316" },
  thisWeek: { label: "Esta semana", tint: "bg-amber-50 text-amber-700 ring-amber-600/30", color: "#F59E0B" },
  thisMonth: { label: "Este mes", tint: "bg-blue-50 text-blue-700 ring-blue-600/30", color: "#3B82F6" },
  later: { label: "Más adelante", tint: "bg-slate-100 text-slate-700 ring-slate-600/30", color: "#64748B" },
};

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; technician?: string; type?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) redirect("/login");

  let query = supabase
    .from("maintenance_schedules")
    .select(
      "*, client:clients(name, brand_color), location:client_locations(name), technician:technicians(name)",
    )
    .eq("active", true)
    .order("next_due_date", { ascending: true });

  if (sp.client) query = query.eq("client_id", sp.client);
  if (sp.technician) query = query.eq("assigned_technician_id", sp.technician);
  if (sp.type) query = query.eq("report_type", sp.type);

  const { data: rawData } = await query;
  const schedules = (rawData ?? []) as ScheduleRow[];

  // Get filter options
  const { data: clients } = await supabase.from("clients").select("id, name").order("name");
  const { data: technicians } = await supabase
    .from("technicians")
    .select("id, name")
    .eq("active", true)
    .order("name");

  // Bucket and group
  const buckets = {
    overdue: [] as ScheduleRow[],
    today: [] as ScheduleRow[],
    thisWeek: [] as ScheduleRow[],
    thisMonth: [] as ScheduleRow[],
    later: [] as ScheduleRow[],
  };
  for (const s of schedules) buckets[bucketFor(new Date(s.next_due_date))].push(s);

  const totalUpcoming = schedules.length;
  const totalOverdue = buckets.overdue.length;

  return (
    <div className="px-10 py-8 max-w-6xl">
      <header className="mb-6">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
            <Calendar className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Cronograma de mantenimientos</h1>
            <p className="text-sm text-muted-foreground">
              {totalUpcoming} programado{totalUpcoming === 1 ? "" : "s"}
              {totalOverdue > 0 ? (
                <span className="ml-2 inline-flex items-center gap-1 text-red-600 font-medium">
                  · <AlertTriangle className="size-3" /> {totalOverdue} vencido{totalOverdue === 1 ? "" : "s"}
                </span>
              ) : null}
            </p>
          </div>
        </div>
      </header>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
        <Filter className="size-4 text-slate-500" />
        <FilterSelect
          name="client"
          value={sp.client ?? ""}
          options={[{ value: "", label: "Todos los clientes" }, ...(clients ?? []).map((c) => ({ value: c.id, label: c.name }))]}
          searchParams={sp}
        />
        <FilterSelect
          name="technician"
          value={sp.technician ?? ""}
          options={[{ value: "", label: "Todos los técnicos" }, ...(technicians ?? []).map((t) => ({ value: t.id, label: t.name }))]}
          searchParams={sp}
        />
        <FilterSelect
          name="type"
          value={sp.type ?? ""}
          options={[
            { value: "", label: "Todos los tipos" },
            { value: "preventivo", label: "Preventivo" },
            { value: "inspeccion", label: "Inspección" },
            { value: "instalacion", label: "Instalación" },
          ]}
          searchParams={sp}
        />
        {(sp.client || sp.technician || sp.type) ? (
          <Link
            href="/maintenance/schedule"
            className="text-xs text-slate-500 underline-offset-2 hover:underline"
          >
            Limpiar
          </Link>
        ) : null}
      </div>

      {schedules.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-20 text-center">
          <Calendar className="mx-auto mb-3 size-6 text-muted-foreground" />
          <p className="text-sm font-medium">Sin mantenimientos programados</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Programalos desde el detalle de cada cliente
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {(["overdue", "today", "thisWeek", "thisMonth", "later"] as const).map((bucket) =>
            buckets[bucket].length > 0 ? (
              <BucketSection key={bucket} bucket={bucket} schedules={buckets[bucket]} />
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}

function BucketSection({
  bucket,
  schedules,
}: {
  bucket: keyof typeof BUCKET_CONFIG;
  schedules: ScheduleRow[];
}) {
  const cfg = BUCKET_CONFIG[bucket];
  return (
    <section>
      <header className="mb-3 flex items-center gap-3">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wider ring-1 ring-inset",
            cfg.tint,
          )}
        >
          {bucket === "overdue" ? <AlertTriangle className="size-3" /> : null}
          {cfg.label}
        </span>
        <span className="text-xs text-slate-500">{schedules.length}</span>
        <div className="h-px flex-1 bg-slate-200" />
      </header>
      <div className="space-y-2">
        {schedules.map((s) => (
          <ScheduleCard key={s.id} schedule={s} />
        ))}
      </div>
    </section>
  );
}

function ScheduleCard({ schedule }: { schedule: ScheduleRow }) {
  const date = new Date(schedule.next_due_date);
  const monthLabel = `${MONTH_NAMES[date.getMonth()].slice(0, 3)}`;
  const day = date.getDate();
  const dayName = DAY_NAMES[date.getDay()];
  const accent = REPORT_TYPE_COLOR[schedule.report_type];

  return (
    <Link
      href={`/maintenance/clients/${schedule.client_id}`}
      className="group flex items-center gap-4 rounded-xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-sm"
    >
      <div className="flex size-14 shrink-0 flex-col items-center justify-center rounded-xl bg-slate-50 ring-1 ring-slate-200">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{monthLabel}</p>
        <p className="text-2xl font-bold leading-none tabular-nums text-slate-900">{day}</p>
        <p className="text-[9px] text-slate-400">{dayName.slice(0, 3).toLowerCase()}</p>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
            style={{ backgroundColor: accent }}
          >
            <ReportTypeIcon type={schedule.report_type} className="size-2.5" />
            {REPORT_TYPE_LABEL_SHORT[schedule.report_type]}
          </span>
          <p className="font-semibold text-slate-900">{schedule.client?.name ?? "—"}</p>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
          {schedule.location ? (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3" />
              {schedule.location.name}
            </span>
          ) : null}
          {schedule.technician ? (
            <span className="inline-flex items-center gap-1">
              <User className="size-3" />
              {schedule.technician.name}
            </span>
          ) : (
            <span className="text-amber-600">Sin técnico asignado</span>
          )}
          <span className="text-slate-400">· cada {schedule.frequency}</span>
        </div>
      </div>

      <ChevronRight className="size-5 text-slate-300 transition-transform group-hover:translate-x-1" />
    </Link>
  );
}

function FilterSelect({
  name,
  value,
  options,
  searchParams,
}: {
  name: string;
  value: string;
  options: { value: string; label: string }[];
  searchParams: Record<string, string | undefined>;
}) {
  // Build links for each option preserving other params
  // Note: this is a server component, but we need an interactive select.
  // For simplicity, render as a form with method=get.
  return (
    <form className="contents">
      {Object.entries(searchParams).map(([k, v]) =>
        k !== name && v ? <input key={k} type="hidden" name={k} value={v} /> : null,
      )}
      <select
        name={name}
        defaultValue={value}
        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-200"
      >
        Aplicar
      </button>
    </form>
  );
}
