"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { publishReport, unpublishReport, deleteReport, updateReportSummary } from "../actions";

export function PublishControls({
  reportId,
  status,
}: {
  reportId: string;
  status: "draft" | "published" | "accepted";
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function publish() {
    setError(null);
    startTransition(async () => {
      const r = await publishReport(reportId);
      if ("error" in r) setError(r.error);
      else router.refresh();
    });
  }

  function unpublish() {
    setError(null);
    startTransition(async () => {
      const r = await unpublishReport(reportId);
      if ("error" in r) setError(r.error);
      else router.refresh();
    });
  }

  function handleDelete() {
    if (!confirm("¿Eliminar este reporte? No se puede deshacer.")) return;
    setError(null);
    startTransition(async () => {
      const r = await deleteReport(reportId);
      if ("error" in r) setError(r.error);
      else router.push("/maintenance/reports");
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {status === "draft" ? (
          <button
            type="button"
            onClick={publish}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            <CheckCircle2 className="size-4" />
            {isPending ? "Publicando…" : "Publicar"}
          </button>
        ) : (
          <button
            type="button"
            onClick={unpublish}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200 disabled:opacity-50"
          >
            <RotateCcw className="size-4" />
            Despublicar
          </button>
        )}
        <button
          type="button"
          onClick={handleDelete}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs text-red-600 hover:bg-red-50"
          title="Eliminar"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

export function SummaryEditor({
  reportId,
  initialSummary,
}: {
  reportId: string;
  initialSummary: string;
}) {
  const [summary, setSummary] = useState(initialSummary);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (summary === initialSummary) return;
    setIsSaving(true);
    setError(null);
    const r = await updateReportSummary(reportId, summary);
    setIsSaving(false);
    if ("error" in r) setError(r.error);
    else setSavedAt(new Date());
  }

  return (
    <div className="mt-1">
      <textarea
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        onBlur={save}
        rows={3}
        placeholder="Sin resumen aún"
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed focus:border-slate-400 focus:outline-none"
      />
      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
        <span>{isSaving ? "Guardando…" : savedAt ? `Guardado ${savedAt.toLocaleTimeString("es-PA")}` : ""}</span>
        {error ? <span className="text-red-600">{error}</span> : null}
      </div>
    </div>
  );
}
