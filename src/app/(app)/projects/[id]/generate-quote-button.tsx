"use client";

import { useState, useTransition } from "react";
import { FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateQuote } from "./actions";

export function GenerateQuoteButton({ projectId, disabled }: { projectId: string; disabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <Button
        size="lg"
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const res = await generateQuote(projectId);
            if (res && "error" in res && res.error) setError(res.error);
          })
        }
        disabled={disabled || pending}
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
        {pending ? "Generando cotización..." : "Generar cotización con IA"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
