"use client";

import { useEffect, useState } from "react";
import { X, Link2, Copy, RefreshCw, Loader2, CheckCircle2 } from "lucide-react";
import { getEngineerLink, regenerateEngineerLink } from "./cotizador-actions";

export function EngineerLinkDialog({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await getEngineerLink();
      setLoading(false);
      if ("error" in r) setError(r.error);
      else setUrl(r.data.url);
    })();
  }, []);

  async function regen() {
    if (url && !confirm("¿Generar un link nuevo? El anterior deja de funcionar.")) return;
    setWorking(true);
    setError(null);
    const r = await regenerateEngineerLink();
    setWorking(false);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    setUrl(r.data.url);
  }

  async function copy() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link2 className="size-5 text-violet-600" />
            <h3 className="text-base font-semibold text-slate-900">Link del cotizador para ingenieros</h3>
          </div>
          <button type="button" onClick={onClose} className="flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100" aria-label="Cerrar">
            <X className="size-5" />
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Compartí este link con el equipo (WhatsApp). Abre el cotizador <b>sin login</b>: escriben una línea, revisan y
          publican — el PDF queda en Dropbox. Regenerarlo revoca el anterior.
        </p>

        {loading ? (
          <p className="mt-4 text-center text-sm text-slate-500">Cargando…</p>
        ) : (
          <>
            {url ? (
              <div className="mt-4 flex items-center gap-2">
                <input readOnly value={url} className="flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700" />
                <button
                  type="button"
                  onClick={copy}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  {copied ? <CheckCircle2 className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? "Copiado" : "Copiar"}
                </button>
              </div>
            ) : (
              <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">Todavía no hay link generado.</p>
            )}
            {error ? <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
            <button
              type="button"
              onClick={regen}
              disabled={working}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {working ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              {url ? "Regenerar link" : "Generar link"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
