"use client";

import { useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { CotizadorDialog, type CotizadorApi } from "@/app/(app)/potenciales/cotizador";
import { portalGenerate, portalSave, portalPublish } from "./actions";

export function PortalCotizador({ token, orgName }: { token: string; orgName: string }) {
  const [doneCount, setDoneCount] = useState(0);
  const [resetKey, setResetKey] = useState(0);

  const api: CotizadorApi = useMemo(
    () => ({
      generate: (brief) => portalGenerate(token, brief),
      save: (input) => portalSave(token, input),
      publish: (id) => portalPublish(token, id),
    }),
    [token],
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-5 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Cotizador · {orgName}</h1>
        <p className="mt-1 text-sm text-slate-500">
          Describí el trabajo en una línea, revisá la cotización y publicala — el PDF queda en la carpeta de cartas de
          Dropbox y podés mandarlo por WhatsApp o Email.
        </p>
        {doneCount > 0 ? (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <CheckCircle2 className="size-3.5" /> {doneCount} cotización{doneCount === 1 ? "" : "es"} creada{doneCount === 1 ? "" : "s"} en esta sesión
          </p>
        ) : null}
      </header>

      <CotizadorDialog
        key={resetKey}
        embedded
        api={api}
        onCreated={() => setDoneCount((n) => n + 1)}
        onClose={() => setResetKey((k) => k + 1)}
      />

      <p className="mt-6 text-center text-[11px] text-slate-400">
        DICEC, Inc · Reportme.ai — al terminar, &ldquo;Listo&rdquo; limpia el formulario para la próxima.
      </p>
    </div>
  );
}
