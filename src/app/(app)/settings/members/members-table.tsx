"use client";

import { useState, useTransition } from "react";
import { Loader2, Trash2, User } from "lucide-react";
import { changeMemberRole, removeMember } from "./actions";

type Member = {
  id: string;
  user_id: string;
  email: string;
  role: string;
  created_at: string;
  last_sign_in_at: string | null;
  is_self: boolean;
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
    <li className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
        <User className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-900">
          {member.email}
          {member.is_self ? (
            <span className="ml-2 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">VOS</span>
          ) : null}
        </p>
        <p className="text-[11px] text-slate-500">
          Último ingreso: {fmtRelative(member.last_sign_in_at)} · Miembro desde {fmtDateShort(member.created_at)}
        </p>
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
    </li>
  );
}
