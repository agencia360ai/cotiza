"use client";

import { useEffect, useState } from "react";
import { X, Link2, Copy, RefreshCw, Loader2, CheckCircle2, Pencil } from "lucide-react";
import { getEngineerLink, regenerateEngineerLink, setEngineerLinkCode } from "./cotizador-actions";

export function EngineerLinkDialog({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [code, setCode] = useState("");
  const [savingCode, setSavingCode] = useState(false);

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

  async function saveCode() {
    const c = code.trim();
    if (!c) return;
    if (url && !confirm(`El link pasa a terminar en /q/${c.toLowerCase()} y el anterior deja de funcionar. ¿Seguimos?`)) return;
    setSavingCode(true);
    setError(null);
    const r = await setEngineerLinkCode(c);
    setSavingCode(false);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    setUrl(r.data.url);
    setCode("");
  }

  async function copy() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
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
          publican — el PDF queda en Dropbox.
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

            <div className="mt-4 rounded-xl border border-violet-100 bg-violet-50/50 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-violet-800">
                <Pencil className="size-3.5" /> Código fácil de recordar
              </p>
              <p className="mt-1 text-[11px] text-violet-600">
                En vez de un token largo, elige un código corto para dictarlo de memoria (ej: <b>dicec</b> →{" "}
                <span className="tabular-nums">…/q/dicec</span>). Ojo: un código obvio es fácil de adivinar por terceros.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <span className="shrink-0 text-xs font-medium text-slate-400">/q/</span>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="dicec"
                  maxLength={30}
                  className="min-w-0 flex-1 rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs text-slate-700 focus:border-violet-400 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={saveCode}
                  disabled={savingCode || !code.trim()}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  {savingCode ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                  Usar código
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={regen}
              disabled={working}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {working ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              {url ? "Regenerar link aleatorio" : "Generar link"}
            </button>
            <p className="mt-1.5 text-[10px] text-slate-400">Cambiar el código o regenerar revoca el link anterior.</p>
          </>
        )}
      </div>
    </div>
  );
}
