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
  Building2,
  ChevronDown,
  ChevronRight,
  Tag,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { parseClientFromInput, bulkCreateBatch } from "./actions";
import type { ImportedClient, ImportedBatch, ClientCategory } from "@/lib/maintenance/types";
import { CATEGORY_LABEL } from "@/lib/maintenance/types";

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

const CATEGORIES: ClientCategory[] = [
  "restaurante",
  "hotel",
  "retail",
  "oficina",
  "industrial",
  "residencial",
  "salud",
  "educacion",
  "otro",
];

const SAMPLE_SINGLE = `Cliente: Esa Flaca Rica (restaurante).
Email: contacto@esaflacarica.com — Tel: +507 6000-0000.
Sucursales:
- Food Truck en San Francisco. 6 equipos: 2 neveras TRUE (TRCB-79 y TSSU-60-16-HC), 1 nevera RCA RCSF91DA, 1 Beverage Air GF34L-B, 1 Premier, 1 Sankey. Todos a 110V.
- Salón y Baño. 3 a/c: 2 Hisense AS-36UW3SDK02 (36000 BTU, 220V), 1 GPLUS GP-S122C (12000 BTU).
Mantenimiento preventivo bimensual en todas las sucursales.`;

const SAMPLE_BATCH = `Cliente 1: La Tapa del Coco (restaurante en San Francisco)
Email: info@latapa.com
- Cocina: 2 neveras TRUE TRCB-79 (110V), 1 congelador TRUE TSSU-60 (110V)
- Salón: 2 A/C Hisense AS-36UW3SDK02 (36000 BTU, 220V)
Mantenimiento preventivo trimestral.

Cliente 2: Hotel Boutique Casco Viejo
Tel: +507 6111-1111
- Lobby: 1 A/C central Carrier 60000 BTU
- Restaurante: 3 neveras Beverage Air, 1 congelador
- Habitaciones (planta baja): 8 mini-splits Hisense de 12000 BTU
Mantenimiento mensual en habitaciones, bimestral en lobby/restaurante.

Cliente 3: Farmacia Don Bosco (retail)
- Sede principal: 4 neveras refrigeradas para medicamentos termolábiles
Mantenimiento mensual obligatorio.`;

export function ImportWizard() {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [parsed, setParsed] = useState<ImportedBatch | null>(null);
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
      const r = await bulkCreateBatch({ clients: parsed.clients });
      if ("error" in r) setError(r.error);
      else if (r.clientIds.length === 1) {
        router.push(`/maintenance/clients/${r.clientIds[0]}`);
      } else {
        router.push("/maintenance/clients");
      }
    });
  }

  if (parsed) {
    return (
      <BatchPreview
        batch={parsed}
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
        Describí cliente(s)
      </label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        placeholder={SAMPLE_SINGLE}
        className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed focus:border-slate-400 focus:outline-none"
      />
      <div className="mt-1 flex flex-wrap gap-3 text-xs">
        <button type="button" onClick={() => setText(SAMPLE_SINGLE)} className="text-blue-600 hover:underline">
          Ejemplo: 1 cliente
        </button>
        <button type="button" onClick={() => setText(SAMPLE_BATCH)} className="text-blue-600 hover:underline">
          Ejemplo: varios clientes en batch
        </button>
      </div>

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
              {f.type === "application/pdf" ? <FileText className="size-3.5" /> : <ImageIcon className="size-3.5" />}
              {f.name}
              <button onClick={() => setFiles(files.filter((_, i) => i !== idx))} className="text-slate-400 hover:text-red-600">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
        <input ref={fileRef} type="file" multiple accept="image/*,application/pdf" hidden onChange={handleFiles} />
      </div>

      {error ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

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

function BatchPreview({
  batch,
  onChange,
  onSave,
  onDiscard,
  isSaving,
  error,
}: {
  batch: ImportedBatch;
  onChange: (next: ImportedBatch) => void;
  onSave: () => void;
  onDiscard: () => void;
  isSaving: boolean;
  error: string | null;
}) {
  const totalLocations = batch.clients.reduce((s, c) => s + c.locations.length, 0);
  const totalEquipment = batch.clients.reduce(
    (s, c) => s + c.locations.reduce((s2, l) => s2 + l.equipment.length, 0),
    0,
  );

  function patchClient(idx: number, next: ImportedClient) {
    const arr = [...batch.clients];
    arr[idx] = next;
    onChange({ clients: arr });
  }

  function removeClient(idx: number) {
    onChange({ clients: batch.clients.filter((_, i) => i !== idx) });
  }

  return (
    <>
      <div className="mb-6 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
        <CheckCircle2 className="size-5 text-emerald-600" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-emerald-900">
            IA detectó {batch.clients.length} cliente{batch.clients.length === 1 ? "" : "s"}
          </p>
          <p className="text-xs text-emerald-700">
            {totalLocations} sucursal{totalLocations === 1 ? "" : "es"} · {totalEquipment} equipos
          </p>
        </div>
        <button onClick={onDiscard} className="text-xs text-slate-600 hover:underline">
          Empezar de nuevo
        </button>
      </div>

      <div className="mb-6 space-y-3">
        {batch.clients.map((c, idx) => (
          <ClientPreviewCard
            key={idx}
            client={c}
            defaultOpen={batch.clients.length === 1}
            onChange={(next) => patchClient(idx, next)}
            onRemove={() => removeClient(idx)}
          />
        ))}
      </div>

      {error ? <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      <div className="sticky bottom-4 flex gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
        <button onClick={onDiscard} disabled={isSaving} className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-700 hover:bg-slate-200">
          Cancelar
        </button>
        <button
          onClick={onSave}
          disabled={isSaving || batch.clients.length === 0}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {isSaving ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Creando {batch.clients.length} cliente{batch.clients.length === 1 ? "" : "s"}…
            </>
          ) : (
            <>
              <CheckCircle2 className="size-4" />
              Crear {batch.clients.length} cliente{batch.clients.length === 1 ? "" : "s"} con todo
            </>
          )}
        </button>
      </div>
    </>
  );
}

function ClientPreviewCard({
  client: data,
  defaultOpen,
  onChange,
  onRemove,
}: {
  client: ImportedClient;
  defaultOpen: boolean;
  onChange: (next: ImportedClient) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
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
    next[locIdx] = { ...next[locIdx], equipment: next[locIdx].equipment.filter((_, i) => i !== eqIdx) };
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
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 border-b border-border bg-slate-50/50 px-5 py-4 text-left">
        {open ? <ChevronDown className="size-4 text-slate-400" /> : <ChevronRight className="size-4 text-slate-400" />}
        <Building2 className="size-5 text-slate-500" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900">{data.client.name}</p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            {data.client.category ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-700">
                <Tag className="size-2.5" />
                {CATEGORY_LABEL[data.client.category]}
              </span>
            ) : null}
            <span>{counts.locations} sucursal{counts.locations === 1 ? "" : "es"}</span>
            <span>·</span>
            <span>{counts.equipment} equipos</span>
            {counts.schedules > 0 ? (
              <>
                <span>·</span>
                <span>{counts.schedules} schedules</span>
              </>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`¿Excluir "${data.client.name}" del batch?`)) onRemove();
          }}
          className="rounded p-1.5 text-red-600 hover:bg-red-50"
        >
          <Trash2 className="size-3.5" />
        </button>
      </button>

      {open ? (
        <div className="space-y-5 p-5">
          <Section title="Cliente" icon={Edit3}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nombre">
                <input
                  value={data.client.name}
                  onChange={(e) => patchClient({ name: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Categoría">
                <select
                  value={data.client.category ?? ""}
                  onChange={(e) => patchClient({ category: (e.target.value || null) as ClientCategory | null })}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Sin categoría</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
                  ))}
                </select>
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
            </div>
          </Section>

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
                    <button onClick={() => removeLocation(idx)} className="rounded p-1.5 text-red-600 hover:bg-red-50">
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
                          placeholder="Ubicación"
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
                        <button onClick={() => removeEquipment(idx, eqIdx)} className="rounded p-0.5 text-red-600 hover:bg-red-100">
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

          {data.schedules.length > 0 ? (
            <Section title={`Mantenimientos programados (${data.schedules.length})`} icon={Calendar}>
              <ul className="space-y-1.5">
                {data.schedules.map((s, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                    <Calendar className="size-3.5 text-blue-600" />
                    <span className="font-semibold">{s.location_name}</span>
                    <span className="text-slate-500">·</span>
                    <span>{TYPE_LABEL[s.report_type] ?? s.report_type}</span>
                    <span className="text-slate-500">·</span>
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700">{FREQ_LABEL[s.frequency] ?? s.frequency}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: typeof Edit3; children: React.ReactNode }) {
  return (
    <section>
      <header className="mb-2 flex items-center gap-2">
        <Icon className="size-4 text-slate-700" />
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-700">{title}</h3>
      </header>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

