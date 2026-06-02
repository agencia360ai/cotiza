"use client";

import { useState, useTransition } from "react";
import { Plus, Loader2 } from "lucide-react";
import { createOrg } from "./actions";

type Focus = "maintenance" | "projects" | "mixed";

export function CreateOrgCard() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [focus, setFocus] = useState<Focus>("mixed");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    startTransition(async () => {
      const r = await createOrg({ name: name.trim(), focus });
      if (r && "error" in r) setError(r.error);
    });
  }

  if (!open) {
    return (
      <div className="mt-6">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-3 rounded-2xl border-2 border-dashed border-slate-300 bg-white p-5 text-left transition-all hover:border-slate-400 hover:bg-slate-50"
        >
          <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
            <Plus className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-900">Crear nueva organización</p>
            <p className="mt-0.5 text-xs text-slate-500">
              Para separar otra empresa, sucursal o proyecto puntual
            </p>
          </div>
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-6 rounded-2xl border-2 border-slate-300 bg-white p-5"
    >
      <h3 className="text-sm font-bold text-slate-900">Nueva organización</h3>
      <p className="mt-1 text-xs text-slate-500">
        Quedás como owner. Después podés agregar miembros desde Configuración.
      </p>

      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-600">
            Nombre *
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej. RW Asociados"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
            autoFocus
          />
        </label>

        <div>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-600">
            Foco de la org
          </span>
          <div className="grid gap-2 sm:grid-cols-3">
            {([
              { value: "maintenance", label: "Mantenimiento", hint: "Reportes recurrentes" },
              { value: "projects", label: "Proyectos", hint: "Obras puntuales con hitos" },
              { value: "mixed", label: "Mixto", hint: "Ambas cosas" },
            ] as { value: Focus; label: string; hint: string }[]).map((opt) => {
              const active = focus === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setFocus(opt.value)}
                  className={
                    active
                      ? "rounded-lg border-2 border-blue-600 bg-blue-50 p-2 text-left"
                      : "rounded-lg border-2 border-slate-200 bg-white p-2 text-left hover:border-slate-300"
                  }
                >
                  <p className={active ? "text-xs font-bold text-blue-900" : "text-xs font-semibold text-slate-900"}>
                    {opt.label}
                  </p>
                  <p className="mt-0.5 text-[10px] text-slate-600">{opt.hint}</p>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {error ? (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      ) : null}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="submit"
          disabled={!name.trim() || pending}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          Crear y entrar
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
