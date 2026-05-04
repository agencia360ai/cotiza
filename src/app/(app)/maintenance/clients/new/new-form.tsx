"use client";

import { useState, useTransition } from "react";
import { ChevronRight } from "lucide-react";
import { CATEGORY_LABEL, CLIENT_CATEGORIES, type ClientCategory } from "@/lib/maintenance/types";
import { createClientRecord } from "../actions";

export function NewClientForm() {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ClientCategory | "">("");
  const [brandColor, setBrandColor] = useState("#0EA5E9");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    if (!name.trim()) return;
    setError(null);
    startTransition(async () => {
      try {
        await createClientRecord({
          name: name.trim(),
          category: category || null,
          brand_color: brandColor,
          contact_email: email.trim() || null,
          contact_phone: phone.trim() || null,
          notes: notes.trim() || null,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Error";
        if (!msg.includes("NEXT_REDIRECT")) setError(msg);
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="rounded-2xl border border-border bg-card p-5"
    >
      <div className="grid gap-4">
        <Field label="Nombre del cliente" required>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej: Restaurante La Tapa"
            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Categoría">
            <select
              value={category}
              onChange={(e) => setCategory((e.target.value || "") as ClientCategory | "")}
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
            >
              <option value="">Sin categoría</option>
              {CLIENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Color de marca">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2">
              <input
                type="color"
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                className="size-6 cursor-pointer rounded border-0 bg-transparent"
              />
              <code className="text-xs text-slate-600">{brandColor}</code>
            </div>
          </Field>

          <Field label="Email de contacto">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="contacto@cliente.com"
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
        </div>

        <Field label="Notas internas">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Particularidades, ubicación general, etc."
            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
          />
        </Field>
      </div>

      {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}

      <button
        type="submit"
        disabled={!name.trim() || isPending}
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {isPending ? "Creando…" : "Crear cliente"}
        {!isPending ? <ChevronRight className="size-4" /> : null}
      </button>

      <p className="mt-2 text-center text-xs text-slate-500">
        Después podés agregar sucursales, equipos y mantenimientos desde el detalle.
      </p>
    </form>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        {label}
        {required ? <span className="ml-0.5 text-red-500">*</span> : null}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
