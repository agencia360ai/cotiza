"use client";

import { useState, useTransition } from "react";
import { Check, Hammer, ChevronRight, Loader2, Box, Wrench, PackagePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PROJECT_TYPE_LABEL,
  PROJECT_TYPE_COLOR,
  type ProjectType,
} from "@/lib/projects/types";
import type { TechnicianClient } from "@/lib/maintenance/types";
import { createTechnicianProject } from "../actions";

const TYPE_OPTIONS: {
  type: ProjectType;
  hint: string;
  icon: typeof Hammer;
}[] = [
  { type: "instalacion", hint: "Equipos nuevos puestos en marcha (cuarto frío, AC, etc.)", icon: PackagePlus },
  { type: "obra", hint: "Trabajo de obra civil + HVAC", icon: Hammer },
  { type: "remodelacion", hint: "Cambios en una instalación existente", icon: Wrench },
  { type: "otro", hint: "Cualquier otro proyecto puntual", icon: Box },
];

export function NewProjectWizard({
  token,
  clients,
}: {
  token: string;
  clients: TechnicianClient[];
}) {
  const [clientId, setClientId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>("");
  const [newLocationLabel, setNewLocationLabel] = useState("");
  const [name, setName] = useState("");
  const [projectType, setProjectType] = useState<ProjectType | null>(null);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedClient = clients.find((c) => c.id === clientId);
  const locations = selectedClient?.locations ?? [];
  const usingNewLocation = locationId === "_new";

  const canSubmit =
    !!clientId &&
    !!projectType &&
    name.trim().length > 0 &&
    (locationId !== "" && (!usingNewLocation || newLocationLabel.trim().length > 0));

  function submit() {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      const result = await createTechnicianProject(token, {
        client_id: clientId!,
        location_id: usingNewLocation ? null : locationId || null,
        new_location_label: usingNewLocation ? newLocationLabel.trim() : null,
        name: name.trim(),
        project_type: projectType!,
        description: description.trim() || null,
      });
      if (result && "error" in result) setError(result.error);
    });
  }

  return (
    <div className="space-y-8">
      <Section step={1} title="Cliente" done={!!clientId}>
        <div className="grid gap-2 sm:grid-cols-2">
          {clients.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setClientId(c.id);
                setLocationId("");
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
                {c.name
                  .split(/\s+/)
                  .map((s) => s[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase()}
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

      {selectedClient ? (
        <Section step={2} title="Sucursal" done={locationId !== "" && (!usingNewLocation || newLocationLabel.trim().length > 0)}>
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
                <div>
                  <p className="text-sm font-semibold text-slate-900">{l.name}</p>
                  <p className="text-xs text-slate-500">
                    {l.equipment_count} equipo{l.equipment_count === 1 ? "" : "s"}
                    {l.address ? ` · ${l.address}` : ""}
                  </p>
                </div>
                {locationId === l.id ? <Check className="size-5 text-emerald-600" /> : null}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setLocationId("_new")}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl border-2 border-dashed px-4 py-3 text-left transition-all",
                usingNewLocation
                  ? "border-slate-900 bg-slate-50"
                  : "border-slate-300 hover:border-slate-400 hover:bg-slate-50",
              )}
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                +
              </div>
              <div className="flex-1 text-sm">
                <p className="font-semibold text-slate-900">Sucursal nueva</p>
                <p className="text-xs text-slate-500">
                  Si la obra es para abrir una bodega/local que todavía no existe en el sistema
                </p>
              </div>
            </button>
            {usingNewLocation ? (
              <input
                value={newLocationLabel}
                onChange={(e) => setNewLocationLabel(e.target.value)}
                placeholder="Nombre tentativo de la sucursal nueva"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
                autoFocus
              />
            ) : null}
          </div>
        </Section>
      ) : null}

      {locationId !== "" && (!usingNewLocation || newLocationLabel.trim()) ? (
        <Section step={3} title="Tipo de proyecto" done={!!projectType}>
          <div className="grid gap-2 sm:grid-cols-2">
            {TYPE_OPTIONS.map((t) => (
              <button
                key={t.type}
                type="button"
                onClick={() => setProjectType(t.type)}
                className={cn(
                  "flex items-start gap-3 rounded-xl border bg-white p-3 text-left transition-all",
                  projectType === t.type
                    ? "border-slate-900 ring-2 ring-slate-900/10"
                    : "border-slate-200 hover:border-slate-300",
                )}
              >
                <div
                  className="flex size-10 shrink-0 items-center justify-center rounded-lg text-white"
                  style={{ backgroundColor: PROJECT_TYPE_COLOR[t.type] }}
                >
                  <t.icon className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">{PROJECT_TYPE_LABEL[t.type]}</p>
                  <p className="text-xs text-slate-500">{t.hint}</p>
                </div>
              </button>
            ))}
          </div>
        </Section>
      ) : null}

      {projectType ? (
        <Section step={4} title="Datos del proyecto" done={name.trim().length > 0}>
          <div className="space-y-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre (ej. Instalación cuarto frío bodega central)"
              className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-semibold focus:border-slate-400 focus:outline-none"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Descripción breve (opcional): qué se va a hacer, alcance general."
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
            />
          </div>
        </Section>
      ) : null}

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit || isPending}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-sm font-semibold transition-all",
          canSubmit && !isPending
            ? "bg-slate-900 text-white shadow-sm hover:bg-slate-800"
            : "bg-slate-100 text-slate-400",
        )}
      >
        {isPending ? <Loader2 className="size-5 animate-spin" /> : null}
        Empezar proyecto
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
      <header className="mb-3 flex items-center gap-2">
        <span
          className={cn(
            "flex size-6 items-center justify-center rounded-full text-[11px] font-bold",
            done ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600",
          )}
        >
          {done ? <Check className="size-3.5" /> : step}
        </span>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-600">{title}</h2>
      </header>
      {children}
    </section>
  );
}
