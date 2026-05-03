"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  AlertTriangle,
  XOctagon,
  PowerOff,
  Plus,
  Trash2,
  X,
  Camera,
  Upload,
  Loader2,
  ChevronDown,
  ChevronRight,
  Save,
  Edit3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  STATUS_COLOR,
  STATUS_LABEL,
  PRIORITY_TINT,
  imageUrl,
  type EquipmentStatus,
  type Recommendation,
} from "@/lib/maintenance/types";
import {
  addReportItem,
  deleteReportItem,
  updateReportItem,
  uploadItemPhoto,
  removeItemPhoto,
  updateReportFields,
} from "../actions";

const STATUS_BUTTONS: { value: EquipmentStatus; label: string; icon: typeof CheckCircle2 }[] = [
  { value: "operativo", label: "Operativo", icon: CheckCircle2 },
  { value: "atencion", label: "Atención", icon: AlertTriangle },
  { value: "critico", label: "Crítico", icon: XOctagon },
  { value: "fuera_de_servicio", label: "Fuera de servicio", icon: PowerOff },
];

const COMMON_CHECKLIST = [
  "Tomacorrientes",
  "Enchufe de alimentación",
  "Empaques de puertas",
  "Funcionamiento normal",
  "Cordón de alimentación",
  "Protector de voltaje",
  "Filtros",
  "Cables de alimentación",
  "Cables de señal",
  "Drenaje de condensado",
];

type Equipment = {
  id: string;
  brand: string | null;
  model: string | null;
  custom_name: string;
  location_label: string | null;
};

type Item = {
  id: string;
  equipment_id: string;
  equipment_status: EquipmentStatus;
  observations_es: string | null;
  recommendations: Recommendation[];
  parts_replaced: { name: string; quantity?: number }[];
  checklist_items: string[];
  photo_paths: string[];
  position: number;
  equipment: Equipment | null;
};

type Tech = { id: string; name: string };

export function ReportHeaderEditor({
  reportId,
  performedByName,
  performedAtStart,
  technicianId,
  technicians,
  status,
}: {
  reportId: string;
  performedByName: string | null;
  performedAtStart: string;
  technicianId: string | null;
  technicians: Tech[];
  status: "draft" | "published" | "accepted";
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const editable = status === "draft";

  function patch(field: string, value: unknown) {
    if (!editable) return;
    startTransition(async () => {
      await updateReportFields(reportId, { [field]: value });
      router.refresh();
    });
  }

  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Fecha
        </label>
        <input
          type="date"
          disabled={!editable || isPending}
          defaultValue={performedAtStart.slice(0, 10)}
          onBlur={(e) => patch("performed_at_start", new Date(e.target.value + "T00:00:00").toISOString())}
          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500"
        />
      </div>
      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Técnico (texto libre)
        </label>
        <input
          type="text"
          disabled={!editable || isPending}
          defaultValue={performedByName ?? ""}
          onBlur={(e) => patch("performed_by_name", e.target.value || null)}
          placeholder="Nombre del técnico"
          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500"
        />
      </div>
      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Asignar a técnico del sistema
        </label>
        <select
          disabled={!editable || isPending}
          defaultValue={technicianId ?? ""}
          onChange={(e) => patch("technician_id", e.target.value || null)}
          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500"
        >
          <option value="">Sin asignar</option>
          {technicians.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function EditableItemsList({
  reportId,
  items: initialItems,
  availableEquipment,
  status,
}: {
  reportId: string;
  items: Item[];
  availableEquipment: Equipment[];
  status: "draft" | "published" | "accepted";
}) {
  const [items, setItems] = useState(initialItems);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedEqId, setSelectedEqId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const inReport = new Set(items.map((i) => i.equipment_id));
  const available = availableEquipment.filter((e) => !inReport.has(e.id));

  function patchItem(itemId: string, patch: Partial<Item>) {
    setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, ...patch } : it)));
    startTransition(async () => {
      await updateReportItem(reportId, itemId, patch);
    });
  }

  function addItem() {
    if (!selectedEqId) return;
    setError(null);
    startTransition(async () => {
      const r = await addReportItem(reportId, selectedEqId);
      if ("error" in r) setError(r.error);
      else {
        setSelectedEqId("");
        setShowAdd(false);
        router.refresh();
      }
    });
  }

  function removeItem(itemId: string) {
    if (!confirm("¿Eliminar este equipo del reporte?")) return;
    setItems((prev) => prev.filter((it) => it.id !== itemId));
    startTransition(async () => {
      await deleteReportItem(reportId, itemId);
      router.refresh();
    });
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700">
          Equipos inspeccionados ({items.length})
        </h2>
        {status === "draft" ? (
          <button
            type="button"
            onClick={() => setShowAdd(!showAdd)}
            disabled={available.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {showAdd ? "Cancelar" : (
              <>
                <Plus className="size-3.5" />
                Agregar equipo
              </>
            )}
          </button>
        ) : null}
      </div>

      {showAdd && status === "draft" ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-blue-300 bg-blue-50/50 p-3">
          <select
            value={selectedEqId}
            onChange={(e) => setSelectedEqId(e.target.value)}
            className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Elegí un equipo…</option>
            {available.map((e) => (
              <option key={e.id} value={e.id}>
                {e.brand ?? ""} {e.model ?? ""} — {e.location_label ?? e.custom_name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={addItem}
            disabled={!selectedEqId || isPending}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Agregar
          </button>
        </div>
      ) : null}

      {error ? <p className="mb-3 text-xs text-red-600">{error}</p> : null}

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-12 text-center">
          <p className="text-sm text-muted-foreground">Sin equipos en el reporte aún</p>
          {status === "draft" && available.length > 0 ? (
            <button
              onClick={() => setShowAdd(true)}
              className="mt-2 text-sm font-semibold text-blue-600 hover:underline"
            >
              Agregar el primer equipo
            </button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <ItemEditor
              key={item.id}
              item={item}
              reportId={reportId}
              editable={status === "draft"}
              onChange={(patch) => patchItem(item.id, patch)}
              onRemove={() => removeItem(item.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ItemEditor({
  item,
  reportId,
  editable,
  onChange,
  onRemove,
}: {
  item: Item;
  reportId: string;
  editable: boolean;
  onChange: (patch: Partial<Item>) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const color = STATUS_COLOR[item.equipment_status];

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 border-b border-border bg-slate-50/50 px-4 py-3 text-left"
      >
        {open ? <ChevronDown className="size-4 text-slate-400" /> : <ChevronRight className="size-4 text-slate-400" />}
        <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">
            {item.equipment?.brand} {item.equipment?.model}
          </p>
          <p className="text-xs text-slate-500">
            {item.equipment?.location_label ?? item.equipment?.custom_name ?? ""}
          </p>
        </div>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset"
          style={{ backgroundColor: `${color}15`, color, borderColor: color }}
        >
          {STATUS_LABEL[item.equipment_status]}
        </span>
        {editable ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="rounded p-1 text-red-600 hover:bg-red-50"
          >
            <Trash2 className="size-3.5" />
          </button>
        ) : null}
      </button>

      {open ? (
        <div className="space-y-4 p-4">
          {/* Status */}
          {editable ? (
            <div className="grid grid-cols-2 gap-2">
              {STATUS_BUTTONS.map((s) => {
                const active = item.equipment_status === s.value;
                return (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => onChange({ equipment_status: s.value })}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border-2 px-3 py-2 text-sm font-semibold transition-all",
                      active ? "ring-2 ring-offset-2" : "border-slate-200 text-slate-600 hover:border-slate-400",
                    )}
                    style={
                      active
                        ? {
                            borderColor: STATUS_COLOR[s.value],
                            backgroundColor: `${STATUS_COLOR[s.value]}15`,
                            color: STATUS_COLOR[s.value],
                          }
                        : undefined
                    }
                  >
                    <s.icon className="size-4" />
                    {s.label}
                  </button>
                );
              })}
            </div>
          ) : null}

          {/* Observations */}
          <FieldLabel>Observaciones</FieldLabel>
          {editable ? (
            <textarea
              defaultValue={item.observations_es ?? ""}
              onBlur={(e) => onChange({ observations_es: e.target.value || null })}
              rows={3}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              placeholder="Describí lo que observaste en este equipo…"
            />
          ) : (
            <p className="text-sm text-slate-700">{item.observations_es ?? "—"}</p>
          )}

          {/* Recommendations */}
          <FieldLabel>Recomendaciones</FieldLabel>
          <RecommendationsEditor
            value={item.recommendations}
            onChange={(recs) => onChange({ recommendations: recs })}
            editable={editable}
          />

          {/* Checklist */}
          <FieldLabel>Elementos revisados</FieldLabel>
          <ChecklistEditor
            value={item.checklist_items}
            onChange={(items) => onChange({ checklist_items: items })}
            editable={editable}
          />

          {/* Parts replaced */}
          <FieldLabel>Partes reemplazadas</FieldLabel>
          <PartsEditor
            value={item.parts_replaced}
            onChange={(parts) => onChange({ parts_replaced: parts })}
            editable={editable}
          />

          {/* Photos */}
          <FieldLabel>Fotos ({item.photo_paths.length})</FieldLabel>
          <PhotosEditor
            reportId={reportId}
            itemId={item.id}
            paths={item.photo_paths}
            onChange={(paths) => onChange({ photo_paths: paths })}
            editable={editable}
          />
        </div>
      ) : null}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
      {children}
    </label>
  );
}

function RecommendationsEditor({
  value,
  onChange,
  editable,
}: {
  value: Recommendation[];
  onChange: (next: Recommendation[]) => void;
  editable: boolean;
}) {
  const [newDesc, setNewDesc] = useState("");
  const [newPriority, setNewPriority] = useState<Recommendation["priority"]>("media");

  function add() {
    if (!newDesc.trim()) return;
    onChange([...value, { priority: newPriority, description: newDesc.trim() }]);
    setNewDesc("");
  }

  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  function updatePriority(idx: number, p: Recommendation["priority"]) {
    const next = [...value];
    next[idx] = { ...next[idx], priority: p };
    onChange(next);
  }

  return (
    <div className="space-y-2">
      {value.length === 0 && !editable ? (
        <p className="text-sm text-slate-400">Sin recomendaciones</p>
      ) : null}
      {value.map((r, idx) => (
        <div key={idx} className="flex items-start gap-2 text-sm">
          {editable ? (
            <select
              value={r.priority}
              onChange={(e) => updatePriority(idx, e.target.value as Recommendation["priority"])}
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ring-1 ring-inset",
                PRIORITY_TINT[r.priority],
              )}
            >
              <option value="alta">Alta</option>
              <option value="media">Media</option>
              <option value="baja">Baja</option>
            </select>
          ) : (
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ring-1 ring-inset",
                PRIORITY_TINT[r.priority],
              )}
            >
              {r.priority}
            </span>
          )}
          <span className="flex-1 text-slate-700">{r.description}</span>
          {editable ? (
            <button
              onClick={() => remove(idx)}
              className="rounded p-0.5 text-red-600 hover:bg-red-50"
            >
              <X className="size-3" />
            </button>
          ) : null}
        </div>
      ))}
      {editable ? (
        <div className="flex gap-2">
          <select
            value={newPriority}
            onChange={(e) => setNewPriority(e.target.value as Recommendation["priority"])}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
          >
            <option value="alta">Alta</option>
            <option value="media">Media</option>
            <option value="baja">Baja</option>
          </select>
          <input
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
            placeholder="Nueva recomendación…"
            className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={add}
            disabled={!newDesc.trim()}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ChecklistEditor({
  value,
  onChange,
  editable,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  editable: boolean;
}) {
  const [custom, setCustom] = useState("");
  const set = new Set(value);
  const suggestions = COMMON_CHECKLIST.filter((c) => !set.has(c));

  function toggle(item: string) {
    if (set.has(item)) onChange(value.filter((v) => v !== item));
    else onChange([...value, item]);
  }

  function addCustom() {
    if (!custom.trim()) return;
    onChange([...value, custom.trim()]);
    setCustom("");
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {value.map((c) => (
          <span
            key={c}
            className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700"
          >
            ✓ {c}
            {editable ? (
              <button onClick={() => toggle(c)} className="text-emerald-600 hover:text-red-600">
                <X className="size-3" />
              </button>
            ) : null}
          </span>
        ))}
      </div>
      {editable && suggestions.length > 0 ? (
        <div>
          <p className="mb-1 text-[10px] text-slate-400">Click para agregar:</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => toggle(s)}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-600 hover:border-slate-500 hover:bg-slate-50"
              >
                <Plus className="size-3" />
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {editable ? (
        <div className="flex gap-2">
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCustom())}
            placeholder="Otro elemento…"
            className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs"
          />
          <button
            onClick={addCustom}
            disabled={!custom.trim()}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PartsEditor({
  value,
  onChange,
  editable,
}: {
  value: { name: string; quantity?: number }[];
  onChange: (next: { name: string; quantity?: number }[]) => void;
  editable: boolean;
}) {
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");

  function add() {
    if (!name.trim()) return;
    onChange([...value, { name: name.trim(), quantity: Number(qty) || 1 }]);
    setName("");
    setQty("1");
  }

  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-1.5">
      {value.length === 0 && !editable ? <p className="text-sm text-slate-400">Sin partes reemplazadas</p> : null}
      {value.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <span className="flex-1 text-slate-700">
            {p.name}
            {p.quantity && p.quantity !== 1 ? <span className="text-slate-500"> ×{p.quantity}</span> : null}
          </span>
          {editable ? (
            <button onClick={() => remove(i)} className="rounded p-0.5 text-red-600 hover:bg-red-50">
              <X className="size-3" />
            </button>
          ) : null}
        </div>
      ))}
      {editable ? (
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
            placeholder="Nombre de la parte…"
            className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs"
          />
          <input
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            type="number"
            min="1"
            className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
          />
          <button
            onClick={add}
            disabled={!name.trim()}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PhotosEditor({
  reportId,
  itemId,
  paths,
  onChange,
  editable,
}: {
  reportId: string;
  itemId: string;
  paths: string[];
  onChange: (next: string[]) => void;
  editable: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const newPaths: string[] = [...paths];
      for (const f of files) {
        const fd = new FormData();
        fd.append("file", f);
        const r = await uploadItemPhoto(reportId, itemId, fd);
        if ("error" in r) throw new Error(r.error);
        newPaths.push(r.data.path);
      }
      onChange(newPaths);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error subiendo");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove(path: string) {
    onChange(paths.filter((p) => p !== path));
    await removeItemPhoto(reportId, itemId, path);
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {paths.map((p) => (
          <div key={p} className="group relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl(p)}
              alt="Foto"
              className="aspect-square w-full rounded-lg object-cover ring-1 ring-slate-200"
            />
            {editable ? (
              <button
                type="button"
                onClick={() => remove(p)}
                className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
        ))}
        {editable ? (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex aspect-square w-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 text-slate-500 hover:border-slate-400 disabled:opacity-50"
          >
            {uploading ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <>
                <Upload className="size-5" />
                <span className="mt-0.5 text-[10px]">Subir</span>
              </>
            )}
          </button>
        ) : null}
      </div>
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={upload} />
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

void Camera;
void Save;
void Edit3;
