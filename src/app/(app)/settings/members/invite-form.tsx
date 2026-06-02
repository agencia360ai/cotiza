"use client";

import { useState, useTransition } from "react";
import { Copy, Eye, EyeOff, Loader2, UserPlus, CheckCircle2, RefreshCw } from "lucide-react";
import { inviteMember } from "./actions";

type Role = "owner" | "admin" | "engineer" | "viewer";

const ROLE_OPTIONS: { value: Role; label: string; hint: string }[] = [
  { value: "engineer", label: "Ingeniero", hint: "Puede crear/editar clientes, equipos y reportes" },
  { value: "admin", label: "Administrador", hint: "Igual que ingeniero + gestionar miembros" },
  { value: "viewer", label: "Solo lectura", hint: "Ve toda la información pero no edita" },
  { value: "owner", label: "Owner", hint: "Control total, incluyendo eliminar la org" },
];

function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let pwd = "";
  for (let i = 0; i < 12; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
  return pwd;
}

export function InviteMemberForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(generatePassword());
  const [role, setRole] = useState<Role>("engineer");
  const [showPwd, setShowPwd] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const r = await inviteMember({ email: email.trim(), password, role });
      if (r && "error" in r) {
        setError(r.error);
        return;
      }
      setSuccess({ email: email.trim(), password });
      setEmail("");
      setPassword(generatePassword());
    });
  }

  function copyCredentials() {
    if (!success) return;
    const text = `Email: ${success.email}\nPassword: ${success.password}\nIngreso: ${window.location.origin}/login`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50/60 to-white p-5"
    >
      <div className="mb-4 flex items-center gap-2">
        <div className="flex size-8 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
          <UserPlus className="size-4" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Agregar miembro</h3>
          <p className="text-xs text-slate-600">
            Creás la cuenta con un password genérico — después se lo pasás al miembro
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-600">
            Email *
          </span>
          <input
            type="email"
            value={email}
            required
            onChange={(e) => setEmail(e.target.value)}
            placeholder="contratista@empresa.com"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-600">
            Rol
          </span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[10px] text-slate-500">
            {ROLE_OPTIONS.find((r) => r.value === role)?.hint}
          </p>
        </label>

        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-600">
            Password genérico
          </span>
          <div className="flex items-stretch overflow-hidden rounded-lg border border-slate-200 bg-white">
            <input
              type={showPwd ? "text" : "password"}
              value={password}
              required
              minLength={8}
              onChange={(e) => setPassword(e.target.value)}
              className="min-w-0 flex-1 bg-white px-3 py-2 text-sm font-mono focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPwd((v) => !v)}
              className="flex items-center justify-center border-l border-slate-200 px-2 text-slate-500 hover:bg-slate-50"
              aria-label="Mostrar/ocultar"
            >
              {showPwd ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
            <button
              type="button"
              onClick={() => setPassword(generatePassword())}
              className="flex items-center justify-center border-l border-slate-200 px-2 text-slate-500 hover:bg-slate-50"
              aria-label="Regenerar"
            >
              <RefreshCw className="size-4" />
            </button>
          </div>
          <p className="mt-1 text-[10px] text-slate-500">
            Mínimo 8 caracteres. El miembro puede cambiarlo después.
          </p>
        </label>
      </div>

      {error ? (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">
          {error}
        </p>
      ) : null}

      {success ? (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-emerald-700" />
            <p className="text-sm font-semibold text-emerald-900">
              Cuenta creada — copiá las credenciales y compartilas
            </p>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-1 text-xs font-mono sm:grid-cols-2">
            <p className="text-emerald-800">Email: {success.email}</p>
            <p className="text-emerald-800">Password: {success.password}</p>
          </div>
          <button
            type="button"
            onClick={copyCredentials}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            <Copy className="size-3" />
            {copied ? "¡Copiado!" : "Copiar email + password + link"}
          </button>
        </div>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
        Crear miembro
      </button>
    </form>
  );
}
