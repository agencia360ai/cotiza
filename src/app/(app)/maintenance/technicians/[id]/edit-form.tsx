"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Check,
  CheckCircle2,
  Globe,
  Loader2,
  MapPin,
  Save,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  setTechnicianAssignments,
  updateTechnician,
  type AssignmentInput,
} from "../actions";

type ClientWithLocations = {
  id: string;
  name: string;
  client_locations: { id: string; name: string }[];
};

type Person = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  active: boolean;
  access_token: string;
};

type Mode = "all" | "scoped";

export function EditPersonalForm({
  person,
  clients,
  initialAssignments,
}: {
  person: Person;
  clients: ClientWithLocations[];
  initialAssignments: AssignmentInput[];
}) {
  const router = useRouter();
  const [name, setName] = useState(person.name);
  const [phone, setPhone] = useState(person.phone ?? "");
  const [email, setEmail] = useState(person.email ?? "");
  const [active, setActive] = useState(person.active);

  const [mode, setMode] = useState<Mode>(initialAssignments.length === 0 ? "all" : "scoped");

  const initialMap = useMemo(() => {
    const m = new Map<string, Set<string | null>>();
    for (const a of initialAssignments) {
      const set = m.get(a.client_id) ?? new Set<string | null>();
      set.add(a.location_id);
      m.set(a.client_id, set);
    }
    return m;
  }, [initialAssignments]);

  const [scope, setScope] = useState<Map<string, Set<string | null>>>(initialMap);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  function toggleClientFull(clientId: string) {
    setScope((prev) => {
      const next = new Map(prev);
      const set = next.get(clientId);
      if (set && set.has(null)) {
        next.delete(clientId);
      } else {
        next.set(clientId, new Set<string | null>([null]));
      }
      return next;
    });
  }

  function toggleLocation(clientId: string, locationId: string) {
    setScope((prev) => {
      const next = new Map(prev);
      let set = next.get(clientId);
      if (!set) {
        set = new Set<string | null>();
        next.set(clientId, set);
      }
      if (set.has(null)) {
        // Was "all locations" — switch to just this one
        set.clear();
        set.add(locationId);
      } else if (set.has(locationId)) {
        set.delete(locationId);
        if (set.size === 0) next.delete(clientId);
      } else {
        set.add(locationId);
      }
      return next;
    });
  }

  function buildAssignments(): AssignmentInput[] {
    if (mode === "all") return [];
    const out: AssignmentInput[] = [];
    for (const [clientId, set] of scope.entries()) {
      if (set.has(null)) {
        out.push({ client_id: clientId, location_id: null });
      } else {
        for (const locId of set) {
          if (locId !== null) out.push({ client_id: clientId, location_id: locId });
        }
      }
    }
    return out;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("El nombre es obligatorio");
      return;
    }
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const r1 = await updateTechnician(person.id, {
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        active,
      });
      if ("error" in r1) {
        setError(r1.error);
        return;
      }
      const r2 = await setTechnicianAssignments(person.id, buildAssignments());
      if ("error" in r2) {
        setError(r2.error);
        return;
      }
      setSuccess(true);
      router.refresh();
    });
  }

  const totalScopedClients = scope.size;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Datos básicos */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-700">
          Datos
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre completo *">
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
            />
          </Field>
          <Field label="Teléfono">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+507 6000-0000"
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
            />
          </Field>
          <Field label="Estado">
            <label className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-border bg-white px-3 text-sm">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="size-4"
              />
              Activo
            </label>
          </Field>
        </div>
      </section>

      {/* Permisos */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <header className="mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700">
            Permisos
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Por defecto puede ver todos los clientes de la organización. Si querés limitarlo,
            seleccioná los clientes (o sucursales puntuales) a los que tiene acceso.
          </p>
        </header>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMode("all")}
            className={cn(
              "flex items-center gap-2 rounded-xl border-2 p-3 text-left transition-all",
              mode === "all"
                ? "border-slate-900 bg-slate-50"
                : "border-slate-200 hover:border-slate-300",
            )}
          >
            <Globe className="size-5 text-slate-700" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">Todos los clientes</p>
              <p className="text-xs text-slate-500">Default — acceso completo</p>
            </div>
            {mode === "all" ? <Check className="size-5 text-emerald-600" /> : null}
          </button>
          <button
            type="button"
            onClick={() => setMode("scoped")}
            className={cn(
              "flex items-center gap-2 rounded-xl border-2 p-3 text-left transition-all",
              mode === "scoped"
                ? "border-slate-900 bg-slate-50"
                : "border-slate-200 hover:border-slate-300",
            )}
          >
            <Building2 className="size-5 text-slate-700" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">Restringir acceso</p>
              <p className="text-xs text-slate-500">
                {mode === "scoped"
                  ? `${totalScopedClients} cliente${totalScopedClients === 1 ? "" : "s"} seleccionado${totalScopedClients === 1 ? "" : "s"}`
                  : "Por cliente o sucursal"}
              </p>
            </div>
            {mode === "scoped" ? <Check className="size-5 text-emerald-600" /> : null}
          </button>
        </div>

        {mode === "scoped" ? (
          <div className="mt-5 space-y-2">
            {clients.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-slate-500">
                No hay clientes en la organización todavía.
              </p>
            ) : (
              clients.map((c) => {
                const set = scope.get(c.id);
                const fullClient = !!set && set.has(null);
                const selectedLocs = set ? Array.from(set).filter((x): x is string => x !== null) : [];
                const expanded = !!set && set.size > 0;
                return (
                  <div
                    key={c.id}
                    className={cn(
                      "rounded-xl border bg-white transition-colors",
                      expanded ? "border-slate-300" : "border-slate-200",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => toggleClientFull(c.id)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left"
                    >
                      <div
                        className={cn(
                          "flex size-5 items-center justify-center rounded-md border-2 transition-colors",
                          fullClient
                            ? "border-slate-900 bg-slate-900 text-white"
                            : selectedLocs.length > 0
                              ? "border-slate-900 bg-slate-100"
                              : "border-slate-300",
                        )}
                      >
                        {fullClient ? <Check className="size-3.5" /> : selectedLocs.length > 0 ? (
                          <span className="text-[10px] font-bold text-slate-700">
                            {selectedLocs.length}
                          </span>
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">{c.name}</p>
                        <p className="text-xs text-slate-500">
                          {fullClient
                            ? "Acceso a todas las sucursales"
                            : selectedLocs.length > 0
                              ? `${selectedLocs.length}/${c.client_locations.length} sucursales`
                              : `${c.client_locations.length} sucursales`}
                        </p>
                      </div>
                    </button>
                    {!fullClient && c.client_locations.length > 0 ? (
                      <div className="border-t border-slate-100 bg-slate-50/40 px-4 py-2.5">
                        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                          Sucursales puntuales
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {c.client_locations.map((l) => {
                            const on = selectedLocs.includes(l.id);
                            return (
                              <button
                                key={l.id}
                                type="button"
                                onClick={() => toggleLocation(c.id, l.id)}
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-colors",
                                  on
                                    ? "bg-slate-900 text-white"
                                    : "bg-white text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-100",
                                )}
                              >
                                <MapPin className="size-3" />
                                {l.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        ) : null}
      </section>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="inline-flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
          <CheckCircle2 className="size-4" />
          Cambios guardados
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Guardar cambios
        </button>
      </div>
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
