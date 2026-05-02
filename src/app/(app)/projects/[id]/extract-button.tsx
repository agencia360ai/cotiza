"use client";

import { useState, useTransition } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runExtraction } from "./actions";

export function ExtractButton({ projectId, label }: { projectId: string; label: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const res = await runExtraction(projectId);
            if (res && "error" in res && res.error) setError(res.error);
          })
        }
        disabled={pending}
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        {pending ? "Analizando con IA..." : label}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
