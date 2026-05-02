"use client";

import { useRef, useState, useTransition } from "react";
import { Upload, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { createDocumentRows } from "./actions";

type Props = {
  orgId: string;
  projectId: string;
};

export function UploadZone({ orgId, projectId }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onPick = () => inputRef.current?.click();

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);

    const supabase = createClient();
    const rows: Parameters<typeof createDocumentRows>[1] = [];

    for (const file of Array.from(files)) {
      const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
      const path = `${orgId}/${projectId}/${Date.now()}_${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from("cotiza-documents")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) {
        setError(`${file.name}: ${uploadError.message}`);
        return;
      }
      rows.push({
        fileName: file.name,
        storagePath: path,
        mimeType: file.type || "application/pdf",
        sizeBytes: file.size,
      });
    }

    startTransition(async () => {
      const res = await createDocumentRows(projectId, rows);
      if (res && "error" in res && res.error) setError(res.error);
    });
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />
      <button
        type="button"
        onClick={onPick}
        disabled={pending}
        className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-sm text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
      >
        {pending ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
        <span className="font-medium text-foreground">
          {pending ? "Subiendo..." : "Subir planos, especificaciones, fotos"}
        </span>
        <span className="text-xs">PDF, PNG, JPG o WebP — hasta 50 MB cada uno</span>
      </button>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onPick} disabled={pending}>
        Agregar más archivos
      </Button>
    </div>
  );
}
