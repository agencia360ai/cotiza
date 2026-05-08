"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { createProject } from "../actions";
import { PROJECT_TYPE_LABEL, type ProjectType } from "@/lib/projects/types";

type ClientOption = {
  id: string;
  name: string;
  client_locations: { id: string; name: string }[];
};

export function NewProjectForm({
  clients,
  defaultClientId,
  defaultLocationId,
}: {
  clients: ClientOption[];
  defaultClientId: string | null;
  defaultLocationId: string | null;
}) {
  const [clientId, setClientId] = useState(defaultClientId ?? clients[0]?.id ?? "");
  const [locationId, setLocationId] = useState<string | "_new">(
    defaultLocationId ?? clients.find((c) => c.id === defaultClientId)?.client_locations[0]?.id ?? "",
  );
  const [newLocationLabel, setNewLocationLabel] = useState("");
  const [name, setName] = useState("");
  const [projectType, setProjectType] = useState<ProjectType>("instalacion");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [completionDate, setCompletionDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selectedClient = clients.find((c) => c.id === clientId);
  const locations = selectedClient?.client_locations ?? [];

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !clientId) {
      setError("Faltan datos obligatorios");
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await createProject({
        client_id: clientId,
        location_id: locationId === "_new" ? null : locationId || null,
        new_location_label: locationId === "_new" ? newLocationLabel.trim() || null : null,
        name: name.trim(),
        project_type: projectType,
        description_es: description.trim() || null,
        expected_start_date: startDate || null,
        expected_completion_date: completionDate || null,
      });
      if (r && "error" in r) setError(r.error);
    });
  }

  if (clients.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Primero creá un cliente desde <strong>Clientes</strong>. Sin un cliente no se puede arrancar un
        proyecto.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Field label="Cliente *">
        <select
          value={clientId}
          onChange={(e) => {
            setClientId(e.target.value);
            const next = clients.find((c) => c.id === e.target.value);
            setLocationId(next?.client_locations[0]?.id ?? "_new");
          }}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
        >
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Sucursal">
        <select
          value={locationId}
          onChange={(e) => setLocationId(e.target.value as string | "_new")}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
        >
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
          <option value="_new">+ Sucursal nueva (la creamos al cerrar el proyecto)</option>
        </select>
        {locationId === "_new" ? (
          <input
            value={newLocationLabel}
            onChange={(e) => setNewLocationLabel(e.target.value)}
            placeholder="Nombre tentativo de la sucursal nueva"
            className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
          />
        ) : null}
      </Field>

      <Field label="Nombre del proyecto *">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ej. Instalación cuarto frío bodega central"
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
        />
      </Field>

      <Field label="Tipo">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(Object.keys(PROJECT_TYPE_LABEL) as ProjectType[]).map((t) => {
            const active = projectType === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setProjectType(t)}
                className={
                  active
                    ? "rounded-xl border-2 border-blue-600 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700"
                    : "rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:border-slate-300"
                }
              >
                {PROJECT_TYPE_LABEL[t]}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Descripción (opcional)">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Resumen del alcance: qué se va a instalar, dónde, qué se espera del proyecto."
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Inicio estimado">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
          />
        </Field>
        <Field label="Entrega estimada">
          <input
            type="date"
            value={completionDate}
            onChange={(e) => setCompletionDate(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
          />
        </Field>
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 sm:w-auto"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        Crear proyecto
      </button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-600">
        {label}
      </span>
      {children}
    </label>
  );
}
