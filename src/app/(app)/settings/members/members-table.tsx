"use client";

import { useState, useTransition } from "react";
import { Eye, Loader2, Trash2, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { resumenAcceso, rolSinRestriccion, type Seccion } from "@/lib/secciones";
import { changeMemberRole, removeMember, setMemberWaPhone, setMemberDisplayName, setMemberSecciones } from "./actions";
import { AccesoPicker } from "./acceso-picker";

type Member = {
  id: string;
  user_id: string;
  email: string;
  role: string;
  created_at: string;
  last_sign_in_at: string | null;
  is_self: boolean;
  wa_phone?: string | null;
  display_name?: string | null;
  secciones?: Seccion[] | null;
};

const ROLE_OPTIONS = [
  { value: "engineer", label: "Ingeniero" },
  { value: "admin", label: "Administrador" },
  { value: "viewer", label: "Solo lectura" },
  { value: "owner", label: "Owner" },
];

function fmtDateShort(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-PA", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtRelative(iso: string | null): string {
  if (!iso) return "Nunca";
  const days = Math.floor((Date.now() - +new Date(iso)) / 86400000);
  if (days < 1) {
    const hours = Math.floor((Date.now() - +new Date(iso)) / 3600000);
    return hours < 1 ? "Hace un momento" : `Hace ${hours}h`;
  }
  if (days < 30) return `Hace ${days}d`;
  return fmtDateShort(iso);
}

export function MembersTable({ members, canManage }: { members: Member[]; canManage: boolean }) {
  if (members.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-500">
        Sin miembros todavía
      </p>
    );
  }
  return (
    <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {members.map((m) => (
        <MemberRow key={m.id} member={m} canManage={canManage} />
      ))}
    </ul>
  );
}

function MemberRow({ member, canManage }: { member: Member; canManage: boolean }) {
  const [role, setRole] = useState(member.role);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tel, setTel] = useState(member.wa_phone ?? "");
  const [nombre, setNombre] = useState(member.display_name ?? "");
  const [secciones, setSecciones] = useState<Seccion[] | null>(member.secciones ?? null);
  const [borrador, setBorrador] = useState<Seccion[] | null>(null);
  const [editandoAcceso, setEditandoAcceso] = useState(false);
  const porRol = rolSinRestriccion(role);
  const restringido = !porRol && secciones !== null;

  function guardarAcceso() {
    const prev = secciones;
    setSecciones(borrador);
    setEditandoAcceso(false);
    setError(null);
    startTransition(async () => {
      const r = await setMemberSecciones(member.id, borrador);
      if (r && "error" in r) {
        setSecciones(prev);
        setError(r.error);
      }
    });
  }

  // Nombre con el que aparece en el resto de la app (encargado de un lead, por
  // ejemplo). Sin él se muestra el email, que en una tarjeta es ruido.
  function guardarNombre() {
    const limpio = nombre.trim();
    if (limpio === (member.display_name ?? "")) return;
    setError(null);
    startTransition(async () => {
      const r = await setMemberDisplayName(member.id, limpio || null);
      if (r && "error" in r) {
        setError(r.error);
        setNombre(member.display_name ?? "");
      }
    });
  }

  // Con el número guardado, este miembro queda autorizado a reenviarle al bot la
  // programación del día (Asistencia).
  function guardarTel() {
    const limpio = tel.replace(/\D/g, "");
    if (limpio === (member.wa_phone ?? "")) return;
    setError(null);
    startTransition(async () => {
      const r = await setMemberWaPhone(member.id, limpio || null);
      if (r && "error" in r) {
        setError(r.error);
        setTel(member.wa_phone ?? "");
      } else {
        setTel(limpio);
      }
    });
  }

  function handleRoleChange(next: string) {
    const prev = role;
    setRole(next);
    setError(null);
    startTransition(async () => {
      const r = await changeMemberRole(member.id, next as Parameters<typeof changeMemberRole>[1]);
      if (r && "error" in r) {
        setRole(prev);
        setError(r.error);
      }
    });
  }
  function handleRemove() {
    if (!confirm(`¿Quitar a ${member.email} de la organización?`)) return;
    setError(null);
    startTransition(async () => {
      const r = await removeMember(member.id);
      if (r && "error" in r) setError(r.error);
    });
  }

  return (
    <li className="px-4 py-3 sm:px-5">
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
          <User className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">
            {member.display_name?.trim() || member.email}
            {member.is_self ? (
              <span className="ml-2 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">VOS</span>
            ) : null}
          </p>
          <p className="truncate text-[11px] text-slate-500">
            {member.display_name?.trim() ? `${member.email} · ` : ""}Último ingreso: {fmtRelative(member.last_sign_in_at)} · Miembro desde {fmtDateShort(member.created_at)}
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-[11px]">
            <Eye className="size-3 shrink-0 text-slate-400" />
            <span className={cn("truncate font-semibold", restringido ? "text-amber-700" : "text-slate-600")}>
              {resumenAcceso(role, secciones)}
            </span>
            {canManage && !member.is_self && !porRol && !editandoAcceso ? (
              <button
                type="button"
                onClick={() => {
                  setBorrador(secciones);
                  setEditandoAcceso(true);
                }}
                className="ml-1 shrink-0 font-semibold text-blue-600 hover:underline"
              >
                Cambiar
              </button>
            ) : null}
          </p>
          {canManage ? (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                onBlur={guardarNombre}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                placeholder="Nombre y apellido"
                className="w-full rounded-md border border-slate-200 px-2 py-0.5 text-[11px] outline-none focus:border-slate-900 sm:w-40"
              />
              <input
                value={tel}
                onChange={(e) => setTel(e.target.value)}
                onBlur={guardarTel}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                placeholder="WhatsApp 5076…"
                inputMode="numeric"
                className="w-full rounded-md border border-slate-200 px-2 py-0.5 text-[11px] outline-none focus:border-slate-900 sm:w-36"
              />
              {member.wa_phone ? (
                <span className="text-[10px] text-emerald-600" title="Puede reenviar la programación del día al bot">
                  autorizado
                </span>
              ) : null}
            </div>
          ) : null}
          {error ? <p className="mt-0.5 text-[11px] text-red-600">{error}</p> : null}
        </div>
        {canManage && !member.is_self ? (
          <>
            <select
              value={role}
              onChange={(e) => handleRoleChange(e.target.value)}
              disabled={pending}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleRemove}
              disabled={pending}
              className="flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
              aria-label="Quitar"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            </button>
          </>
        ) : (
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">
            {ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role}
          </span>
        )}
      </div>
      {editandoAcceso && !porRol ? (
        <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:ml-12">
          <p id={`acceso-${member.id}`} className="mb-2 text-xs font-semibold text-slate-700">
            Qué puede ver
          </p>
          <AccesoPicker value={borrador} onChange={setBorrador} disabled={pending} labelledBy={`acceso-${member.id}`} />
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={guardarAcceso}
              disabled={pending}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Guardar
            </button>
            <button
              type="button"
              onClick={() => setEditandoAcceso(false)}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
