"use client";

import { useState, useTransition } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { Gap } from "@/lib/ai/identify-gaps";
import { updateExtractedData } from "./actions";

export function GapsForm({ projectId, gaps }: { projectId: string; gaps: Gap[] }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  if (gaps.length === 0) return null;

  const critical = gaps.filter((g) => g.priority === "critical");
  const helpful = gaps.filter((g) => g.priority === "helpful");

  const onSubmit = () => {
    const patch: Record<string, unknown> = {};
    for (const [k, raw] of Object.entries(values)) {
      if (raw === "" || raw === undefined) continue;
      const gap = gaps.find((g) => g.field === k);
      patch[k] = gap?.inputType === "number" ? Number(raw) : raw;
    }
    if (Object.keys(patch).length === 0) return;
    startTransition(async () => {
      await updateExtractedData(projectId, patch);
      setValues({});
    });
  };

  const renderField = (g: Gap) => (
    <div key={g.field} className="flex flex-col gap-2">
      <Label htmlFor={g.field} className="text-sm">
        {g.label}
      </Label>
      {g.inputType === "choice" ? (
        <NativeSelect
          id={g.field}
          value={values[g.field] ?? ""}
          onChange={(e) => setValues({ ...values, [g.field]: e.target.value })}
        >
          <option value="">—</option>
          {(g.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </NativeSelect>
      ) : (
        <Input
          id={g.field}
          type={g.inputType === "number" ? "number" : "text"}
          step={g.inputType === "number" ? "0.1" : undefined}
          value={values[g.field] ?? ""}
          onChange={(e) => setValues({ ...values, [g.field]: e.target.value })}
        />
      )}
    </div>
  );

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20 p-6">
      <div className="flex items-start gap-3 mb-5">
        <AlertCircle className="size-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
        <div>
          <h3 className="text-sm font-semibold">Para hacer la cotización más precisa, necesito unos datos más</h3>
          {critical.length > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {critical.length} crítico{critical.length === 1 ? "" : "s"} ·{" "}
              {helpful.length} opcional{helpful.length === 1 ? "" : "es"}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
        {critical.map(renderField)}
        {helpful.map(renderField)}
      </div>

      <div className="mt-5">
        <Button onClick={onSubmit} disabled={pending || Object.keys(values).length === 0}>
          {pending ? "Guardando..." : "Guardar"}
        </Button>
      </div>
    </div>
  );
}
