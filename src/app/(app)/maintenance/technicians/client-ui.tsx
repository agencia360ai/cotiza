"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Copy, RefreshCw, Trash2, UserPlus, Check, Power, ExternalLink, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { createTechnician, regenerateToken, deleteTechnician, updateTechnician } from "./actions";

type Tech = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  active: boolean;
  access_token: string;
  last_used_at: string | null;
};

function relativeFromNow(iso: string | null): string {
  if (!iso) return "Nunca";
  const days = Math.floor((Date.now() - +new Date(iso)) / 86400000);
  if (days < 1) return "hoy";
  if (days < 7) return `hace ${days}d`;
  if (days < 30) return `hace ${Math.floor(days / 7)} sem`;
  return `hace ${Math.floor(days / 30)} mes`;
}

export function NewTechnicianForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    if (!name.trim()) return;
    setError(null);
    startTransition(async () => {
      const r = await createTechnician({
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
      });
      if ("error" in r) setError(r.error);
      else {
        setName("");
        setPhone("");
        setEmail("");
        router.refresh();
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="rounded-xl border border-border bg-card p-5"
    >
      <div className="mb-3 flex items-center gap-2">
        <UserPlus className="size-4 text-slate-700" />
        <h3 className="text-sm font-semibold text-slate-900">Agregar personal</h3>
      </div>
      <p className="sr-only">Cargá nombre, teléfono y email. Después podés editarlo y asignarle clientes específicos.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre completo *"
          className="rounded-lg border border-border bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Teléfono (+507 6000-0000)"
          className="rounded-lg border border-border bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className="rounded-lg border border-border bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
        />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Se genera un link único — copialo y mandáselo por WhatsApp al personal
        </p>
        <button
          type="submit"
          disabled={!name.trim() || isPending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
        >
          {isPending ? "Creando…" : "Crear personal"}
        </button>
      </div>
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    </form>
  );
}

export function TechniciansList({ technicians }: { technicians: Tech[] }) {
  return (
    <ul className="space-y-2">
      {technicians.map((t) => (
        <li key={t.id}>
          <TechRow tech={t} />
        </li>
      ))}
    </ul>
  );
}

function TechRow({ tech }: { tech: Tech }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const link = typeof window !== "undefined" ? `${window.location.origin}/t/${tech.access_token}` : `/t/${tech.access_token}`;

  function copy() {
    if (typeof window === "undefined") return;
    navigator.clipboard.writeText(`${window.location.origin}/t/${tech.access_token}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function rotate() {
    if (!confirm("¿Regenerar el token? El link viejo dejará de funcionar.")) return;
    setError(null);
    startTransition(async () => {
      const r = await regenerateToken(tech.id);
      if ("error" in r) setError(r.error);
      else router.refresh();
    });
  }

  function toggleActive() {
    setError(null);
    startTransition(async () => {
      const r = await updateTechnician(tech.id, { active: !tech.active });
      if ("error" in r) setError(r.error);
      else router.refresh();
    });
  }

  function handleDelete() {
    if (!confirm(`¿Eliminar a ${tech.name}? Sus reportes quedan en el sistema.`)) return;
    setError(null);
    startTransition(async () => {
      const r = await deleteTechnician(tech.id);
      if ("error" in r) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-4 transition-colors",
        tech.active ? "border-border" : "border-dashed border-slate-300 bg-slate-50/50 opacity-70",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "flex size-10 items-center justify-center rounded-full text-sm font-bold",
              tech.active ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-500",
            )}
          >
            {tech.name
              .split(/\s+/)
              .map((s) => s[0])
              .filter(Boolean)
              .slice(0, 2)
              .join("")
              .toUpperCase()}
          </div>
          <div>
            <p className="text-base font-semibold text-slate-900">{tech.name}</p>
            <div className="text-xs text-slate-500">
              {tech.phone ? <span>{tech.phone}</span> : null}
              {tech.phone && tech.email ? <span> · </span> : null}
              {tech.email ? <span>{tech.email}</span> : null}
              {!tech.phone && !tech.email ? <span>Sin contacto</span> : null}
            </div>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Última actividad: {relativeFromNow(tech.last_used_at)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copiado" : "Copiar link"}
          </button>
          <Link
            href={`/maintenance/technicians/${tech.id}`}
            className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200"
            title="Editar"
          >
            <Pencil className="size-3.5" />
            Editar
          </Link>
          <a
            href={`/t/${tech.access_token}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-200"
            title="Abrir portal del personal"
          >
            <ExternalLink className="size-3.5" />
          </a>
          <button
            type="button"
            onClick={rotate}
            disabled={isPending}
            className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-200"
            title="Regenerar token"
          >
            <RefreshCw className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={toggleActive}
            disabled={isPending}
            className={cn(
              "inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs",
              tech.active ? "bg-slate-100 text-slate-700 hover:bg-slate-200" : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200",
            )}
            title={tech.active ? "Desactivar" : "Activar"}
          >
            <Power className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-red-600 hover:bg-red-50"
            title="Eliminar"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="mt-3 truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600">
        {link}
      </div>

      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
