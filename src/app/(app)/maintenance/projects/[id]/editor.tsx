"use client";

import { useState, useTransition, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Calendar as CalendarIcon,
  Camera,
  CheckCircle2,
  ChevronDown,
  Hammer,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Pencil,
  Play,
  Plus,
  Share2,
  Trash2,
  Upload,
  Video,
  X,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MILESTONE_STATUS_COLOR,
  MILESTONE_STATUS_LABEL,
  PROJECT_STATUS_COLOR,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_TINT,
  PROJECT_TYPE_COLOR,
  PROJECT_TYPE_LABEL,
  projectImageUrl,
  type ClientProject,
  type MilestoneStatus,
  type ProjectMilestone,
  type ProjectStatus,
} from "@/lib/projects/types";
import { compressImage } from "@/lib/image-compress";
import {
  addMilestone,
  deleteMilestone,
  deleteProject,
  removeMilestoneMedia,
  setCoverPhoto,
  shareProjectLink,
  updateMilestone,
  updateProject,
  uploadMilestoneMedia,
} from "../actions";

const PROJECT_STATUS_FLOW: ProjectStatus[] = [
  "planificado",
  "en_progreso",
  "pausado",
  "completado",
  "aceptado",
];

const MILESTONE_STATUSES: MilestoneStatus[] = ["pendiente", "en_progreso", "completado"];

export function ProjectEditor({
  project,
  client,
  location,
  milestones: initialMilestones,
}: {
  project: ClientProject;
  client: { id: string; name: string };
  location: { id: string; name: string } | null;
  milestones: ProjectMilestone[];
}) {
  const router = useRouter();
  const [milestones, setMilestones] = useState<ProjectMilestone[]>(initialMilestones);
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [showAddForm, setShowAddForm] = useState(false);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [coverPath, setCoverPath] = useState<string | null>(project.cover_photo_path);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [lightbox, setLightbox] = useState<{ kind: "photo" | "video"; path: string } | null>(null);

  const total = milestones.length;
  const done = milestones.filter((m) => m.status === "completado").length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  function updateLocalMilestone(id: string, patch: Partial<ProjectMilestone>) {
    setMilestones((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  function handleStatusChange(next: ProjectStatus) {
    const prev = status;
    setStatus(next);
    startTransition(async () => {
      const r = await updateProject(project.id, {
        status: next,
        started_at:
          next === "en_progreso" && !project.started_at ? new Date().toISOString() : undefined,
        completed_at: next === "completado" ? new Date().toISOString() : undefined,
      });
      if (r && "error" in r) {
        setStatus(prev);
        setError(r.error);
      } else {
        router.refresh();
      }
    });
  }

  async function handleCoverChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploadingCover(true);
    setError(null);
    try {
      const compressed = await compressImage(f, { maxDimension: 1920, quality: 0.85 });
      const fd = new FormData();
      fd.append("file", compressed);
      const r = await setCoverPhoto(project.id, fd);
      if ("error" in r) throw new Error(r.error);
      setCoverPath(r.data.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error subiendo portada");
    } finally {
      setUploadingCover(false);
      if (coverInputRef.current) coverInputRef.current.value = "";
    }
  }

  async function handleAddMilestone(input: {
    title: string;
    description: string;
    occurred_on: string;
    status: MilestoneStatus;
  }) {
    setError(null);
    const r = await addMilestone({
      project_id: project.id,
      title: input.title,
      description_es: input.description.trim() || null,
      occurred_on: input.occurred_on || null,
      status: input.status,
    });
    if ("error" in r) {
      setError(r.error);
      return;
    }
    setMilestones((prev) => [
      ...prev,
      {
        id: r.data.id,
        title: input.title,
        description_es: input.description.trim() || null,
        status: input.status,
        position: prev.length,
        occurred_on: input.occurred_on || null,
        completed_at: input.status === "completado" ? new Date().toISOString() : null,
        created_at: new Date().toISOString(),
        media: [],
      },
    ]);
    setShowAddForm(false);
    router.refresh();
  }

  async function handleShare() {
    setError(null);
    const r = await shareProjectLink(project.id);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    const fullUrl = `${window.location.origin}${r.data.url}`;
    setShareLink(fullUrl);
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(fullUrl).catch(() => {});
    }
  }

  async function handleDelete() {
    if (!confirm("¿Eliminar el proyecto y todos sus hitos? Esta acción no se puede deshacer.")) return;
    const r = await deleteProject(project.id);
    if (r && "error" in r) {
      setError(r.error);
      return;
    }
    router.push("/maintenance/projects");
  }

  return (
    <>
      <div className="px-4 py-6 md:px-10 md:py-8 max-w-5xl">
        <Link
          href="/maintenance/projects"
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="size-4" />
          Volver a proyectos
        </Link>

        {/* Hero / cover */}
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div
            className="relative aspect-[16/6] w-full bg-slate-100"
            style={{
              backgroundImage: coverPath ? `url(${projectImageUrl(coverPath)})` : undefined,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          >
            {!coverPath ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <Hammer className="size-16 text-slate-300" />
              </div>
            ) : null}
            <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6">
              <div className="mb-2 flex items-center gap-2">
                <span
                  className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
                  style={{ backgroundColor: PROJECT_TYPE_COLOR[project.project_type] }}
                >
                  {PROJECT_TYPE_LABEL[project.project_type]}
                </span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ring-inset",
                    PROJECT_STATUS_TINT[status],
                  )}
                >
                  <span
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: PROJECT_STATUS_COLOR[status] }}
                  />
                  {PROJECT_STATUS_LABEL[status]}
                </span>
              </div>
              <h1 className="text-2xl font-bold text-white drop-shadow sm:text-3xl">
                {project.name}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-white/90">
                <span className="inline-flex items-center gap-1">
                  <Building2 className="size-3.5" />
                  {client.name}
                </span>
                {location ? (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3.5" />
                    {location.name}
                  </span>
                ) : project.new_location_label ? (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3.5" />
                    {project.new_location_label} <span className="opacity-70">(sucursal nueva)</span>
                  </span>
                ) : null}
                {project.expected_completion_date ? (
                  <span className="inline-flex items-center gap-1">
                    <CalendarIcon className="size-3.5" />
                    Entrega{" "}
                    {new Date(project.expected_completion_date).toLocaleDateString("es-PA", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                ) : null}
              </div>
            </div>

            <button
              type="button"
              onClick={() => coverInputRef.current?.click()}
              disabled={uploadingCover}
              className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-900 shadow-sm hover:bg-white disabled:opacity-50"
            >
              {uploadingCover ? <Loader2 className="size-3.5 animate-spin" /> : <Camera className="size-3.5" />}
              Portada
            </button>
            <input
              ref={coverInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={handleCoverChange}
            />
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-white p-4">
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Estado
              </label>
              <div className="relative">
                <select
                  value={status}
                  onChange={(e) => handleStatusChange(e.target.value as ProjectStatus)}
                  className="appearance-none rounded-lg border border-slate-200 bg-white pl-3 pr-8 py-1.5 text-sm font-semibold text-slate-900 focus:border-slate-400 focus:outline-none"
                >
                  {PROJECT_STATUS_FLOW.map((s) => (
                    <option key={s} value={s}>
                      {PROJECT_STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              </div>
              <div className="hidden items-center gap-2 sm:flex">
                <div className="h-1.5 w-32 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${pct}%`, backgroundColor: PROJECT_STATUS_COLOR[status] }}
                  />
                </div>
                <span className="tabular-nums text-xs text-slate-500">
                  {done}/{total} hitos · {pct}%
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleShare}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Share2 className="size-3.5" />
                Compartir con cliente
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
              >
                <Trash2 className="size-3.5" />
                Eliminar
              </button>
            </div>
          </div>
        </div>

        {project.description_es ? (
          <p className="mt-4 rounded-xl border border-border bg-card p-4 text-sm leading-relaxed text-slate-700">
            {project.description_es}
          </p>
        ) : null}

        {shareLink ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
            <Share2 className="size-4 shrink-0" />
            <span className="shrink-0 font-semibold">Link copiado:</span>
            <a href={shareLink} target="_blank" rel="noreferrer" className="break-all underline">
              {shareLink}
            </a>
          </div>
        ) : null}

        {error ? (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">
            {error}
          </p>
        ) : null}

        {/* Timeline */}
        <section className="mt-8">
          <header className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">Timeline</h2>
            <button
              type="button"
              onClick={() => setShowAddForm((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800"
            >
              <Plus className="size-4" />
              Agregar hito
            </button>
          </header>

          {showAddForm ? (
            <AddMilestoneForm
              onCancel={() => setShowAddForm(false)}
              onSave={handleAddMilestone}
              pending={pending}
            />
          ) : null}

          {milestones.length === 0 && !showAddForm ? (
            <div className="rounded-2xl border border-dashed border-border bg-card py-14 text-center">
              <p className="text-sm font-semibold text-slate-900">Sin hitos todavía</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Cargá el primer hito (ej. &ldquo;Recepción de materiales&rdquo;) con foto del momento.
              </p>
            </div>
          ) : null}

          <ol className="relative mt-6 space-y-6 border-l-2 border-slate-200 pl-6">
            {milestones.map((m) => (
              <MilestoneRow
                key={m.id}
                milestone={m}
                projectId={project.id}
                onLocalUpdate={(patch) => updateLocalMilestone(m.id, patch)}
                onLocalRemove={() => setMilestones((prev) => prev.filter((x) => x.id !== m.id))}
                onPreview={(media) => setLightbox(media)}
              />
            ))}
          </ol>
        </section>
      </div>

      {lightbox ? <Lightbox media={lightbox} onClose={() => setLightbox(null)} /> : null}
    </>
  );
}

function AddMilestoneForm({
  onCancel,
  onSave,
  pending,
}: {
  onCancel: () => void;
  onSave: (input: {
    title: string;
    description: string;
    occurred_on: string;
    status: MilestoneStatus;
  }) => Promise<void>;
  pending: boolean;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [occurredOn, setOccurredOn] = useState(new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<MilestoneStatus>("en_progreso");
  const [submitting, setSubmitting] = useState(false);

  async function handle() {
    if (!title.trim()) return;
    setSubmitting(true);
    await onSave({ title: title.trim(), description, occurred_on: occurredOn, status });
    setSubmitting(false);
  }

  const busy = submitting || pending;

  return (
    <div className="mb-6 rounded-2xl border-2 border-dashed border-slate-300 bg-white p-4">
      <div className="flex items-start gap-3">
        <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700">
          <Plus className="size-4" />
        </div>
        <div className="flex-1 space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Título del hito (ej. Apertura de muro / Recepción de materiales)"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold focus:border-slate-400 focus:outline-none"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Descripción (qué se hizo, observaciones, qué viene). Opcional."
            rows={3}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-xs">
              <span className="mb-1 block font-semibold uppercase tracking-wider text-slate-500">
                Fecha
              </span>
              <input
                type="date"
                value={occurredOn}
                onChange={(e) => setOccurredOn(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-semibold uppercase tracking-wider text-slate-500">
                Estado
              </span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as MilestoneStatus)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              >
                {MILESTONE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {MILESTONE_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handle}
              disabled={!title.trim() || busy}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Guardar hito
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
            >
              Cancelar
            </button>
            <p className="ml-auto text-xs text-slate-400">
              Las fotos y videos se agregan después de crear el hito.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function MilestoneRow({
  milestone,
  projectId,
  onLocalUpdate,
  onLocalRemove,
  onPreview,
}: {
  milestone: ProjectMilestone;
  projectId: string;
  onLocalUpdate: (patch: Partial<ProjectMilestone>) => void;
  onLocalRemove: () => void;
  onPreview: (m: { kind: "photo" | "video"; path: string }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(milestone.title);
  const [description, setDescription] = useState(milestone.description_es ?? "");
  const [status, setStatus] = useState<MilestoneStatus>(milestone.status);
  const [occurredOn, setOccurredOn] = useState(milestone.occurred_on ?? "");
  const [uploading, setUploading] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [media, setMedia] = useState(milestone.media);
  const router = useRouter();

  const dotColor = MILESTONE_STATUS_COLOR[milestone.status];
  const photoCount = media.filter((x) => x.kind === "photo").length;
  const videoCount = media.filter((x) => x.kind === "video").length;

  async function uploadFiles(files: File[], kind: "photo" | "video") {
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const f of files) {
        const file = kind === "photo"
          ? await compressImage(f, { maxDimension: 1920, quality: 0.85 })
          : f;
        const fd = new FormData();
        fd.append("file", file);
        const r = await uploadMilestoneMedia(projectId, milestone.id, fd);
        if ("error" in r) throw new Error(r.error);
        setMedia((prev) => [
          ...prev,
          { id: r.data.id, kind: r.data.kind, path: r.data.path, caption_es: null, position: prev.length },
        ]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falló subida");
    } finally {
      setUploading(false);
    }
  }

  async function handleSaveEdit() {
    setError(null);
    const r = await updateMilestone(milestone.id, projectId, {
      title: title.trim() || milestone.title,
      description_es: description.trim() || null,
      status,
      occurred_on: occurredOn || null,
    });
    if (r && "error" in r) {
      setError(r.error);
      return;
    }
    onLocalUpdate({
      title: title.trim() || milestone.title,
      description_es: description.trim() || null,
      status,
      occurred_on: occurredOn || null,
    });
    setEditing(false);
    router.refresh();
  }

  async function handleDelete() {
    if (!confirm("¿Eliminar este hito y sus fotos?")) return;
    const r = await deleteMilestone(milestone.id, projectId);
    if (r && "error" in r) {
      setError(r.error);
      return;
    }
    onLocalRemove();
  }

  async function handleRemoveMedia(id: string) {
    const r = await removeMilestoneMedia(projectId, id);
    if (r && "error" in r) {
      setError(r.error);
      return;
    }
    setMedia((prev) => prev.filter((m) => m.id !== id));
  }

  return (
    <li className="relative">
      <span
        className="absolute -left-[33px] top-1 size-5 rounded-full border-4 border-white"
        style={{ backgroundColor: dotColor }}
      />
      <article className="rounded-2xl border border-border bg-card p-4 sm:p-5">
        {editing ? (
          <div className="space-y-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold focus:border-slate-400 focus:outline-none"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                type="date"
                value={occurredOn}
                onChange={(e) => setOccurredOn(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              />
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as MilestoneStatus)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              >
                {MILESTONE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {MILESTONE_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSaveEdit}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Guardar
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <>
            <header className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                    style={{ backgroundColor: `${dotColor}1f`, color: dotColor }}
                  >
                    {MILESTONE_STATUS_LABEL[milestone.status]}
                  </span>
                  {milestone.occurred_on ? (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                      <CalendarIcon className="size-3" />
                      {new Date(milestone.occurred_on).toLocaleDateString("es-PA", {
                        day: "2-digit",
                        month: "long",
                        year: "numeric",
                      })}
                    </span>
                  ) : null}
                </div>
                <h3 className="mt-1 text-base font-semibold text-slate-900 sm:text-lg">{milestone.title}</h3>
                {milestone.description_es ? (
                  <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-slate-700">
                    {milestone.description_es}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Editar"
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
                  aria-label="Eliminar"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </header>

            {/* Media grid */}
            {media.length > 0 ? (
              <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {media.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onPreview({ kind: m.kind, path: m.path })}
                    className="group relative aspect-square overflow-hidden rounded-lg ring-1 ring-slate-200 hover:ring-slate-300"
                  >
                    {m.kind === "photo" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={projectImageUrl(m.path)}
                        alt=""
                        className="size-full object-cover transition-transform group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center bg-slate-900">
                        <video
                          src={projectImageUrl(m.path)}
                          className="size-full object-cover"
                          muted
                          playsInline
                        />
                        <Play className="absolute size-8 fill-white text-white drop-shadow-md" />
                      </div>
                    )}
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveMedia(m.id);
                      }}
                      role="button"
                      aria-label="Quitar"
                      className="absolute right-1 top-1 flex size-6 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <X className="size-3.5" />
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => photoRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <ImageIcon className="size-3.5" />}
                Foto{photoCount > 0 ? ` · ${photoCount}` : ""}
              </button>
              <button
                type="button"
                onClick={() => videoRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Video className="size-3.5" />}
                Video{videoCount > 0 ? ` · ${videoCount}` : ""}
              </button>
              {milestone.status !== "completado" ? (
                <button
                  type="button"
                  onClick={async () => {
                    const r = await updateMilestone(milestone.id, projectId, { status: "completado" });
                    if (r && "error" in r) setError(r.error);
                    else {
                      onLocalUpdate({ status: "completado", completed_at: new Date().toISOString() });
                      router.refresh();
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                >
                  <CheckCircle2 className="size-3.5" />
                  Marcar completado
                </button>
              ) : null}
            </div>
            <input
              ref={photoRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              hidden
              onChange={(e) => uploadFiles(Array.from(e.target.files ?? []), "photo").finally(() => {
                if (photoRef.current) photoRef.current.value = "";
              })}
            />
            <input
              ref={videoRef}
              type="file"
              accept="video/*"
              capture="environment"
              hidden
              onChange={(e) => uploadFiles(Array.from(e.target.files ?? []), "video").finally(() => {
                if (videoRef.current) videoRef.current.value = "";
              })}
            />
          </>
        )}
        {error ? (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">
            {error}
          </p>
        ) : null}
      </article>
    </li>
  );
}

function Lightbox({
  media,
  onClose,
}: {
  media: { kind: "photo" | "video"; path: string };
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 flex size-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
        aria-label="Cerrar"
      >
        <X className="size-5" />
      </button>
      {media.kind === "photo" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={projectImageUrl(media.path)}
          alt=""
          className="max-h-[90vh] max-w-[95vw] rounded-xl object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <video
          src={projectImageUrl(media.path)}
          className="max-h-[90vh] max-w-[95vw] rounded-xl"
          controls
          autoPlay
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </div>
  );
}

void Upload;
