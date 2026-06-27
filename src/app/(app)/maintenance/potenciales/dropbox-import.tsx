"use client";

import { useEffect, useState } from "react";
import { X, Loader2, FolderOpen, RefreshCw, CheckCircle2, AlertTriangle, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoneyExact, type QuoteRow } from "@/lib/pipeline/types";
import { listDropboxFolder, importDropboxFile, type DropboxFileItem } from "./dropbox-actions";

const DEFAULT_FOLDER = "/Dicec/Proyectos/01 Cotizaciones/01 Cartas de Cotizaciones/2026";

type RowResult = { name: string; ok: boolean; msg: string };

export function DropboxImportDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (rows: QuoteRow[]) => void;
}) {
  const [folder, setFolder] = useState(DEFAULT_FOLDER);
  const [files, setFiles] = useState<DropboxFileItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const [results, setResults] = useState<RowResult[]>([]);

  async function load() {
    setLoading(true);
    setError(null);
    setResults([]);
    const r = await listDropboxFolder(folder);
    setLoading(false);
    if ("error" in r) {
      setError(r.error);
      setFiles(null);
      return;
    }
    setFiles(r.data.files);
    // Pre-seleccionar las nuevas.
    setSelected(new Set(r.data.files.filter((f) => !f.alreadyImported).map((f) => f.path)));
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  const nuevas = (files ?? []).filter((f) => !f.alreadyImported);
  const selCount = (files ?? []).filter((f) => selected.has(f.path) && !f.alreadyImported).length;

  async function runImport() {
    const queue = (files ?? []).filter((f) => selected.has(f.path) && !f.alreadyImported);
    if (queue.length === 0) return;
    setImporting(true);
    setResults([]);
    const created: QuoteRow[] = [];
    for (let i = 0; i < queue.length; i++) {
      const f = queue[i];
      setProgress({ done: i, total: queue.length, current: f.name });
      const r = await importDropboxFile(f.path, f.name);
      if ("error" in r) {
        setResults((prev) => [...prev, { name: f.name, ok: false, msg: r.error }]);
      } else {
        created.push(r.data);
        setResults((prev) => [...prev, { name: f.name, ok: true, msg: `${r.data.quote_number} · ${formatMoneyExact(r.data.amount_usd)}` }]);
        setFiles((prev) => (prev ?? []).map((x) => (x.path === f.path ? { ...x, alreadyImported: true } : x)));
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(f.path);
          return next;
        });
      }
    }
    setProgress({ done: queue.length, total: queue.length, current: "" });
    setImporting(false);
    if (created.length) onImported(created);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <FolderOpen className="size-5 text-blue-600" />
            <h3 className="text-base font-semibold text-slate-900">Importar de Dropbox</h3>
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
              disabled={loading || importing}
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
          ) : files.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">No hay PDFs en esta carpeta.</p>
          ) : (
            <ul className="space-y-1">
              {files.map((f) => {
                const isSel = selected.has(f.path);
                const res = results.find((r) => r.name === f.name);
                return (
                  <li key={f.path}>
                    <label className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50", f.alreadyImported && "opacity-60")}>
                      <input
                        type="checkbox"
                        checked={isSel}
                        disabled={f.alreadyImported || importing}
                        onChange={() => toggle(f.path)}
                        className="size-4 shrink-0"
                      />
                      <FileText className="size-4 shrink-0 text-slate-400" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-slate-800">{f.name}</p>
                        {res ? (
                          <p className={cn("text-xs", res.ok ? "text-emerald-600" : "text-red-600")}>{res.msg}</p>
                        ) : (
                          <p className="text-[11px] text-slate-400">{f.guessedNumber ?? "número no detectado"}</p>
                        )}
                      </div>
                      {f.alreadyImported ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
                          <CheckCircle2 className="size-3.5" /> importada
                        </span>
                      ) : res && !res.ok ? (
                        <AlertTriangle className="size-4 text-red-500" />
                      ) : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="border-t border-slate-100 px-5 py-3">
          {importing && progress ? (
            <div className="mb-2">
              <div className="mb-1 flex justify-between text-xs text-slate-500">
                <span className="truncate">{progress.current}</span>
                <span className="tabular-nums">{progress.done}/{progress.total}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-blue-600 transition-[width]" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
              </div>
            </div>
          ) : null}
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              {files ? `${nuevas.length} nuevas · ${selCount} seleccionadas` : ""}
            </p>
            <button
              type="button"
              onClick={runImport}
              disabled={importing || selCount === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {importing ? <Loader2 className="size-4 animate-spin" /> : null}
              Importar {selCount > 0 ? `(${selCount})` : ""}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Cada PDF se lee con IA para extraer número, cliente, monto, fecha y rubro. Las ya importadas se saltean.
          </p>
        </footer>
      </div>
    </div>
  );
}
