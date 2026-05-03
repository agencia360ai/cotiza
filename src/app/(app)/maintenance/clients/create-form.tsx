"use client";

import { useState, useTransition } from "react";
import { Building2 } from "lucide-react";
import { createClientRecord } from "./actions";

export function CreateClientForm() {
  const [name, setName] = useState("");
  const [brandColor, setBrandColor] = useState("#0EA5E9");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    if (!name.trim()) return;
    setError(null);
    startTransition(async () => {
      try {
        await createClientRecord({ name: name.trim(), brand_color: brandColor });
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
      className="rounded-xl border border-border bg-card p-5"
    >
      <div className="mb-3 flex items-center gap-2">
        <Building2 className="size-4 text-slate-700" />
        <h3 className="text-sm font-semibold text-slate-900">Nuevo cliente</h3>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre del cliente *"
          className="rounded-lg border border-border bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
        />
        <div className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2">
          <input
            type="color"
            value={brandColor}
            onChange={(e) => setBrandColor(e.target.value)}
            className="size-6 cursor-pointer rounded border-0 bg-transparent"
          />
          <span className="text-xs text-slate-500">Color marca</span>
        </div>
        <button
          type="submit"
          disabled={!name.trim() || isPending}
          className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {isPending ? "Creando…" : "Crear"}
        </button>
      </div>
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    </form>
  );
}
