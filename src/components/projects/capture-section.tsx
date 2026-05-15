"use client";

import { useEffect, useRef, useState } from "react";
import {
  Camera,
  CheckCircle2,
  Image as ImageIcon,
  Loader2,
  Mic,
  PencilLine,
  Sparkles,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { compressImage } from "@/lib/image-compress";
import {
  projectImageUrl,
  type ProjectCapture,
  type ProjectCaptureKind,
} from "@/lib/projects/types";
import { uploadToProjectsBucket } from "@/lib/projects/upload-media";

type AddTextResult = { error: string } | { ok: true };
type RegisterResult = { error: string } | { ok: true; data: { capture: ProjectCapture } };
type StructureResult = { error: string } | { ok: true; data: { added: number } };

export function ProjectCaptureSection({
  captures,
  pathPrefix,
  onRegisterUpload,
  onAddText,
  onRemove,
  onStructure,
  onAfterChange,
}: {
  captures: ProjectCapture[];
  pathPrefix: string;
  onRegisterUpload: (kind: "photo" | "video", path: string) => Promise<RegisterResult>;
  onAddText: (kind: "text" | "voice", text: string) => Promise<AddTextResult>;
  onRemove: (captureId: string) => Promise<{ error: string } | { ok: true }>;
  onStructure: () => Promise<StructureResult>;
  onAfterChange?: () => void;
}) {
  const [items, setItems] = useState<ProjectCapture[]>(captures);
  useEffect(() => setItems(captures), [captures]);

  const [uploading, setUploading] = useState(false);
  const [structuring, setStructuring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const [showVoice, setShowVoice] = useState(false);
  const [showText, setShowText] = useState(false);

  const unprocessed = items.filter((c) => !c.processed_at);
  const processed = items.filter((c) => !!c.processed_at);

  async function handleFiles(files: File[], kind: "photo" | "video") {
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const original of files) {
        const file = kind === "photo"
          ? await compressImage(original, { maxDimension: 1920, quality: 0.85 })
          : original;
        const ext = (file.name.split(".").pop() ?? (kind === "video" ? "mp4" : "jpg")).toLowerCase();
        const path = `${pathPrefix.replace(/\/$/, "")}/${crypto.randomUUID()}.${ext}`;

        // Upload directly to bucket (bypasses Vercel server action body limit)
        const up = await uploadToProjectsBucket(file, path);
        if ("error" in up) throw new Error(up.error);

        // Register the row via server action (tiny body — just the path)
        const r = await onRegisterUpload(kind, up.path);
        if ("error" in r) throw new Error(r.error);
        setItems((prev) => [...prev, r.data.capture]);
      }
      onAfterChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falló subida");
    } finally {
      setUploading(false);
    }
  }

  async function handleAddText(kind: "voice" | "text", text: string) {
    if (!text.trim()) return;
    setError(null);
    const r = await onAddText(kind, text);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    onAfterChange?.();
    setShowText(false);
    setShowVoice(false);
  }

  async function handleRemove(id: string) {
    setItems((prev) => prev.filter((c) => c.id !== id));
    const r = await onRemove(id);
    if ("error" in r) setError(r.error);
    else onAfterChange?.();
  }

  async function handleStructure() {
    setStructuring(true);
    setError(null);
    setSuccess(null);
    const r = await onStructure();
    setStructuring(false);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    setSuccess(`Listo · ${r.data.added} captura${r.data.added === 1 ? "" : "s"} estructurada${r.data.added === 1 ? "" : "s"}`);
    onAfterChange?.();
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
            <Sparkles className="size-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Capturar avance</h2>
            <p className="text-xs text-slate-500">
              Fotos · Voz · Texto · Video — la IA arma los hitos del timeline
            </p>
          </div>
        </div>
        {unprocessed.length > 0 ? (
          <button
            type="button"
            onClick={handleStructure}
            disabled={structuring}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
          >
            {structuring ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {structuring ? "Estructurando…" : `Estructurar con IA (${unprocessed.length})`}
          </button>
        ) : null}
      </header>

      <div className="p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <CaptureBtn
            icon={Camera}
            color="#3B82F6"
            label="Foto"
            onClick={() => photoRef.current?.click()}
            loading={uploading}
          />
          <CaptureBtn
            icon={Video}
            color="#8B5CF6"
            label="Video"
            onClick={() => videoRef.current?.click()}
            loading={uploading}
          />
          <CaptureBtn icon={Mic} color="#EF4444" label="Voz" onClick={() => setShowVoice(true)} />
          <CaptureBtn icon={PencilLine} color="#10B981" label="Nota" onClick={() => setShowText(true)} />
        </div>

        <input
          ref={photoRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          hidden
          onChange={(e) =>
            handleFiles(Array.from(e.target.files ?? []), "photo").finally(() => {
              if (photoRef.current) photoRef.current.value = "";
            })
          }
        />
        <input
          ref={videoRef}
          type="file"
          accept="video/*"
          capture="environment"
          hidden
          onChange={(e) =>
            handleFiles(Array.from(e.target.files ?? []), "video").finally(() => {
              if (videoRef.current) videoRef.current.value = "";
            })
          }
        />

        {error ? (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
            <CheckCircle2 className="size-4" />
            {success}
          </p>
        ) : null}

        {unprocessed.length > 0 ? (
          <div className="mt-4">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-violet-700">
              Pendientes de estructurar · {unprocessed.length}
            </p>
            <div className="space-y-2">
              {unprocessed.map((c) => (
                <CaptureRow key={c.id} capture={c} onRemove={() => handleRemove(c.id)} />
              ))}
            </div>
          </div>
        ) : null}

        {processed.length > 0 ? (
          <details className="mt-4 rounded-xl border border-slate-100 bg-slate-50/50">
            <summary className="cursor-pointer px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Ya procesadas · {processed.length}
            </summary>
            <div className="space-y-2 p-3">
              {processed.map((c) => (
                <CaptureRow key={c.id} capture={c} onRemove={() => handleRemove(c.id)} faded />
              ))}
            </div>
          </details>
        ) : null}

        {items.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            Sin capturas todavía. Sumá fotos, voz y notas — la IA va estructurando.
          </p>
        ) : null}
      </div>

      {showVoice ? (
        <VoiceCaptureModal
          onClose={() => setShowVoice(false)}
          onSave={(text) => handleAddText("voice", text)}
        />
      ) : null}
      {showText ? (
        <TextCaptureModal
          onClose={() => setShowText(false)}
          onSave={(text) => handleAddText("text", text)}
        />
      ) : null}
    </section>
  );
}

function CaptureBtn({
  icon: Icon,
  color,
  label,
  onClick,
  loading = false,
}: {
  icon: typeof Camera;
  color: string;
  label: string;
  onClick: () => void;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="group flex flex-col items-center gap-1 rounded-xl border-2 border-dashed border-slate-300 bg-white p-3 text-slate-700 transition-all hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50"
    >
      <div
        className="flex size-9 items-center justify-center rounded-full"
        style={{ backgroundColor: `${color}1f`, color }}
      >
        {loading ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
      </div>
      <span className="text-xs font-semibold">{label}</span>
    </button>
  );
}

function CaptureRow({
  capture,
  onRemove,
  faded = false,
}: {
  capture: ProjectCapture;
  onRemove: () => void;
  faded?: boolean;
}) {
  const isPhoto = capture.kind === "photo";
  const isVid = capture.kind === "video";
  const isVoice = capture.kind === "voice";
  const Icon = isPhoto ? ImageIcon : isVid ? Video : isVoice ? Mic : PencilLine;
  const color = isPhoto ? "#3B82F6" : isVid ? "#8B5CF6" : isVoice ? "#EF4444" : "#10B981";
  const label = isPhoto ? "Foto" : isVid ? "Video" : isVoice ? "Voz" : "Nota";

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-2.5",
        faded && "opacity-60",
      )}
    >
      {capture.media_path ? (
        isPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={projectImageUrl(capture.media_path)}
            alt=""
            className="size-14 shrink-0 rounded-lg object-cover ring-1 ring-slate-200"
          />
        ) : (
          <div className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-900 ring-1 ring-slate-200">
            <video src={projectImageUrl(capture.media_path)} className="size-full object-cover" muted playsInline />
            <Video className="absolute size-5 text-white drop-shadow" />
          </div>
        )
      ) : (
        <div
          className="flex size-14 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${color}1f`, color }}
        >
          <Icon className="size-6" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color }}>
            {label}
          </span>
          <span className="text-[10px] text-slate-400">
            {new Date(capture.captured_at).toLocaleString("es-PA", {
              day: "2-digit",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {capture.processed_at ? (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-700">
              <CheckCircle2 className="size-3" />
              Estructurada
            </span>
          ) : null}
        </div>
        {capture.text ? (
          <p className="mt-0.5 line-clamp-2 text-sm text-slate-700">{capture.text}</p>
        ) : capture.media_path ? (
          <p className="mt-0.5 truncate text-xs text-slate-400">{capture.media_path.split("/").pop()}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="flex size-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
        aria-label="Quitar"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

function VoiceCaptureModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (text: string) => Promise<void>;
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
        onresult:
          | ((e: { resultIndex: number; results: ArrayLike<{ isFinal?: boolean; 0: { transcript: string } }> }) => void)
          | null;
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
    recognition.interimResults = false;
    recognition.lang = "es-PA";
    recognition.onresult = (e) => {
      let finalChunk = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i] as { isFinal?: boolean; 0: { transcript: string } };
        if (result.isFinal === false) continue;
        finalChunk += result[0].transcript;
      }
      if (finalChunk) setText((prev) => (prev ? prev + " " : "") + finalChunk.trim());
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
          Tu navegador no soporta dictado de voz. Usá Chrome/Safari, o sumá una nota de texto.
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
  onSave: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  return (
    <Modal title="Nota de texto" onClose={onClose}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        autoFocus
        placeholder="Anotá qué se hizo, qué se ve, qué viene…"
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
            aria-label="Cerrar"
          >
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export type { ProjectCaptureKind };
