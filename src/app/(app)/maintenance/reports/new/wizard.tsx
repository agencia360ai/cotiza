"use client";

import { useState, useTransition } from "react";
import { Calendar, Wrench, PackagePlus, ClipboardList, Check, ChevronRight, AlertOctagon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  REPORT_TYPE_LABEL,
  REPORT_TYPE_COLOR,
  type ReportType,
  type ReportSeverity,
} from "@/lib/maintenance/types";
import { createInternalReport } from "../actions";

type Client = { id: string; name: string; brand_color: string | null; locations: { id: string; name: string }[] };
type Tech = { id: string; name: string };

const TYPE_OPTIONS: { type: ReportType; label: string; hint: string; icon: typeof Calendar }[] = [
  { type: "preventivo", label: "Preventivo", hint: "Mantenimiento programado periódico", icon: Calendar },
  { type: "correctivo", label: "Correctivo", hint: "Reparación por daño o falla", icon: Wrench },
  { type: "instalacion", label: "Instalación", hint: "Equipos nuevos puestos en marcha", icon: PackagePlus },
  { type: "inspeccion", label: "Inspección", hint: "Revisión puntual sin mantenimiento", icon: ClipboardList },
];

const SEVERITY_OPTIONS: { value: ReportSeverity; label: string; tint: string }[] = [
  { value: "leve", label: "Leve", tint: "bg-yellow-50 text-yellow-800 ring-yellow-600/30" },
  { value: "moderada", label: "Moderada", tint: "bg-orange-50 text-orange-700 ring-orange-600/30" },
  { value: "grave", label: "Grave", tint: "bg-red-50 text-red-700 ring-red-600/30" },
];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function NewReportWizard({ clients, technicians }: { clients: Client[]; technicians: Tech[] }) {
  const [clientId, setClientId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [reportType, setReportType] = useState<ReportType | null>(null);
  const [severity, setSeverity] = useState<ReportSeverity | null>(null);
  const [triggerEvent, setTriggerEvent] = useState("");
  const [techId, setTechId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedClient = clients.find((c) => c.id === clientId);
  const locations = selectedClient?.locations ?? [];
  const canSubmit = clientId && locationId && reportType;

  function submit() {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      try {
        await createInternalReport({
          client_id: clientId!,
          location_id: locationId!,
          report_type: reportType!,
          severity: reportType === "correctivo" ? severity ?? undefined : undefined,
          trigger_event:
            reportType === "correctivo" && triggerEvent.trim() ? triggerEvent.trim() : undefined,
          technician_id: techId || null,
          performed_by_name: techId ? technicians.find((t) => t.id === techId)?.name : undefined,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Error";
        if (!msg.includes("NEXT_REDIRECT")) setError(msg);
      }
    });
  }

  if (clients.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card py-12 px-6 text-center">
        <p className="text-sm text-muted-foreground">No hay clientes aún.</p>
        <a href="/maintenance/clients" className="mt-2 inline-block text-sm font-semibold text-blue-600 hover:underline">
          Crear el primer cliente →
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Step 1: client */}
      <Section step={1} title="Cliente" done={!!clientId}>
        <div className="grid gap-2 sm:grid-cols-2">
          {clients.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setClientId(c.id);
                setLocationId(null);
              }}
              className={cn(
                "flex items-center gap-3 rounded-xl border bg-white px-3 py-3 text-left transition-all",
                clientId === c.id
                  ? "border-slate-900 ring-2 ring-slate-900/10"
                  : "border-slate-200 hover:border-slate-300",
              )}
            >
              <div
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
                style={{ backgroundColor: c.brand_color ?? "#0EA5E9" }}
              >
                {initials(c.name)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900">{c.name}</p>
                <p className="text-xs text-slate-500">
                  {c.locations.length} sucursal{c.locations.length === 1 ? "" : "es"}
                </p>
              </div>
              {clientId === c.id ? <Check className="size-5 text-emerald-600" /> : null}
            </button>
          ))}
        </div>
      </Section>

      {/* Step 2: location */}
      {selectedClient ? (
        <Section step={2} title="Sucursal" done={!!locationId}>
          {locations.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-slate-500">
              Este cliente no tiene sucursales. Agregá una desde el detalle del cliente.
            </p>
          ) : (
            <div className="space-y-2">
              {locations.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setLocationId(l.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-xl border bg-white px-4 py-3 text-left transition-all",
                    locationId === l.id
                      ? "border-slate-900 ring-2 ring-slate-900/10"
                      : "border-slate-200 hover:border-slate-300",
                  )}
                >
                  <p className="text-sm font-semibold text-slate-900">{l.name}</p>
                  {locationId === l.id ? <Check className="size-5 text-emerald-600" /> : null}
                </button>
              ))}
            </div>
          )}
        </Section>
      ) : null}

      {/* Step 3: report type */}
      {locationId ? (
        <Section step={3} title="Tipo" done={!!reportType}>
          <div className="grid gap-2 sm:grid-cols-2">
            {TYPE_OPTIONS.map((t) => (
              <button
                key={t.type}
                type="button"
                onClick={() => {
                  setReportType(t.type);
                  if (t.type !== "correctivo") {
                    setSeverity(null);
                    setTriggerEvent("");
                  }
                }}
                className={cn(
                  "flex items-start gap-3 rounded-xl border bg-white p-3 text-left transition-all",
                  reportType === t.type
                    ? "border-slate-900 ring-2 ring-slate-900/10"
                    : "border-slate-200 hover:border-slate-300",
                )}
              >
                <div
                  className="flex size-10 shrink-0 items-center justify-center rounded-lg text-white"
                  style={{ backgroundColor: REPORT_TYPE_COLOR[t.type] }}
                >
                  <t.icon className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">{REPORT_TYPE_LABEL[t.type]}</p>
                  <p className="text-xs text-slate-500">{t.hint}</p>
                </div>
              </button>
            ))}
          </div>

          {reportType === "correctivo" ? (
            <div className="mt-4 space-y-3 rounded-xl border border-orange-200 bg-orange-50/50 p-4">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-orange-700">
                  Severidad
                </label>
                <div className="mt-2 flex gap-2">
                  {SEVERITY_OPTIONS.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => setSeverity(s.value)}
                      className={cn(
                        "flex-1 rounded-lg px-3 py-2 text-sm font-semibold ring-1 ring-inset transition-all",
                        s.tint,
                        severity === s.value ? "scale-100 ring-2" : "opacity-70 hover:opacity-100",
                      )}
                    >
                      <AlertOctagon className="mx-auto mb-1 size-4" />
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-orange-700">
                  ¿Qué pasó? (opcional)
                </label>
                <textarea
                  value={triggerEvent}
                  onChange={(e) => setTriggerEvent(e.target.value)}
                  rows={2}
                  placeholder="Ej: Cliente reportó equipo sin enfriar el lunes a las 14:00"
                  className="mt-1 w-full rounded-lg border border-orange-200 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-orange-400 focus:outline-none"
                />
              </div>
            </div>
          ) : null}
        </Section>
      ) : null}

      {/* Step 4: technician (optional) */}
      {reportType ? (
        <Section step={4} title="Técnico (opcional)" done={true}>
          <select
            value={techId}
            onChange={(e) => setTechId(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
          >
            <option value="">Sin técnico asignado</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Section>
      ) : null}

      {error ? (
        <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit || isPending}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-4 text-base font-semibold text-white transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {isPending ? "Creando…" : "Crear reporte y editar"}
        {!isPending ? <ChevronRight className="size-5" /> : null}
      </button>
    </div>
  );
}

function Section({
  step,
  title,
  done,
  children,
}: {
  step: number;
  title: string;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <span
          className={cn(
            "flex size-6 items-center justify-center rounded-full text-xs font-bold",
            done ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600",
          )}
        >
          {done ? <Check className="size-3.5" /> : step}
        </span>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700">{title}</h2>
      </div>
      {children}
    </section>
  );
}
