"use client";

import { useState, useTransition } from "react";
import { Pencil, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { ProjectExtraction } from "@/lib/ai/types";
import { updateExtractedData } from "./actions";

const FIELD_LABELS: Record<string, string> = {
  building_type: "Tipo de edificación",
  client_name: "Cliente",
  location: "Ubicación",
  total_area_m2: "Área total (m²)",
  floors: "Pisos",
  ceiling_height_m: "Altura de techo (m)",
  insulation_quality: "Calidad de aislamiento",
  windows_orientation: "Orientación de ventanas",
  occupants_estimate: "Ocupantes estimados",
  preferred_system_type: "Sistema preferido",
};

const ENUM_OPTIONS: Record<string, string[]> = {
  building_type: ["residential", "commercial", "industrial", "mixed"],
  insulation_quality: ["poor", "standard", "good", "unknown"],
  preferred_system_type: ["mini_split", "split_central", "vrf", "chiller", "rooftop", "unspecified"],
};

export function ExtractionCard({ projectId, extraction }: { projectId: string; extraction: ProjectExtraction }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProjectExtraction>(extraction);
  const [pending, startTransition] = useTransition();

  const fields = ["building_type", "total_area_m2", "floors", "ceiling_height_m", "occupants_estimate", "insulation_quality", "preferred_system_type", "location"] as const;

  const onSave = () => {
    startTransition(async () => {
      await updateExtractedData(projectId, draft);
      setEditing(false);
    });
  };

  const renderValue = (field: string) => {
    const v = (extraction as Record<string, unknown>)[field];
    if (v === null || v === undefined || v === "") return <span className="text-muted-foreground">—</span>;
    if (typeof v === "number") return <span>{v}</span>;
    return <span>{String(v)}</span>;
  };

  const renderInput = (field: string) => {
    const value = (draft as Record<string, unknown>)[field];
    const opts = ENUM_OPTIONS[field];
    if (opts) {
      return (
        <NativeSelect
          value={(value as string) ?? ""}
          onChange={(e) => setDraft({ ...draft, [field]: e.target.value || null } as ProjectExtraction)}
        >
          <option value="">—</option>
          {opts.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </NativeSelect>
      );
    }
    const isNumber = typeof (extraction as Record<string, unknown>)[field] === "number" || /m2|height|floors|occupants/.test(field);
    return (
      <Input
        type={isNumber ? "number" : "text"}
        step={isNumber ? "0.1" : undefined}
        value={value === null || value === undefined ? "" : String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          const next = isNumber ? (raw === "" ? null : Number(raw)) : raw === "" ? null : raw;
          setDraft({ ...draft, [field]: next } as ProjectExtraction);
        }}
      />
    );
  };

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h3 className="text-sm font-semibold">Lo que entendió la IA</h3>
          <p className="text-xs text-muted-foreground mt-0.5 uppercase tracking-wider">
            Confianza: {extraction.confidence}
          </p>
        </div>
        {editing ? (
          <Button size="sm" onClick={onSave} disabled={pending}>
            <Save className="size-3.5" />
            Guardar
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" />
            Editar
          </Button>
        )}
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
        {fields.map((f) => (
          <div key={f} className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">{FIELD_LABELS[f]}</Label>
            {editing ? renderInput(f) : <div className="text-sm">{renderValue(f)}</div>}
          </div>
        ))}
      </dl>

      {extraction.source_summary && (
        <p className="mt-6 pt-4 border-t border-border text-xs text-muted-foreground italic">
          {extraction.source_summary}
        </p>
      )}
    </div>
  );
}
