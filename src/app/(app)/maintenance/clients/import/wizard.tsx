"use client";

import { useState, useTransition, useRef } from "react";
import {
  Sparkles,
  Upload,
  FileText,
  Image as ImageIcon,
  X,
  Loader2,
  Plus,
  Trash2,
  MapPin,
  Box,
  Calendar,
  CheckCircle2,
  Edit3,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { parseClientFromInput, bulkCreateClient } from "./actions";
import type { ImportedClient } from "@/lib/ai/parse-client";

const FREQ_LABEL: Record<string, string> = {
  mensual: "Mensual",
  bimestral: "Bimestral",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
  custom: "Personalizada",
};

const TYPE_LABEL: Record<string, string> = {
  preventivo: "Preventivo",
  inspeccion: "Inspección",
  instalacion: "Instalación",
};

const SAMPLE = `Cliente: Esa Flaca Rica (restaurante).
Email: contacto@esaflacarica.com — Tel: +507 6000-0000.
Sucursales:
- Food Truck en San Francisco. 6 equipos: 2 neveras TRUE (TRCB-79 y TSSU-60-16-HC), 1 nevera RCA RCSF91DA, 1 Beverage Air GF34L-B, 1 Premier, 1 Sankey. Todos a 110V.
- Salón y Baño. 3 a/c: 2 Hisense AS-36UW3SDK02 (36000 BTU, 220V), 1 GPLUS GP-S122C (12000 BTU).
- Pasillo y Oficina. 1 evaporadora Hisense HEA 3003, 1 nevera FB, 1 a/c Connor MS-COI36A (36000 BTU).

Mantenimiento preventivo bimensual en todas las sucursales.`;

export function ImportWizard() {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [parsed, setParsed] = useState<ImportedClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isParsing, setParsing] = useState(false);
  const [isSaving, startSaving] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files ?? []);
    setFiles((prev) => [...prev, ...list]);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function parse() {
    if (!text.trim() && files.length === 0) {
      setError("Pegá texto o adjuntá un archivo");
      return;
    }
    setParsing(true);
    setError(null);
    const fd = new FormData();
    fd.append("text", text);
    for (const f of files) fd.append("files", f);
    const r = await parseClientFromInput(fd);
    setParsing(false);
    if ("error" in r) setError(r.error);
    else setParsed(r.data);
  }

  async function saveAll() {
    if (!parsed) return;
    setError(null);
    startSaving(async () => {
      const r = await bulkCreateClient(parsed);
      if ("error" in r) setError(r.error);
      else router.push(`/maintenance/clients/${r.clientId}`);
    });
  }

  if (parsed) {
    return (
      <PreviewEditor
        data={parsed}
        onChange={setParsed}
        onSave={saveAll}
        onDiscard={() => setParsed(null)}
        isSaving={isSaving}
        error={error}
      />
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <label className="text-xs font-semibold uppercase tracking-wider text-slate-600">
        Describí el cliente
      </label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        placeholder={SAMPLE}
        className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed focus:border-slate-400 focus:outline-none"
      />
      <button
        type="button"
        onClick={() => setText(SAMPLE)}
        className="mt-1 text-xs text-blue-600 hover:underline"
      >
        Usar ejemplo
      </button>

      <div className="mt-5">
        <label className="text-xs font-semibold uppercase tracking-wider text-slate-600">
          Adjuntar archivos (opcional)
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-sm text-slate-600 hover:border-slate-400"
          >
            <Upload className="size-4" />
            Subir PDF / fotos
          </button>
          {files.map((f, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs text-slate-700"
            >
              {f.type === "application/pdf" ? (
                <FileText className="size-3.5" />
              ) : (
                <ImageIcon className="size-3.5" />
              )}
              {f.name}
              <button
                onClick={() => setFiles(files.filter((_, i) => i !== idx))}
                className="text-slate-400 hover:text-red-600"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,application/pdf"
          hidden
          onChange={handleFiles}
        />
      </div>

      {error ? (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <button
        type="button"
        onClick={parse}
        disabled={isParsing || (!text.trim() && files.length === 0)}
        className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 py-3.5 text-base font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {isParsing ? (
          <>
            <Loader2 className="size-5 animate-spin" />
            La IA está procesando…
          </>
        ) : (
          <>
            <Sparkles className="size-5" />
            Procesar con IA
          </>
        )}
      </button>
    </div>
  );
}

function PreviewEditor({
  data,
  onChange,
  onSave,
  onDiscard,
  isSaving,
  error,
}: {
  data: ImportedClient;
  onChange: (next: ImportedClient) => void;
  onSave: () => void;
  onDiscard: () => void;
  isSaving: boolean;
  error: string | null;
}) {
  const counts = {
    locations: data.locations.length,
    equipment: data.locations.reduce((s, l) => s + l.equipment.length, 0),
    schedules: data.schedules.length,
  };

  function patchClient(patch: Partial<ImportedClient["client"]>) {
    onChange({ ...data, client: { ...data.client, ...patch } });
  }

  function updateLocation(idx: number, patch: Partial<ImportedClient["locations"][number]>) {
    const next = [...data.locations];
    next[idx] = { ...next[idx], ...patch };
    onChange({ ...data, locations: next });
  }

  function removeLocation(idx: number) {
    const removed = data.locations[idx]?.name;
    onChange({
      ...data,
      locations: data.locations.filter((_, i) => i !== idx),
      schedules: data.schedules.filter((s) => s.location_name !== removed),
    });
  }

  function addLocation() {
    onChange({
      ...data,
      locations: [...data.locations, { name: "Nueva sucursal", address: null, equipment: [] }],
    });
  }

  function updateEquipment(locIdx: number, eqIdx: number, patch: Partial<ImportedClient["locations"][number]["equipment"][number]>) {
    const next = [...data.locations];
    const eqs = [...next[locIdx].equipment];
    eqs[eqIdx] = { ...eqs[eqIdx], ...patch };
    next[locIdx] = { ...next[locIdx], equipment: eqs };
    onChange({ ...data, locations: next });
  }

  function removeEquipment(locIdx: number, eqIdx: number) {
    const next = [...data.locations];
    next[locIdx] = {
      ...next[locIdx],
      equipment: next[locIdx].equipment.filter((_, i) => i !== eqIdx),
    };
    onChange({ ...data, locations: next });
  }

  function addEquipment(locIdx: number) {
    const next = [...data.locations];
    next[locIdx] = {
      ...next[locIdx],
      equipment: [
        ...next[locIdx].equipment,
        { custom_name: "Equipo nuevo", brand: null, model: null, category: null, location_label: null, voltage: null, capacity_btu: null },
      ],
    };
    onChange({ ...data, locations: next });
  }

  return (
    <>
      <div className="mb-6 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
        <CheckCircle2 className="size-5 text-emerald-600" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-emerald-900">IA listo · revisá y guardá</p>
          <p className="text-xs text-emerald-700">
            {counts.locations} sucursal{counts.locations === 1 ? "" : "es"} · {counts.equipment} equipos · {counts.schedules} mantenimientos programados
          </p>
        </div>
        <button
          type="button"
          onClick={onDiscard}
          className="text-xs text-slate-600 hover:underline"
        >
          Empezar de nuevo
        </button>
      </div>

      {/* Cliente */}
      <Section title="Cliente" icon={Edit3}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre">
            <input
              value={data.client.name}
              onChange={(e) => patchClient({ name: e.target.value })}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Email">
            <input
              value={data.client.contact_email ?? ""}
              onChange={(e) => patchClient({ contact_email: e.target.value || null })}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Teléfono">
            <input
              value={data.client.contact_phone ?? ""}
              onChange={(e) => patchClient({ contact_phone: e.target.value || null })}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Notas">
            <input
              value={data.client.notes ?? ""}
              onChange={(e) => patchClient({ notes: e.target.value || null })}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            />
          </Field>
        </div>
      </Section>

      {/* Sucursales y equipos */}
      <Section title={`Sucursales y equipos (${counts.locations})`} icon={MapPin}>
        <div className="space-y-3">
          {data.locations.map((loc, idx) => (
            <div key={idx} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start gap-2">
                <input
                  value={loc.name}
                  onChange={(e) => updateLocation(idx, { name: e.target.value })}
                  className="flex-1 rounded border border-slate-200 px-2 py-1 text-sm font-semibold focus:border-slate-400 focus:outline-none"
                />
                <input
                  placeholder="Dirección"
                  value={loc.address ?? ""}
                  onChange={(e) => updateLocation(idx, { address: e.target.value || null })}
                  className="flex-1 rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 focus:border-slate-400 focus:outline-none"
                />
                <button
                  onClick={() => removeLocation(idx)}
                  className="rounded p-1.5 text-red-600 hover:bg-red-50"
                  title="Eliminar sucursal"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>

              <div className="mt-3 space-y-1.5">
                {loc.equipment.map((eq, eqIdx) => (
                  <div key={eqIdx} className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-50 p-2 text-xs">
                    <Box className="size-3.5 text-slate-400" />
                    <input
                      placeholder="Marca"
                      value={eq.brand ?? ""}
                      onChange={(e) => updateEquipment(idx, eqIdx, { brand: e.target.value || null })}
                      className="w-20 rounded border border-slate-200 bg-white px-1.5 py-0.5"
                    />
                    <input
                      placeholder="Modelo"
                      value={eq.model ?? ""}
                      onChange={(e) => updateEquipment(idx, eqIdx, { model: e.target.value || null })}
                      className="w-32 rounded border border-slate-200 bg-white px-1.5 py-0.5"
                    />
                    <select
                      value={eq.category ?? ""}
                      onChange={(e) => updateEquipment(idx, eqIdx, { category: (e.target.value || null) as typeof eq.category })}
                      className="rounded border border-slate-200 bg-white px-1.5 py-0.5"
                    >
                      <option value="">Cat…</option>
                      <option value="nevera">Nevera</option>
                      <option value="congelador">Congelador</option>
                      <option value="aire_acondicionado">A/C</option>
                      <option value="evaporadora">Evap</option>
                    </select>
                    <input
                      placeholder="Ubicación específica"
                      value={eq.location_label ?? ""}
                      onChange={(e) => updateEquipment(idx, eqIdx, { location_label: e.target.value || null })}
                      className="flex-1 rounded border border-slate-200 bg-white px-1.5 py-0.5"
                    />
                    <input
                      placeholder="V"
                      value={eq.voltage ?? ""}
                      onChange={(e) => updateEquipment(idx, eqIdx, { voltage: e.target.value || null })}
                      className="w-16 rounded border border-slate-200 bg-white px-1.5 py-0.5"
                    />
                    <button
                      onClick={() => removeEquipment(idx, eqIdx)}
                      className="rounded p-0.5 text-red-600 hover:bg-red-100"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => addEquipment(idx)}
                  className="inline-flex items-center gap-1 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 hover:border-slate-400"
                >
                  <Plus className="size-3" />
                  Agregar equipo
                </button>
              </div>
            </div>
          ))}
          <button
            onClick={addLocation}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-sm text-slate-600 hover:border-slate-400"
          >
            <Plus className="size-4" />
            Agregar sucursal
          </button>
        </div>
      </Section>

      {/* Schedules */}
      {data.schedules.length > 0 ? (
        <Section title={`Mantenimientos programados (${data.schedules.length})`} icon={Calendar}>
          <ul className="space-y-1.5">
            {data.schedules.map((s, i) => (
              <li
                key={i}
                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
              >
                <Calendar className="size-3.5 text-blue-600" />
                <span className="font-semibold">{s.location_name}</span>
                <span className="text-slate-500">·</span>
                <span>{TYPE_LABEL[s.report_type] ?? s.report_type}</span>
                <span className="text-slate-500">·</span>
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700">
                  {FREQ_LABEL[s.frequency] ?? s.frequency}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {error ? (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <div className="sticky bottom-4 mt-6 flex gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
        <button
          onClick={onDiscard}
          disabled={isSaving}
          className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-700 hover:bg-slate-200"
        >
          Cancelar
        </button>
        <button
          onClick={onSave}
          disabled={isSaving || !data.client.name}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {isSaving ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Creando…
            </>
          ) : (
            <>
              <CheckCircle2 className="size-4" />
              Crear cliente con todo
            </>
          )}
        </button>
      </div>
    </>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Edit3;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6 rounded-2xl border border-border bg-card">
      <header className="flex items-center gap-2 border-b border-border px-5 py-3">
        <Icon className="size-4 text-slate-700" />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700">{title}</h2>
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
