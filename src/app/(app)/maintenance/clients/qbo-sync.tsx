"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Loader2, CheckCircle2, AlertTriangle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { syncQuickbooksCustomers, type SyncSummary } from "./sync-actions";

export function QuickbooksSync() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [subAsLoc, setSubAsLoc] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SyncSummary | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    setSummary(null);
    const r = await syncQuickbooksCustomers({ subCustomersAsLocations: subAsLoc });
    setRunning(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setSummary(r.summary);
    router.refresh();
  }

  return (
    <div className="mb-3 rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 p-5 text-left"
      >
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-600 to-teal-600 text-white">
          <RefreshCw className="size-5" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-slate-900">Sincronizar con QuickBooks</p>
          <p className="text-xs text-slate-600">
            Trae los clientes de QBO (con email/teléfono y sucursales) y los espeja acá. QuickBooks manda.
          </p>
        </div>
        <ChevronDown className={cn("size-5 text-emerald-600 transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div className="border-t border-emerald-100 px-5 py-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={subAsLoc}
              onChange={(e) => setSubAsLoc(e.target.checked)}
              disabled={running}
              className="size-4"
            />
            Importar sub-customers de QBO como sucursales
          </label>

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={run}
              disabled={running}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {running ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {running ? "Sincronizando…" : "Sincronizar ahora"}
            </button>
            <p className="text-xs text-slate-500">Se puede correr de nuevo; actualiza lo existente y agrega lo nuevo.</p>
          </div>

          {error ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-inset ring-red-600/20">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {summary ? (
            <div className="mt-3 rounded-lg bg-white/70 p-3 ring-1 ring-inset ring-emerald-600/15">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
                <CheckCircle2 className="size-4" /> {summary.fetched} customers de QBO
              </div>
              <ul className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-slate-600">
                <li>Clientes nuevos: <b className="tabular-nums text-slate-900">{summary.clientsCreated}</b></li>
                <li>Actualizados: <b className="tabular-nums text-slate-900">{summary.clientsUpdated}</b></li>
                <li>Contactos: <b className="tabular-nums text-slate-900">{summary.contactsUpserted}</b></li>
                <li>Sucursales: <b className="tabular-nums text-slate-900">{summary.locationsUpserted}</b></li>
                {summary.skipped > 0 ? <li>Omitidos: <b className="tabular-nums text-slate-900">{summary.skipped}</b></li> : null}
              </ul>
              {summary.toolUsed ? <p className="mt-1.5 text-[11px] text-slate-400">Tool QBO: {summary.toolUsed}</p> : null}
              {summary.errors.length > 0 ? (
                <ul className="mt-2 space-y-0.5 text-[11px] text-amber-700">
                  {summary.errors.map((e, i) => (
                    <li key={i}>⚠ {e}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
