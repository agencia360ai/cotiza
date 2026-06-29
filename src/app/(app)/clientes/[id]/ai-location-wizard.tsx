"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CATEGORY_GROUP,
  EQUIPMENT_CATEGORY_GROUP_LABEL,
  EQUIPMENT_CATEGORY_LABEL,
} from "@/lib/maintenance/types";
import {
  bulkCreateLocationsForClient,
  parseLocationsForClient,
} from "./ai-location-actions";
import type { ParsedLocationBatch } from "@/lib/ai/parse-locations";

type Equipment = {
  custom_name: string;
  brand: string | null;
  model: string | null;
  category: string | null;
  location_label: string | null;
  voltage: string | null;
  capacity_btu: number | null;
};

type Schedule = {
  report_type: "preventivo" | "inspeccion" | "instalacion";
  frequency: "mensual" | "bimestral" | "trimestral" | "semestral" | "anual" | "custom";
  frequency_days: number | null;
};

type Location = {
  name: string;
  address: string | null;
  notes: string | null;
  equipment: Equipment[];
  schedules: Schedule[];
};

type Batch = { locations: Location[] };

const FREQ_OPTIONS = [
  { value: "mensual", label: "Mensual" },
  { value: "bimestral", label: "Bimestral" },
  { value: "trimestral", label: "Trimestral" },
  { value: "semestral", label: "Semestral" },
  { value: "anual", label: "Anual" },
  { value: "custom", label: "Personalizada (días)" },
] as const;

export function AILocationWizard({
  clientId,
  open,
  onClose,
}: {
  clientId: string;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [creating, startCreate] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  async function handleParse() {
    setError(null);
    setParsing(true);
    try {
      const fd = new FormData();
      fd.set("text", text);
      for (const f of files) fd.append("files", f);
      const r = await parseLocationsForClient(clientId, fd);
      if ("error" in r) throw new Error(r.error);
      setBatch(r.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falló la IA");
    } finally {
      setParsing(false);
    }
  }

  function handleConfirm() {
    if (!batch) return;
    setError(null);
    startCreate(async () => {
      const r = await bulkCreateLocationsForClient(clientId, batch as ParsedLocationBatch);
      if ("error" in r) {
        setError(r.error);
        return;
      }
      router.refresh();
      onClose();
      setText("");
      setFiles([]);
      setBatch(null);
    });
  }

  function reset() {
    setBatch(null);
    setError(null);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-2 sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
              <Sparkles className="size-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">Agregar sucursal con IA</h3>
              <p className="text-xs text-slate-500">
                Pegá texto, dictá voz al texto o adjuntá foto/PDF — la IA estructura todo
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
            aria-label="Cerrar"
          >
            <X className="size-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          {!batch ? (
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Descripción de la sucursal y sus equipos
                </span>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={7}
                  placeholder="ej: Sucursal Costa del Este. Está en Calle 50. Tiene 2 neveras True TSSU-48, 1 cuarto frío de 4x3 metros, 3 mini split de 24000 BTU. Mantenimiento preventivo bimestral."
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm leading-relaxed focus:border-slate-400 focus:outline-none"
                />
              </label>

              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Adjuntos (opcional — foto de placa, PDF, lista)
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Plus className="size-4" />
                    Agregar archivo
                  </button>
                  {files.map((f, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs text-slate-700"
                    >
                      {f.type === "application/pdf" ? (
                        <FileText className="size-3.5" />
                      ) : (
                        <ImageIcon className="size-3.5" />
                      )}
                      {f.name}
                      <button
                        type="button"
                        onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                        className="text-slate-400 hover:text-red-600"
                        aria-label="Quitar"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  hidden
                  onChange={(e) => {
                    setFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])]);
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                />
              </div>

              {error ? (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">
                  {error}
                </p>
              ) : null}
            </div>
          ) : (
            <BatchPreview batch={batch} onChange={setBatch} />
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-slate-100 px-5 py-3">
          {batch ? (
            <button
              type="button"
              onClick={reset}
              className="text-sm text-slate-600 hover:underline"
            >
              ← Volver a editar
            </button>
          ) : (
            <span />
          )}
          {!batch ? (
            <button
              type="button"
              onClick={handleParse}
              disabled={parsing || (!text.trim() && files.length === 0)}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
            >
              {parsing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {parsing ? "Procesando…" : "Procesar con IA"}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleConfirm}
              disabled={creating || batch.locations.length === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {creating ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              Crear {batch.locations.length} sucursal{batch.locations.length === 1 ? "" : "es"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function BatchPreview({
  batch,
  onChange,
}: {
  batch: Batch;
  onChange: (b: Batch) => void;
}) {
  function updateLocation(idx: number, patch: Partial<Location>) {
    const next = { locations: batch.locations.map((l, i) => (i === idx ? { ...l, ...patch } : l)) };
    onChange(next);
  }
  function removeLocation(idx: number) {
    onChange({ locations: batch.locations.filter((_, i) => i !== idx) });
  }

  return (
    <div className="space-y-3">
      <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 ring-1 ring-inset ring-emerald-600/20">
        ✓ IA estructuró {batch.locations.length} sucursal
        {batch.locations.length === 1 ? "" : "es"}. Revisá y editá antes de confirmar.
      </p>
      {batch.locations.map((loc, idx) => (
        <LocationPreview
          key={idx}
          location={loc}
          onChange={(patch) => updateLocation(idx, patch)}
          onRemove={() => removeLocation(idx)}
        />
      ))}
    </div>
  );
}

function LocationPreview({
  location,
  onChange,
  onRemove,
}: {
  location: Location;
  onChange: (patch: Partial<Location>) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(true);

  function updateEquipment(idx: number, patch: Partial<Equipment>) {
    onChange({
      equipment: location.equipment.map((e, i) => (i === idx ? { ...e, ...patch } : e)),
    });
  }
  function removeEquipment(idx: number) {
    onChange({ equipment: location.equipment.filter((_, i) => i !== idx) });
  }
  function addEquipment() {
    onChange({
      equipment: [
        ...location.equipment,
        {
          custom_name: "",
          brand: null,
          model: null,
          category: null,
          location_label: null,
          voltage: null,
          capacity_btu: null,
        },
      ],
    });
  }

  function updateSchedule(idx: number, patch: Partial<Schedule>) {
    onChange({
      schedules: location.schedules.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    });
  }
  function removeSchedule(idx: number) {
    onChange({ schedules: location.schedules.filter((_, i) => i !== idx) });
  }
  function addSchedule() {
    onChange({
      schedules: [
        ...location.schedules,
        { report_type: "preventivo", frequency: "bimestral", frequency_days: null },
      ],
    });
  }

  return (
    <article className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-2 text-left"
        >
          {open ? <ChevronDown className="size-4 text-slate-400" /> : <ChevronRight className="size-4 text-slate-400" />}
          <p className="text-sm font-semibold text-slate-900">{location.name || "Sucursal sin nombre"}</p>
          <span className="text-xs text-slate-500">
            · {location.equipment.length} equipo{location.equipment.length === 1 ? "" : "s"}
          </span>
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="flex size-7 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
          aria-label="Quitar sucursal"
        >
          <Trash2 className="size-3.5" />
        </button>
      </header>

      {open ? (
        <div className="space-y-3 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={location.name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder="Nombre de sucursal"
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm focus:border-slate-400 focus:outline-none"
            />
            <input
              value={location.address ?? ""}
              onChange={(e) => onChange({ address: e.target.value || null })}
              placeholder="Dirección"
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm focus:border-slate-400 focus:outline-none"
            />
          </div>
          {location.notes ? (
            <textarea
              value={location.notes ?? ""}
              onChange={(e) => onChange({ notes: e.target.value || null })}
              rows={2}
              placeholder="Notas"
              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm focus:border-slate-400 focus:outline-none"
            />
          ) : null}

          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Equipos ({location.equipment.length})
              </p>
              <button
                type="button"
                onClick={addEquipment}
                className="text-xs font-semibold text-blue-600 hover:underline"
              >
                + Agregar
              </button>
            </div>
            <div className="space-y-1.5">
              {location.equipment.map((e, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-1.5 text-xs">
                  <input
                    value={e.brand ?? ""}
                    onChange={(ev) => updateEquipment(idx, { brand: ev.target.value || null })}
                    placeholder="Marca"
                    className="col-span-3 rounded border border-slate-200 bg-white px-1.5 py-1"
                  />
                  <input
                    value={e.model ?? ""}
                    onChange={(ev) => updateEquipment(idx, { model: ev.target.value || null })}
                    placeholder="Modelo"
                    className="col-span-3 rounded border border-slate-200 bg-white px-1.5 py-1"
                  />
                  <select
                    value={e.category ?? ""}
                    onChange={(ev) =>
                      updateEquipment(idx, { category: ev.target.value || null })
                    }
                    className="col-span-3 rounded border border-slate-200 bg-white px-1.5 py-1"
                  >
                    <option value="">Cat…</option>
                    {(["refrigeracion", "aire", "otros"] as const).map((g) => (
                      <optgroup key={g} label={EQUIPMENT_CATEGORY_GROUP_LABEL[g]}>
                        {EQUIPMENT_CATEGORIES.filter((c) => EQUIPMENT_CATEGORY_GROUP[c] === g).map(
                          (c) => (
                            <option key={c} value={c}>
                              {EQUIPMENT_CATEGORY_LABEL[c]}
                            </option>
                          ),
                        )}
                      </optgroup>
                    ))}
                  </select>
                  <input
                    value={e.location_label ?? ""}
                    onChange={(ev) =>
                      updateEquipment(idx, { location_label: ev.target.value || null })
                    }
                    placeholder="Ubicación"
                    className="col-span-2 rounded border border-slate-200 bg-white px-1.5 py-1"
                  />
                  <button
                    type="button"
                    onClick={() => removeEquipment(idx)}
                    className="col-span-1 flex items-center justify-center rounded text-slate-400 hover:bg-red-50 hover:text-red-600"
                    aria-label="Quitar"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Mantenimientos programados ({location.schedules.length})
              </p>
              <button
                type="button"
                onClick={addSchedule}
                className="text-xs font-semibold text-blue-600 hover:underline"
              >
                + Agregar
              </button>
            </div>
            <div className="space-y-1.5">
              {location.schedules.map((s, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-1.5 text-xs">
                  <select
                    value={s.report_type}
                    onChange={(ev) =>
                      updateSchedule(idx, {
                        report_type: ev.target.value as Schedule["report_type"],
                      })
                    }
                    className="col-span-4 rounded border border-slate-200 bg-white px-1.5 py-1"
                  >
                    <option value="preventivo">Preventivo</option>
                    <option value="inspeccion">Inspección</option>
                    <option value="instalacion">Instalación</option>
                  </select>
                  <select
                    value={s.frequency}
                    onChange={(ev) =>
                      updateSchedule(idx, {
                        frequency: ev.target.value as Schedule["frequency"],
                      })
                    }
                    className="col-span-7 rounded border border-slate-200 bg-white px-1.5 py-1"
                  >
                    {FREQ_OPTIONS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeSchedule(idx)}
                    className="col-span-1 flex items-center justify-center rounded text-slate-400 hover:bg-red-50 hover:text-red-600"
                    aria-label="Quitar"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}

void cn;
