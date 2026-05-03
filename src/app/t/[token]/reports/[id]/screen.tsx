"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Camera,
  Mic,
  PencilLine,
  Plus,
  Trash2,
  Sparkles,
  Send,
  X,
  CheckCircle2,
  AlertTriangle,
  XOctagon,
  PowerOff,
  Loader2,
  Image as ImageIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  REPORT_TYPE_COLOR,
  REPORT_TYPE_LABEL_SHORT,
  STATUS_COLOR,
  imageUrl,
  type CaptureItem,
  type EquipmentStatus,
  type ReportItem,
  type TechnicianReportData,
} from "@/lib/maintenance/types";
import {
  addTextOrVoiceCapture,
  generateWithAI,
  removeCapture,
  submitReport,
  updateReportItems,
  uploadCapture,
  deleteReport,
} from "../../actions";
import { useRouter } from "next/navigation";

const STATUS_BUTTONS: { value: EquipmentStatus; label: string; icon: typeof CheckCircle2 }[] = [
  { value: "operativo", label: "Operativo", icon: CheckCircle2 },
  { value: "atencion", label: "Atención", icon: AlertTriangle },
  { value: "critico", label: "Crítico", icon: XOctagon },
  { value: "fuera_de_servicio", label: "Fuera de servicio", icon: PowerOff },
];

export function ReportScreen({
  token,
  initialData,
}: {
  token: string;
  initialData: TechnicianReportData;
}) {
  const router = useRouter();
  const { client, location, report } = initialData;
  const [captures, setCaptures] = useState<CaptureItem[]>(report.capture_data);
  const [items, setItems] = useState<ReportItem[]>(initialData.items);
  const [aiDraftAt, setAiDraftAt] = useState<string | null>(report.ai_draft_at);
  const [summary, setSummary] = useState(report.summary_es ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setUploading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [showTextModal, setShowTextModal] = useState(false);

  const accent = REPORT_TYPE_COLOR[report.report_type];

  async function refresh() {
    router.refresh();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
        const r = await uploadCapture(token, report.id, fd);
        if ("error" in r) throw new Error(r.error);
        setCaptures((prev) => [...prev, r.data.capture]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error subiendo foto");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleAddText(kind: "voice" | "text", text: string) {
    if (!text.trim()) return;
    setError(null);
    const r = await addTextOrVoiceCapture(token, report.id, { kind, text });
    if ("error" in r) {
      setError(r.error);
      return;
    }
    await refresh();
    setShowTextModal(false);
    setShowVoiceModal(false);
  }

  async function handleRemove(captureId: string) {
    setError(null);
    setCaptures((prev) => prev.filter((c) => c.id !== captureId));
    const r = await removeCapture(token, report.id, captureId);
    if ("error" in r) setError(r.error);
  }

  function handleGenerate() {
    setError(null);
    startTransition(async () => {
      const r = await generateWithAI(token, report.id);
      if (r && "error" in r) {
        setError(r.error);
        return;
      }
      setAiDraftAt(new Date().toISOString());
      router.refresh();
    });
  }

  function handleSubmit() {
    if (items.length === 0) {
      setError("Generá el reporte con IA primero");
      return;
    }
    setError(null);
    startTransition(async () => {
      // Save current edits
      const itemsPayload = items.map((it) => ({
        equipment_id: it.equipment_id,
        equipment_status: it.equipment_status,
        observations_es: it.observations_es,
        recommendations: it.recommendations,
        parts_replaced: it.parts_replaced,
        checklist_items: it.checklist_items,
        photo_paths: it.photo_paths,
      }));
      const saveResult = await updateReportItems(token, report.id, itemsPayload, summary);
      if ("error" in saveResult) {
        setError(saveResult.error);
        return;
      }
      const submitResult = await submitReport(token, report.id, summary);
      if ("error" in submitResult) {
        setError(submitResult.error);
        return;
      }
      router.push(`/t/${token}`);
    });
  }

  async function handleDelete() {
    if (!confirm("¿Eliminar este borrador? No se puede deshacer.")) return;
    const r = await deleteReport(token, report.id);
    if (r && "error" in r) {
      setError(r.error);
      return;
    }
    router.push(`/t/${token}`);
  }

  return (
    <>
      {/* Sticky header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-3">
          <Link
            href={`/t/${token}`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="size-4" />
            Portal
          </Link>
          <button
            type="button"
            onClick={handleDelete}
            className="text-xs text-slate-400 hover:text-red-600"
          >
            Eliminar borrador
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 pb-32 pt-4">
        {/* Context card */}
        <div
          className="mb-6 overflow-hidden rounded-2xl border bg-white p-5"
          style={{ borderColor: `${accent}40` }}
        >
          <div className="flex items-center gap-2">
            <span
              className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white"
              style={{ backgroundColor: accent }}
            >
              {REPORT_TYPE_LABEL_SHORT[report.report_type]}
            </span>
            <span className="text-xs text-slate-500">{report.report_number}</span>
          </div>
          <h1 className="mt-2 text-xl font-bold text-slate-900">{client.name}</h1>
          <p className="text-sm text-slate-500">📍 {location.name}</p>
          {report.trigger_event_es ? (
            <div className="mt-3 rounded-lg bg-orange-50 px-3 py-2 text-xs text-orange-900 ring-1 ring-inset ring-orange-200">
              <strong>Evento: </strong>
              {report.trigger_event_es}
            </div>
          ) : null}
        </div>

        {/* Equipment list (context) */}
        <section className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-600">
            Equipos en esta sucursal ({location.equipment.length})
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {location.equipment.map((e) => (
              <span
                key={e.id}
                className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700"
              >
                <span className="font-semibold">{e.brand ?? ""}</span>
                {e.model && e.model !== "S/A" ? ` ${e.model}` : ""}
              </span>
            ))}
          </div>
        </section>

        {/* SECTION 1: Capture */}
        <section>
          <header className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">1. Captura</h2>
            <span className="text-xs text-slate-500">{captures.length} item(s)</span>
          </header>

          <div className="grid grid-cols-3 gap-2">
            <CaptureButton
              label="Foto"
              icon={Camera}
              color="#3B82F6"
              onClick={() => fileInputRef.current?.click()}
              loading={isUploading}
            />
            <CaptureButton
              label="Voz"
              icon={Mic}
              color="#EF4444"
              onClick={() => setShowVoiceModal(true)}
            />
            <CaptureButton
              label="Texto"
              icon={PencilLine}
              color="#10B981"
              onClick={() => setShowTextModal(true)}
            />
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            hidden
            onChange={handleFileChange}
          />

          {captures.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white py-8 text-center text-sm text-slate-500">
              Capturá fotos, dictá notas de voz o escribí lo que veas.<br />
              La IA las ordena por equipo automáticamente.
            </p>
          ) : (
            <div className="mt-4 space-y-2">
              {captures.map((c) => (
                <CaptureCard key={c.id} capture={c} onRemove={() => handleRemove(c.id)} />
              ))}
            </div>
          )}

          {captures.length > 0 ? (
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isPending}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 py-3.5 text-sm font-semibold text-white shadow-sm transition-all hover:opacity-90 disabled:opacity-50"
            >
              {isPending ? (
                <>
                  <Loader2 className="size-5 animate-spin" />
                  Generando con IA...
                </>
              ) : (
                <>
                  <Sparkles className="size-5" />
                  {aiDraftAt ? "Re-generar con IA" : "Generar reporte con IA"}
                </>
              )}
            </button>
          ) : null}
        </section>

        {/* SECTION 2: Review (after AI) */}
        {items.length > 0 ? (
          <section className="mt-10">
            <header className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">2. Reporte generado</h2>
              {aiDraftAt ? (
                <span className="inline-flex items-center gap-1 text-xs text-violet-700">
                  <Sparkles className="size-3" />
                  IA · {new Date(aiDraftAt).toLocaleTimeString("es-PA", { hour: "2-digit", minute: "2-digit" })}
                </span>
              ) : null}
            </header>

            <div className="mb-4">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                Resumen general
              </label>
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed focus:border-slate-400 focus:outline-none"
              />
            </div>

            <div className="space-y-2">
              {items.map((it, idx) => (
                <ItemEditor
                  key={it.id}
                  item={it}
                  equipment={location.equipment.find((e) => e.id === it.equipment_id)}
                  onChange={(patch) => {
                    setItems((prev) => {
                      const next = [...prev];
                      next[idx] = { ...next[idx], ...patch };
                      return next;
                    });
                  }}
                />
              ))}
            </div>
          </section>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">
            {error}
          </p>
        ) : null}
      </main>

      {/* Sticky submit bar */}
      {items.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white px-5 py-3">
          <div className="mx-auto flex max-w-3xl gap-2">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isPending}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 py-3.5 text-sm font-semibold text-white transition-all hover:bg-slate-800 disabled:opacity-50"
            >
              {isPending ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <>
                  <Send className="size-4" />
                  Enviar reporte para revisión
                </>
              )}
            </button>
          </div>
        </div>
      ) : null}

      {showVoiceModal ? (
        <VoiceCaptureModal
          onClose={() => setShowVoiceModal(false)}
          onSave={(text) => handleAddText("voice", text)}
        />
      ) : null}
      {showTextModal ? (
        <TextCaptureModal
          onClose={() => setShowTextModal(false)}
          onSave={(text) => handleAddText("text", text)}
        />
      ) : null}
    </>
  );
}

function CaptureButton({
  label,
  icon: Icon,
  color,
  onClick,
  loading = false,
}: {
  label: string;
  icon: typeof Camera;
  color: string;
  onClick: () => void;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="group flex flex-col items-center gap-1 rounded-xl border-2 border-dashed border-slate-300 bg-white p-4 text-slate-700 transition-all hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50"
    >
      <div
        className="flex size-10 items-center justify-center rounded-full transition-transform group-hover:scale-110"
        style={{ backgroundColor: `${color}20`, color }}
      >
        {loading ? <Loader2 className="size-5 animate-spin" /> : <Icon className="size-5" />}
      </div>
      <span className="text-sm font-semibold">{label}</span>
    </button>
  );
}

function CaptureCard({ capture, onRemove }: { capture: CaptureItem; onRemove: () => void }) {
  const isPhoto = capture.kind === "photo";
  const isVoice = capture.kind === "voice";
  const Icon = isPhoto ? Camera : isVoice ? Mic : PencilLine;
  const color = isPhoto ? "#3B82F6" : isVoice ? "#EF4444" : "#10B981";
  const label = isPhoto ? "Foto" : isVoice ? "Voz" : "Texto";

  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3">
      {isPhoto && capture.photo_path ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl(capture.photo_path)}
          alt="Captura"
          className="size-16 shrink-0 rounded-lg object-cover ring-1 ring-slate-200"
        />
      ) : (
        <div
          className="flex size-16 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${color}20`, color }}
        >
          <Icon className="size-6" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color }}>
          {label}
        </p>
        {capture.text ? (
          <p className="mt-0.5 line-clamp-3 text-sm text-slate-700">{capture.text}</p>
        ) : (
          <p className="mt-0.5 text-xs text-slate-400">{capture.photo_path?.split("/").pop()}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}

function ItemEditor({
  item,
  equipment,
  onChange,
}: {
  item: ReportItem;
  equipment: { brand: string | null; model: string | null; custom_name: string; location_label: string | null } | undefined;
  onChange: (patch: Partial<ReportItem>) => void;
}) {
  const [open, setOpen] = useState(false);
  const statusColor = STATUS_COLOR[item.equipment_status];

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 p-4 text-left"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="size-3 shrink-0 rounded-full"
            style={{ backgroundColor: statusColor }}
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">
              {equipment?.brand ?? ""} {equipment?.model ?? ""}
            </p>
            <p className="truncate text-xs text-slate-500">{equipment?.location_label ?? equipment?.custom_name}</p>
          </div>
        </div>
        <span className="text-xs text-slate-400">{open ? "−" : "+"}</span>
      </button>

      {open ? (
        <div className="border-t border-slate-100 p-4">
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

          <div className="mt-3">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Observaciones
            </label>
            <textarea
              value={item.observations_es ?? ""}
              onChange={(e) => onChange({ observations_es: e.target.value })}
              rows={2}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
            />
          </div>

          {item.recommendations.length > 0 ? (
            <div className="mt-3">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Recomendaciones
              </label>
              <ul className="mt-1 space-y-1">
                {item.recommendations.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <span className="font-bold uppercase text-slate-500">{r.priority}</span>
                    <span className="flex-1 text-slate-700">{r.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {item.checklist_items.length > 0 ? (
            <div className="mt-3">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Elementos revisados
              </label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {item.checklist_items.map((c, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                    ✓ {c}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {item.photo_paths.length > 0 ? (
            <div className="mt-3">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Fotos asociadas
              </label>
              <div className="mt-1 grid grid-cols-4 gap-1.5">
                {item.photo_paths.map((p, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={imageUrl(p)}
                    alt={`foto ${i + 1}`}
                    className="aspect-square w-full rounded object-cover ring-1 ring-slate-200"
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function VoiceCaptureModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const recRef = useRef<unknown>(null);

  useEffect(() => {
    type SR = {
      new (): {
        continuous: boolean;
        interimResults: boolean;
        lang: string;
        onresult: ((e: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
        onend: (() => void) | null;
        onerror: ((e: unknown) => void) | null;
        start: () => void;
        stop: () => void;
      };
    };
    const win = window as unknown as { SpeechRecognition?: SR; webkitSpeechRecognition?: SR };
    const SR = win.SpeechRecognition ?? win.webkitSpeechRecognition;
    if (!SR) {
      setSupported(false);
      return;
    }
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "es-PA";
    recognition.onresult = (e) => {
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        final += e.results[i][0].transcript;
      }
      setText((prev) => prev + final);
    };
    recognition.onend = () => setListening(false);
    recRef.current = recognition;
  }, []);

  function toggle() {
    if (!recRef.current) return;
    const rec = recRef.current as { start: () => void; stop: () => void };
    if (listening) rec.stop();
    else {
      rec.start();
      setListening(true);
    }
  }

  return (
    <Modal title="Nota de voz" onClose={onClose}>
      {!supported ? (
        <p className="text-sm text-slate-600">
          Tu navegador no soporta dictado de voz. Usá la opción de texto, o probá Chrome/Safari.
        </p>
      ) : (
        <>
          <button
            type="button"
            onClick={toggle}
            className={cn(
              "mx-auto flex size-24 items-center justify-center rounded-full text-white transition-all",
              listening
                ? "bg-red-500 ring-8 ring-red-500/20 [animation:_pulse_1.5s_infinite]"
                : "bg-slate-900 hover:bg-slate-800",
            )}
          >
            <Mic className="size-10" />
          </button>
          <p className="mt-3 text-center text-sm text-slate-500">
            {listening ? "Escuchando…" : "Tocá para empezar a dictar"}
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder="La transcripción aparecerá acá. Editá si hace falta."
            className="mt-4 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => onSave(text)}
            disabled={!text.trim()}
            className="mt-4 w-full rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            Guardar nota de voz
          </button>
        </>
      )}
    </Modal>
  );
}

function TextCaptureModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (text: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <Modal title="Nota de texto" onClose={onClose}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        autoFocus
        placeholder="Anotá lo que viste o querés transmitir al cliente…"
        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
      />
      <button
        type="button"
        onClick={() => onSave(text)}
        disabled={!text.trim()}
        className="mt-4 w-full rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white disabled:opacity-50"
      >
        Guardar nota
      </button>
    </Modal>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
          >
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

void ImageIcon;
void Plus;
