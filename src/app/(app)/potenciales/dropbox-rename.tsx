"use client";

import { useEffect, useState } from "react";
import { X, Loader2, FolderInput, RefreshCw, CheckCircle2, ArrowRight, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { listDropboxRenames, applyDropboxRename, type RenameItem } from "./dropbox-rename-actions";

const DEFAULT_FOLDER = "/Dicec/Proyectos/01 Cotizaciones/01 Cartas de Cotizaciones/2026";

export function DropboxRenameDialog({ onClose }: { onClose: () => void }) {
  const [folder, setFolder] = useState(DEFAULT_FOLDER);
  const [files, setFiles] = useState<RenameItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<Map<string, string>>(new Map());

  async function load() {
    setLoading(true);
    setError(null);
    setDone(new Set());
    setFailed(new Map());
    const r = await listDropboxRenames(folder);
    setLoading(false);
    if ("error" in r) {
      setError(r.error);
      setFiles(null);
      return;
    }
    setFiles(r.data.files);
    setSelected(new Set(r.data.files.filter((f) => f.changed).map((f) => f.fileId)));
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const changed = (files ?? []).filter((f) => f.changed);
  const selCount = (files ?? []).filter((f) => f.changed && selected.has(f.fileId) && !done.has(f.fileId)).length;

  async function run() {
    const queue = (files ?? []).filter((f) => f.changed && selected.has(f.fileId) && !done.has(f.fileId));
    if (queue.length === 0) return;
    setRunning(true);
    for (let i = 0; i < queue.length; i++) {
      const f = queue[i];
      setProgress({ done: i, total: queue.length });
      const r = await applyDropboxRename(f.fileId, f.fromPath, f.toName);
      if ("error" in r) {
        setFailed((prev) => new Map(prev).set(f.fileId, r.error));
      } else {
        setDone((prev) => new Set(prev).add(f.fileId));
        setFiles((prev) => (prev ?? []).map((x) => (x.fileId === f.fileId ? { ...x, fromName: f.toName, fromPath: r.data.newPath, changed: false } : x)));
      }
    }
    setProgress({ done: queue.length, total: queue.length });
    setRunning(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <FolderInput className="size-5 text-blue-600" />
            <h3 className="text-base font-semibold text-slate-900">Normalizar nombres en Dropbox</h3>
          </div>
          <button type="button" onClick={onClose} className="flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100" aria-label="Cerrar">
            <X className="size-5" />
          </button>
        </header>

        <div className="border-b border-slate-100 px-5 py-3">
          <div className="flex items-center gap-2">
            <input
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              placeholder="/ruta/de/la/carpeta"
            />
            <button
              type="button"
              onClick={load}
              disabled={loading || running}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Listar
            </button>
          </div>
          {error ? <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-inset ring-red-600/20">{error}</p> : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <p className="py-10 text-center text-sm text-slate-500">Leyendo la carpeta…</p>
          ) : files === null ? (
            <p className="py-10 text-center text-sm text-slate-500">Pegá la ruta y tocá &ldquo;Listar&rdquo;.</p>
          ) : changed.length === 0 ? (
            <p className="py-10 text-center text-sm text-emerald-600">Todo ya tiene el nombre canónico. Nada que renombrar.</p>
          ) : (
            <ul className="space-y-1">
              {files.map((f) => {
                if (!f.changed && !done.has(f.fileId)) return null;
                const fail = failed.get(f.fileId);
                const isDone = done.has(f.fileId);
                return (
                  <li key={f.fileId}>
                    <label className={cn("flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-slate-50", isDone && "opacity-60")}>
                      <input
                        type="checkbox"
                        checked={selected.has(f.fileId) && !isDone}
                        disabled={isDone || running}
                        onChange={() => toggle(f.fileId)}
                        className="mt-0.5 size-4 shrink-0"
                      />
                      <div className="min-w-0 flex-1 text-xs">
                        <p className="truncate text-slate-400 line-through">{f.fromName}</p>
                        <p className="mt-0.5 flex items-center gap-1 truncate font-medium text-slate-800">
                          <ArrowRight className="size-3 shrink-0 text-emerald-500" />
                          {f.toName}
                        </p>
                        {fail ? <p className="mt-0.5 text-[11px] text-red-600">⚠ {fail}</p> : null}
                        {!f.matched ? <p className="mt-0.5 text-[11px] text-amber-600">solo número (no está importada — sin cliente/descripción)</p> : null}
                      </div>
                      {isDone ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="border-t border-slate-100 px-5 py-3">
          {running && progress ? (
            <div className="mb-2">
              <div className="mb-1 flex justify-between text-xs text-slate-500">
                <span>Renombrando…</span>
                <span className="tabular-nums">{progress.done}/{progress.total}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-blue-600 transition-[width]" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
              </div>
            </div>
          ) : null}
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              {files ? `${changed.length} a renombrar · ${done.size} listas${failed.size ? ` · ${failed.size} con error` : ""}` : ""}
            </p>
            <button
              type="button"
              onClick={run}
              disabled={running || selCount === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {running ? <Loader2 className="size-4 animate-spin" /> : null}
              Renombrar {selCount > 0 ? `(${selCount})` : ""}
            </button>
          </div>
          <p className="mt-2 flex items-start gap-1 text-[11px] text-slate-400">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
            Renombra los archivos en Dropbox. El número queda con 3 dígitos para ordenar bien. Dropbox guarda el historial; el dedup usa el file-id, no se rompe.
          </p>
        </footer>
      </div>
    </div>
  );
}
