"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Settings,
  MapPin,
  Plus,
  Trash2,
  Box,
  Link2,
  Copy,
  Check,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Save,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  updateClient,
  deleteClientRecord,
  createLocation,
  updateLocation,
  deleteLocation,
  createEquipment,
  updateEquipment,
  deleteEquipment,
  createShareLink,
  deleteShareLink,
} from "../actions";

type Client = {
  id: string;
  org_id: string;
  name: string;
  contact_email: string | null;
  contact_phone: string | null;
  brand_color: string | null;
  notes: string | null;
};

type Equipment = {
  id: string;
  location_id: string;
  custom_name: string;
  brand: string | null;
  model: string | null;
  category: string | null;
  location_label: string | null;
  voltage: string | null;
  capacity_btu: number | null;
};

type Location = {
  id: string;
  client_id: string;
  name: string;
  address: string | null;
  equipment: Equipment[];
};

type ShareLink = {
  id: string;
  token: string;
  expires_at: string | null;
  created_at: string;
};

export function ClientDetailEditor({
  client,
  locations,
  shareLinks,
}: {
  client: Client;
  locations: Location[];
  shareLinks: ShareLink[];
}) {
  return (
    <>
      <ClientHeader client={client} />
      <ShareLinksSection clientId={client.id} clientName={client.name} links={shareLinks} />
      <LocationsSection clientId={client.id} locations={locations} />
      <ClientInfoEditor client={client} />
    </>
  );
}

function ClientHeader({ client }: { client: Client }) {
  return (
    <div className="mb-6 flex items-center gap-4">
      <div
        className="flex size-14 items-center justify-center rounded-2xl text-lg font-bold text-white"
        style={{ backgroundColor: client.brand_color ?? "#0EA5E9" }}
      >
        {client.name
          .split(/\s+/)
          .map((s) => s[0])
          .filter(Boolean)
          .slice(0, 2)
          .join("")
          .toUpperCase()}
      </div>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
        {client.contact_email || client.contact_phone ? (
          <p className="text-sm text-slate-500">
            {client.contact_email}
            {client.contact_email && client.contact_phone ? " · " : ""}
            {client.contact_phone}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ShareLinksSection({
  clientId,
  clientName,
  links,
}: {
  clientId: string;
  clientName: string;
  links: ShareLink[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [expiresInDays, setExpiresInDays] = useState<string>("90");

  function generate() {
    setError(null);
    startTransition(async () => {
      const days = expiresInDays === "" ? null : Number(expiresInDays);
      const r = await createShareLink(clientId, { expiresInDays: days });
      if ("error" in r) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <section className="mb-8 rounded-2xl border border-border bg-card">
      <header className="border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <Link2 className="size-4 text-slate-700" />
          <h2 className="text-base font-semibold">Links públicos del cliente</h2>
        </div>
        <p className="mt-0.5 text-xs text-slate-500">
          Compartilos con {clientName} para que vea el portal con sus reportes
        </p>
      </header>

      <div className="border-b border-border px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value)}
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs text-slate-700 focus:border-slate-400 focus:outline-none"
          >
            <option value="30">Expira en 30 días</option>
            <option value="90">Expira en 90 días</option>
            <option value="365">Expira en 1 año</option>
            <option value="">Sin expiración</option>
          </select>
          <button
            type="button"
            onClick={generate}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            <Plus className="size-3.5" />
            {isPending ? "Generando…" : "Nuevo link"}
          </button>
        </div>
        {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
      </div>

      <div className="px-5 py-3">
        {links.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">Sin links generados aún</p>
        ) : (
          <ul className="space-y-2">
            {links.map((l) => (
              <ShareLinkRow key={l.id} link={l} clientId={clientId} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ShareLinkRow({ link, clientId }: { link: ShareLink; clientId: string }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  const url = typeof window !== "undefined" ? `${window.location.origin}/p/${link.token}` : `/p/${link.token}`;
  const expired = link.expires_at && new Date(link.expires_at) < new Date();

  function copy() {
    if (typeof window === "undefined") return;
    navigator.clipboard.writeText(`${window.location.origin}/p/${link.token}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDelete() {
    if (!confirm("¿Eliminar este link? Dejará de funcionar inmediatamente.")) return;
    startTransition(async () => {
      const r = await deleteShareLink(link.id, clientId);
      if (!("error" in r)) router.refresh();
    });
  }

  return (
    <li className={cn("rounded-lg border bg-white p-3", expired ? "border-red-200 opacity-60" : "border-slate-200")}>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-slate-700">{url}</code>
        <button
          type="button"
          onClick={copy}
          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </button>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center rounded-md bg-slate-100 px-2 py-1 text-slate-700 hover:bg-slate-200"
        >
          <ExternalLink className="size-3" />
        </a>
        <button
          type="button"
          onClick={handleDelete}
          disabled={isPending}
          className="inline-flex shrink-0 items-center rounded-md px-2 py-1 text-red-600 hover:bg-red-50"
        >
          <Trash2 className="size-3" />
        </button>
      </div>
      <p className="mt-1 text-[11px] text-slate-400">
        {expired ? <span className="font-semibold text-red-600">Expirado</span> : null}
        {link.expires_at
          ? ` Expira ${new Date(link.expires_at).toLocaleDateString("es-PA")}`
          : " Sin expiración"}
        {" · Creado "}
        {new Date(link.created_at).toLocaleDateString("es-PA")}
      </p>
    </li>
  );
}

function LocationsSection({ clientId, locations }: { clientId: string; locations: Location[] }) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function add() {
    if (!newName.trim()) return;
    setError(null);
    startTransition(async () => {
      const r = await createLocation(clientId, { name: newName.trim(), address: newAddress.trim() || undefined });
      if ("error" in r) setError(r.error);
      else {
        setNewName("");
        setNewAddress("");
        router.refresh();
      }
    });
  }

  return (
    <section className="mb-8 rounded-2xl border border-border bg-card">
      <header className="border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <MapPin className="size-4 text-slate-700" />
          <h2 className="text-base font-semibold">
            Sucursales y equipos ({locations.length})
          </h2>
        </div>
      </header>

      <div className="border-b border-border px-5 py-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nombre de sucursal *"
            className="rounded-lg border border-border bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
          />
          <input
            value={newAddress}
            onChange={(e) => setNewAddress(e.target.value)}
            placeholder="Dirección (opcional)"
            className="rounded-lg border border-border bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={add}
            disabled={!newName.trim() || isPending}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            <Plus className="size-4" />
            Agregar
          </button>
        </div>
        {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
      </div>

      <div className="divide-y divide-slate-100">
        {locations.map((loc) => (
          <LocationCard key={loc.id} location={loc} clientId={clientId} />
        ))}
      </div>
    </section>
  );
}

function LocationCard({ location, clientId }: { location: Location; clientId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(location.name);
  const [address, setAddress] = useState(location.address ?? "");

  function save() {
    startTransition(async () => {
      await updateLocation(location.id, clientId, { name, address: address || null });
      setEditing(false);
      router.refresh();
    });
  }

  function handleDelete() {
    if (!confirm(`¿Eliminar sucursal "${location.name}"? Se eliminan también sus equipos.`)) return;
    startTransition(async () => {
      await deleteLocation(location.id, clientId);
      router.refresh();
    });
  }

  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 text-left"
        >
          {open ? <ChevronDown className="size-4 text-slate-400" /> : <ChevronRight className="size-4 text-slate-400" />}
          <div>
            {editing ? (
              <div className="flex flex-wrap gap-2">
                <input value={name} onChange={(e) => setName(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm" />
                <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Dirección" className="rounded border border-slate-300 px-2 py-1 text-sm" />
              </div>
            ) : (
              <>
                <p className="text-sm font-semibold text-slate-900">{location.name}</p>
                <p className="text-xs text-slate-500">
                  {location.address ?? "Sin dirección"} · {location.equipment.length} equipo
                  {location.equipment.length === 1 ? "" : "s"}
                </p>
              </>
            )}
          </div>
        </button>
        <div className="flex items-center gap-1">
          {editing ? (
            <>
              <button onClick={save} disabled={isPending} className="rounded bg-emerald-600 px-2 py-1 text-xs text-white">
                Guardar
              </button>
              <button onClick={() => setEditing(false)} className="rounded bg-slate-100 px-2 py-1 text-xs">
                Cancelar
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setEditing(true)} className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100">
                Editar
              </button>
              <button onClick={handleDelete} disabled={isPending} className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50">
                <Trash2 className="size-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {open ? <EquipmentEditor location={location} clientId={clientId} /> : null}
    </div>
  );
}

function EquipmentEditor({ location, clientId }: { location: Location; clientId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showAdd, setShowAdd] = useState(false);
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [category, setCategory] = useState("");
  const [label, setLabel] = useState("");
  const [voltage, setVoltage] = useState("");

  function add() {
    if (!brand && !model) return;
    const customName = `${brand} ${model}`.trim();
    startTransition(async () => {
      await createEquipment(location.id, clientId, {
        custom_name: customName || "Equipo sin nombre",
        brand: brand || undefined,
        model: model || undefined,
        category: category || undefined,
        location_label: label || undefined,
        voltage: voltage || undefined,
      });
      setBrand("");
      setModel("");
      setCategory("");
      setLabel("");
      setVoltage("");
      setShowAdd(false);
      router.refresh();
    });
  }

  return (
    <div className="ml-6 mt-3 space-y-2">
      {location.equipment.map((eq) => (
        <EquipmentRow key={eq.id} equipment={eq} clientId={clientId} />
      ))}

      {showAdd ? (
        <div className="rounded-lg border border-dashed border-blue-300 bg-blue-50/30 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Marca (TRUE, HISENSE, etc)" className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm" />
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Modelo (TRCB-79)" className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm" />
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm">
              <option value="">Categoría…</option>
              <option value="nevera">Nevera</option>
              <option value="congelador">Congelador</option>
              <option value="aire_acondicionado">Aire acondicionado</option>
              <option value="evaporadora">Evaporadora</option>
            </select>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ubicación específica (Cocina norte)" className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm" />
            <input value={voltage} onChange={(e) => setVoltage(e.target.value)} placeholder="Voltaje (110V / 220V)" className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm" />
          </div>
          <div className="mt-2 flex gap-2">
            <button onClick={add} disabled={isPending} className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white">
              {isPending ? "Guardando…" : "Guardar equipo"}
            </button>
            <button onClick={() => setShowAdd(false)} className="rounded bg-slate-100 px-3 py-1.5 text-xs">
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-xs text-slate-600 hover:border-slate-400"
        >
          <Plus className="size-3.5" />
          Agregar equipo
        </button>
      )}
    </div>
  );
}

function EquipmentRow({ equipment, clientId }: { equipment: Equipment; clientId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [brand, setBrand] = useState(equipment.brand ?? "");
  const [model, setModel] = useState(equipment.model ?? "");
  const [label, setLabel] = useState(equipment.location_label ?? "");

  function save() {
    startTransition(async () => {
      const customName = `${brand} ${model}`.trim() || "Equipo sin nombre";
      await updateEquipment(equipment.id, clientId, {
        custom_name: customName,
        brand: brand || null,
        model: model || null,
        location_label: label || null,
      });
      setEditing(false);
      router.refresh();
    });
  }

  function handleDelete() {
    if (!confirm(`¿Eliminar equipo "${equipment.custom_name}"?`)) return;
    startTransition(async () => {
      await deleteEquipment(equipment.id, clientId);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 text-sm">
      <Box className="size-4 shrink-0 text-slate-400" />
      {editing ? (
        <div className="flex flex-1 flex-wrap gap-1">
          <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Marca" className="w-24 rounded border border-slate-300 px-2 py-0.5 text-xs" />
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Modelo" className="w-32 rounded border border-slate-300 px-2 py-0.5 text-xs" />
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ubicación" className="flex-1 rounded border border-slate-300 px-2 py-0.5 text-xs" />
        </div>
      ) : (
        <div className="min-w-0 flex-1">
          <span className="font-semibold">{equipment.brand}</span>
          {equipment.model ? <span> {equipment.model}</span> : null}
          {equipment.location_label ? <span className="text-slate-500"> · {equipment.location_label}</span> : null}
        </div>
      )}
      {editing ? (
        <>
          <button onClick={save} disabled={isPending} className="rounded bg-emerald-600 px-2 py-0.5 text-xs text-white">
            <Save className="size-3" />
          </button>
          <button onClick={() => setEditing(false)} className="text-xs text-slate-500">×</button>
        </>
      ) : (
        <>
          <button onClick={() => setEditing(true)} className="rounded px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-100">
            Editar
          </button>
          <button onClick={handleDelete} disabled={isPending} className="rounded px-2 py-0.5 text-red-600 hover:bg-red-50">
            <Trash2 className="size-3" />
          </button>
        </>
      )}
    </div>
  );
}

function ClientInfoEditor({ client }: { client: Client }) {
  const router = useRouter();
  const [name, setName] = useState(client.name);
  const [email, setEmail] = useState(client.contact_email ?? "");
  const [phone, setPhone] = useState(client.contact_phone ?? "");
  const [color, setColor] = useState(client.brand_color ?? "#0EA5E9");
  const [notes, setNotes] = useState(client.notes ?? "");
  const [isPending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const dirty =
    name !== client.name ||
    (email || null) !== client.contact_email ||
    (phone || null) !== client.contact_phone ||
    color !== client.brand_color ||
    (notes || null) !== client.notes;

  function save() {
    startTransition(async () => {
      await updateClient(client.id, {
        name,
        contact_email: email || null,
        contact_phone: phone || null,
        brand_color: color,
        notes: notes || null,
      });
      setSavedAt(new Date());
      router.refresh();
    });
  }

  function handleDelete() {
    if (!confirm(`¿Eliminar el cliente "${client.name}" y TODOS sus reportes? No se puede deshacer.`)) return;
    startTransition(async () => {
      await deleteClientRecord(client.id);
      router.push("/maintenance/clients");
    });
  }

  return (
    <section className="mb-8 rounded-2xl border border-border bg-card">
      <header className="border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <Settings className="size-4 text-slate-700" />
          <h2 className="text-base font-semibold">Información del cliente</h2>
        </div>
      </header>
      <div className="space-y-3 px-5 py-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre">
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm" />
          </Field>
          <Field label="Color de marca">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2">
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="size-6 cursor-pointer rounded border-0 bg-transparent" />
              <code className="text-xs text-slate-600">{color}</code>
            </div>
          </Field>
          <Field label="Email de contacto">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm" />
          </Field>
          <Field label="Teléfono">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm" />
          </Field>
        </div>
        <Field label="Notas internas">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm" />
        </Field>

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 text-xs text-red-600 hover:underline"
          >
            <Trash2 className="size-3.5" />
            Eliminar cliente
          </button>
          <div className="flex items-center gap-2">
            {savedAt ? <span className="text-xs text-emerald-600">Guardado</span> : null}
            <button
              type="button"
              onClick={save}
              disabled={!dirty || isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <Save className="size-4" />
              Guardar cambios
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
