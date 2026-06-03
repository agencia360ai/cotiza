"use client";

import { useState, useTransition, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  Calendar as CalendarIcon,
  Camera,
  CheckCircle2,
  ChevronDown,
  Hammer,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Mic,
  Pencil,
  PencilLine,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Video as VideoIcon,
  X,
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
  type ProjectCapture,
  type ProjectMedia,
  type ProjectMilestone,
  type ProjectStatus,
  type ProjectSection,
  SECTION_COLOR_HEX,
  SECTION_COLOR_SOFT,
} from "@/lib/projects/types";
import { SectionTabs } from "@/components/projects/section-tabs";
import { compressImage } from "@/lib/image-compress";
import {
  addProjectCapture,
  addTechnicianMilestone,
  deleteTechnicianMilestone,
  deleteTechnicianProject,
  registerProjectCaptureMedia,
  registerTechnicianMilestoneMedia,
  registerTechnicianProjectCover,
  removeProjectCapture,
  removeTechnicianMilestoneMedia,
  proposeTechnicianProjectStructure,
  applyTechnicianProjectProposal,
  updateTechnicianMilestone,
  updateTechnicianProject,
  createTechnicianProjectSection,
  updateTechnicianProjectSection,
  deleteTechnicianProjectSection,
  reorderTechnicianProjectSections,
  moveTechnicianMilestone,
  proposeSingleTechnicianMilestone,
} from "../actions";
import { uploadToProjectsBucket } from "@/lib/projects/upload-media";
import { VoiceCaptureModal, TextCaptureModal } from "@/components/projects/capture-section";
import { MilestoneEntriesList } from "@/components/projects/milestone-entries";

const PROJECT_STATUS_FLOW: ProjectStatus[] = [
  "planificado",
  "en_progreso",
  "pausado",
  "completado",
];

const MILESTONE_STATUSES: MilestoneStatus[] = ["pendiente", "en_progreso", "completado"];

export function TechnicianProjectScreen({
  token,
  project,
  client,
  location,
  milestones: initialMilestones,
  sections,
  captures: initialCaptures,
}: {
  token: string;
  project: ClientProject;
  client: { id: string; name: string };
  location: { id: string; name: string } | null;
  milestones: ProjectMilestone[];
  sections: ProjectSection[];
  captures: ProjectCapture[];
}) {
  const router = useRouter();
  const [milestones, setMilestones] = useState<ProjectMilestone[]>(initialMilestones);
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [activeSection, setActiveSection] = useState<string | "all">(
    sections.length > 0 ? sections[0].id : "all",
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [coverPath, setCoverPath] = useState<string | null>(project.cover_photo_path);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [lightbox, setLightbox] = useState<ProjectMedia | null>(null);

  const total = milestones.length;
  const done = milestones.filter((m) => m.status === "completado").length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  function handleStatusChange(next: ProjectStatus) {
    const prev = status;
    setStatus(next);
    startTransition(async () => {
      const r = await updateTechnicianProject(token, project.id, {
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
      const ext = (compressed.name.split(".").pop() ?? "jpg").toLowerCase();
      const path = `tech/${token.slice(0, 8)}/${project.id}/cover-${crypto.randomUUID()}.${ext}`;
      const up = await uploadToProjectsBucket(compressed, path);
      if ("error" in up) throw new Error(up.error);
      const r = await registerTechnicianProjectCover(token, project.id, up.path);
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
    section_id: string | null;
    media: { path: string; kind: "photo" | "video" }[];
  }) {
    setError(null);
    const r = await addTechnicianMilestone(token, {
      project_id: project.id,
      title: input.title,
      description: input.description.trim() || null,
      occurred_on: input.occurred_on || null,
      status: input.status,
    });
    if ("error" in r) {
      setError(r.error);
      return;
    }
    if (input.section_id) {
      await moveTechnicianMilestone(token, r.data.id, project.id, input.section_id);
    }
    const attachedMedia: ProjectMedia[] = [];
    for (const m of input.media) {
      const reg = await registerTechnicianMilestoneMedia(token, project.id, r.data.id, m.kind, m.path);
      if ("error" in reg) {
        setError(reg.error);
        continue;
      }
      attachedMedia.push({
        id: reg.data.id,
        kind: reg.data.kind,
        path: reg.data.path,
        caption_es: null,
        position: attachedMedia.length,
      });
    }
    setMilestones((prev) => [
      ...prev,
      {
        id: r.data.id,
        section_id: input.section_id,
        title: input.title,
        description_es: input.description.trim() || null,
        status: input.status,
        position: prev.length,
        occurred_on: input.occurred_on || null,
        completed_at: input.status === "completado" ? new Date().toISOString() : null,
        created_at: new Date().toISOString(),
        media: attachedMedia,
        entries: [],
      },
    ]);
    setShowAddForm(false);
    router.refresh();
  }

  async function handleDelete() {
    if (!confirm("¿Eliminar el proyecto y todos sus hitos? Esta acción no se puede deshacer.")) return;
    const r = await deleteTechnicianProject(token, project.id);
    if (r && "error" in r) {
      setError(r.error);
      return;
    }
    router.push(`/t/${token}`);
  }

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur">
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
            Eliminar proyecto
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-5 pb-24 sm:px-5 sm:py-7">
        {/* Hero */}
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div
            className="relative aspect-[16/8] w-full bg-slate-100"
            style={{
              backgroundImage: coverPath ? `url(${projectImageUrl(coverPath)})` : undefined,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          >
            {!coverPath ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <Hammer className="size-14 text-slate-300" />
              </div>
            ) : null}
            <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
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
              <h1 className="text-xl font-bold text-white drop-shadow sm:text-2xl">{project.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/85">
                <span className="inline-flex items-center gap-1">
                  <Building2 className="size-3" />
                  {client.name}
                </span>
                {location ? (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3" />
                    {location.name}
                  </span>
                ) : project.new_location_label ? (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3" />
                    {project.new_location_label}
                  </span>
                ) : null}
              </div>
            </div>

            <button
              type="button"
              onClick={() => coverInputRef.current?.click()}
              disabled={uploadingCover || status === "aceptado"}
              className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-900 shadow-sm hover:bg-white disabled:opacity-50"
            >
              {uploadingCover ? <Loader2 className="size-3.5 animate-spin" /> : <Camera className="size-3.5" />}
              Portada
            </button>
            <input ref={coverInputRef} type="file" accept="image/*" hidden onChange={handleCoverChange} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-white p-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Estado
              </span>
              <div className="relative">
                <select
                  value={status}
                  onChange={(e) => handleStatusChange(e.target.value as ProjectStatus)}
                  disabled={status === "aceptado" || pending}
                  className="appearance-none rounded-lg border border-slate-200 bg-white pl-3 pr-8 py-1.5 text-sm font-semibold text-slate-900 focus:border-slate-400 focus:outline-none disabled:opacity-60"
                >
                  {PROJECT_STATUS_FLOW.map((s) => (
                    <option key={s} value={s}>
                      {PROJECT_STATUS_LABEL[s]}
                    </option>
                  ))}
                  {status === "aceptado" ? <option value="aceptado">Aceptado por cliente</option> : null}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, backgroundColor: PROJECT_STATUS_COLOR[status] }}
                />
              </div>
              <span className="tabular-nums text-xs text-slate-500">
                {done}/{total} · {pct}%
              </span>
              {status !== "aceptado" ? (
                <button
                  type="button"
                  onClick={() => setShowEdit((v) => !v)}
                  className="ml-2 inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Pencil className="size-3" />
                  Editar
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {showEdit ? (
          <TechProjectDetailsForm
            token={token}
            project={project}
            onCancel={() => setShowEdit(false)}
            onSaved={() => {
              setShowEdit(false);
              router.refresh();
            }}
          />
        ) : null}

        {!showEdit && project.description_es ? (
          <p className="mt-4 rounded-xl border border-border bg-card p-4 text-sm leading-relaxed text-slate-700">
            {project.description_es}
          </p>
        ) : null}

        {error ? (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">
            {error}
          </p>
        ) : null}

        <section className="mt-7">
          {(() => {
            const counts: Record<string, { total: number; done: number }> = {
              all: {
                total: milestones.length,
                done: milestones.filter((m) => m.status === "completado").length,
              },
            };
            for (const s of sections) {
              const items = milestones.filter((m) => m.section_id === s.id);
              counts[s.id] = {
                total: items.length,
                done: items.filter((m) => m.status === "completado").length,
              };
            }
            if (status === "aceptado" && sections.length === 0) return null;

            return (
              <div className="sticky top-0 z-20 -mx-2 bg-slate-50/95 px-2 pt-2 backdrop-blur-sm sm:-mx-4 sm:px-4">
                {status !== "aceptado" ? (
                  <SectionTabs
                    sections={sections}
                    activeId={activeSection}
                    onSelect={setActiveSection}
                    counts={counts}
                    onCreate={async ({ name, color }) => {
                      const r = await createTechnicianProjectSection(token, project.id, { name, color });
                      if (r && "ok" in r) router.refresh();
                      return r;
                    }}
                    onRename={async (id, name) => {
                      const r = await updateTechnicianProjectSection(token, project.id, id, { name });
                      if (r && "ok" in r) router.refresh();
                      return r;
                    }}
                    onRecolor={async (id, color) => {
                      const r = await updateTechnicianProjectSection(token, project.id, id, { color });
                      if (r && "ok" in r) router.refresh();
                      return r;
                    }}
                    onDelete={async (id) => {
                      const r = await deleteTechnicianProjectSection(token, project.id, id);
                      if (r && "ok" in r) {
                        if (activeSection === id) setActiveSection("all");
                        router.refresh();
                      }
                      return r;
                    }}
                    onReorder={async (ids) => {
                      const r = await reorderTechnicianProjectSections(token, project.id, ids);
                      if (r && "ok" in r) router.refresh();
                      return r;
                    }}
                  />
                ) : (
                  <SectionTabs
                    sections={sections}
                    activeId={activeSection}
                    onSelect={setActiveSection}
                    counts={counts}
                  />
                )}
              </div>
            );
          })()}

          {(() => {
            const activeName = activeSection === "all"
              ? `Historial de ${project.name}`
              : sections.find((s) => s.id === activeSection)?.name ?? project.name;
            const accent =
              activeSection === "all"
                ? "#64748B"
                : SECTION_COLOR_HEX[
                    sections.find((s) => s.id === activeSection)?.color ?? "slate"
                  ];
            return (
              <header className="mb-3 mt-5 flex items-center gap-2.5">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: accent }} />
                <h2 className="text-lg font-bold text-slate-900">{activeName}</h2>
              </header>
            );
          })()}

          {status !== "aceptado" ? (
            showAddForm ? (
              <div id="add-milestone-form">
                <AddMilestoneForm
                  onCancel={() => setShowAddForm(false)}
                  onSave={handleAddMilestone}
                  onProposeIA={async (input) =>
                    proposeSingleTechnicianMilestone(token, project.id, input)
                  }
                  pending={pending}
                  sections={sections}
                  defaultSectionId={activeSection === "all" ? null : activeSection}
                  pathPrefix={`tech/${token.slice(0, 8)}/${project.id}/captures`}
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowAddForm(true)}
                className="mb-5 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-white px-4 py-5 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50"
              >
                <Plus className="size-5" />
                Agregar Hito
              </button>
            )
          ) : null}

          {(() => {
            const renderMilestone = (m: ProjectMilestone) => (
              <MilestoneRow
                key={m.id}
                token={token}
                projectId={project.id}
                milestone={m}
                readOnly={status === "aceptado"}
                sections={sections}
                onLocalUpdate={(patch) =>
                  setMilestones((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...patch } : x)))
                }
                onLocalRemove={() => setMilestones((prev) => prev.filter((x) => x.id !== m.id))}
                onPreview={(media) => setLightbox(media)}
              />
            );

            const showGrouped = activeSection === "all" && sections.length > 0;
            const filtered = activeSection === "all"
              ? milestones
              : milestones.filter((m) => m.section_id === activeSection);

            if (filtered.length === 0 && !showAddForm) {
              return (
                <div className="rounded-2xl border border-dashed border-border bg-card py-12 text-center">
                  <Hammer className="mx-auto mb-3 size-7 text-slate-300" />
                  <p className="text-sm font-semibold text-slate-900">Sin hitos en esta pestaña</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Cargá el primer hito (ej. &ldquo;Llegada de materiales&rdquo;) con foto del momento.
                  </p>
                </div>
              );
            }

            if (!showGrouped) {
              return (
                <ol className="relative mt-5 space-y-5 border-l-2 border-slate-200 pl-6">
                  {filtered.map(renderMilestone)}
                </ol>
              );
            }

            const groups = sections
              .map((s) => ({ section: s as ProjectSection | null, items: milestones.filter((m) => m.section_id === s.id) }))
              .filter((g) => g.items.length > 0);
            const orphans = milestones.filter(
              (m) => !m.section_id || !sections.find((s) => s.id === m.section_id),
            );
            if (orphans.length > 0) groups.push({ section: null, items: orphans });

            return (
              <div className="mt-5 space-y-7">
                {groups.map((g) => {
                  const accent = g.section ? SECTION_COLOR_HEX[g.section.color] : "#94A3B8";
                  const soft = g.section ? SECTION_COLOR_SOFT[g.section.color] : "#F1F5F9";
                  const name = g.section?.name ?? "Sin categoría";
                  return (
                    <div key={g.section?.id ?? "__orphans__"}>
                      <div
                        className="mb-3 flex items-center gap-2.5 rounded-lg px-3 py-2"
                        style={{ backgroundColor: soft }}
                      >
                        <span className="size-2.5 rounded-full" style={{ backgroundColor: accent }} />
                        <span
                          className="text-xs font-bold uppercase tracking-wider"
                          style={{ color: accent }}
                        >
                          {name}
                        </span>
                        <span className="text-xs font-semibold text-slate-500">
                          {g.items.length}
                        </span>
                      </div>
                      <ol
                        className="relative space-y-5 border-l-2 pl-6"
                        style={{ borderLeftColor: `${accent}40` }}
                      >
                        {g.items.map(renderMilestone)}
                      </ol>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </section>
      </main>

      {lightbox ? <Lightbox media={lightbox} onClose={() => setLightbox(null)} /> : null}
    </>
  );
}

type PendingMedia = { localId: string; path: string; kind: "photo" | "video"; previewUrl: string };

function deriveTitleFromText(text: string, fallbackDate: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    try {
      const d = new Date(fallbackDate);
      return `Avance del ${d.toLocaleDateString("es-PA", { day: "2-digit", month: "long" })}`;
    } catch {
      return "Nuevo hito";
    }
  }
  const firstLine = trimmed.split(/\n/)[0]?.trim() ?? trimmed;
  if (firstLine.length <= 80) return firstLine;
  return firstLine.slice(0, 77).trimEnd() + "…";
}

function AddMilestoneForm({
  onCancel,
  onSave,
  onProposeIA,
  pending,
  sections,
  defaultSectionId,
  pathPrefix,
}: {
  onCancel: () => void;
  onSave: (input: {
    title: string;
    description: string;
    occurred_on: string;
    status: MilestoneStatus;
    section_id: string | null;
    media: { path: string; kind: "photo" | "video" }[];
  }) => Promise<void>;
  onProposeIA: (input: {
    mediaPaths: string[];
    text: string;
  }) => Promise<{ error: string } | { ok: true; data: { title: string; description: string; status: MilestoneStatus } }>;
  pending: boolean;
  sections: ProjectSection[];
  defaultSectionId: string | null;
  pathPrefix: string;
}) {
  const [text, setText] = useState("");
  const [aiTitle, setAiTitle] = useState<string | null>(null);
  const [occurredOn, setOccurredOn] = useState(new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<MilestoneStatus>("en_progreso");
  const [sectionId, setSectionId] = useState<string | null>(defaultSectionId);
  const [submitting, setSubmitting] = useState(false);
  const [media, setMedia] = useState<PendingMedia[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showVoice, setShowVoice] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [running, setRunning] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);

  async function uploadFiles(files: File[], kind: "photo" | "video") {
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
        const up = await uploadToProjectsBucket(file, path);
        if ("error" in up) throw new Error(up.error);
        setMedia((prev) => [
          ...prev,
          {
            localId: crypto.randomUUID(),
            path: up.path,
            kind,
            previewUrl: URL.createObjectURL(file),
          },
        ]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falló subida");
    } finally {
      setUploading(false);
    }
  }

  function appendText(extra: string) {
    if (!extra.trim()) return;
    setText((prev) => (prev ? `${prev.trimEnd()}\n\n${extra.trim()}` : extra.trim()));
  }

  const canSave = (text.trim().length > 0 || media.length > 0) && !uploading;
  const canIA = (text.trim().length > 0 || media.some((m) => m.kind === "photo")) && !running && !uploading;

  async function handleSave() {
    if (!canSave) return;
    setSubmitting(true);
    setError(null);
    const title = aiTitle?.trim() || deriveTitleFromText(text, occurredOn);
    await onSave({
      title,
      description: text,
      occurred_on: occurredOn,
      status,
      section_id: sectionId,
      media: media.map((m) => ({ path: m.path, kind: m.kind })),
    });
    setSubmitting(false);
  }

  async function handleIA() {
    if (!canIA) return;
    setRunning(true);
    setError(null);
    const r = await onProposeIA({
      mediaPaths: media.map((m) => m.path),
      text,
    });
    setRunning(false);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    setAiTitle(r.data.title);
    setText(r.data.description);
    setStatus(r.data.status);
  }

  const busy = submitting || pending;

  return (
    <div className="mb-5 rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
        <div className="flex size-8 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
          <Plus className="size-4" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-slate-900">Agregar Hito</h3>
          <p className="text-xs text-slate-500">
            Escribí lo que pasó y/o adjuntá fotos, videos, voz. Todo opcional.
          </p>
        </div>
      </header>

      <div className="space-y-4 p-4 sm:p-5">
        {aiTitle ? (
          <div className="flex items-start gap-2 rounded-lg bg-violet-50 px-3 py-2 ring-1 ring-inset ring-violet-200">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-violet-600" />
            <div className="flex-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-violet-700">
                Título sugerido por IA
              </p>
              <input
                value={aiTitle}
                onChange={(e) => setAiTitle(e.target.value)}
                className="w-full bg-transparent text-sm font-semibold text-slate-900 focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => setAiTitle(null)}
              className="text-violet-400 hover:text-violet-700"
              aria-label="Descartar título"
            >
              <X className="size-4" />
            </button>
          </div>
        ) : null}

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Qué pasó (ej. 'Llegaron los paneles y arrancamos el armado'). Podés dejarlo vacío si subís fotos o voz."
          rows={4}
          autoFocus
          className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm leading-relaxed focus:border-slate-400 focus:outline-none"
        />

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <CaptureTile
            icon={Camera}
            color="#3B82F6"
            label="Foto"
            onClick={() => photoRef.current?.click()}
            loading={uploading}
          />
          <CaptureTile
            icon={VideoIcon}
            color="#8B5CF6"
            label="Video"
            onClick={() => videoRef.current?.click()}
            loading={uploading}
          />
          <CaptureTile
            icon={Mic}
            color="#EF4444"
            label="Voz"
            onClick={() => setShowVoice(true)}
          />
          <CaptureTile
            icon={PencilLine}
            color="#10B981"
            label="Nota"
            onClick={() => setShowNote(true)}
          />
        </div>

        <input
          ref={photoRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          hidden
          onChange={(e) =>
            uploadFiles(Array.from(e.target.files ?? []), "photo").finally(() => {
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
            uploadFiles(Array.from(e.target.files ?? []), "video").finally(() => {
              if (videoRef.current) videoRef.current.value = "";
            })
          }
        />

        {media.length > 0 ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {media.map((m) => (
              <div
                key={m.localId}
                className="relative aspect-square overflow-hidden rounded-lg ring-1 ring-slate-200"
              >
                {m.kind === "photo" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.previewUrl} alt="" className="size-full object-cover" />
                ) : (
                  <div className="flex size-full items-center justify-center bg-slate-900">
                    <video src={m.previewUrl} className="size-full object-cover" muted playsInline />
                    <Play className="absolute size-7 fill-white text-white drop-shadow-md" />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setMedia((prev) => prev.filter((x) => x.localId !== m.localId))}
                  className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/75"
                  aria-label="Quitar"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-inset ring-red-600/20">
            {error}
          </p>
        ) : null}

        <div
          className={cn(
            "grid grid-cols-1 gap-3",
            sections.length > 0 ? "sm:grid-cols-3" : "sm:grid-cols-2",
          )}
        >
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
          {sections.length > 0 ? (
            <label className="block text-xs">
              <span className="mb-1 block font-semibold uppercase tracking-wider text-slate-500">
                Pestaña
              </span>
              <select
                value={sectionId ?? ""}
                onChange={(e) => setSectionId(e.target.value || null)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              >
                <option value="">Sin categoría</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave || busy}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Guardar hito
          </button>
          <button
            type="button"
            onClick={handleIA}
            disabled={!canIA}
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
            title="Que la IA proponga título y descripción desde tu texto y fotos"
          >
            {running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Estructurar con IA
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
          >
            Cancelar
          </button>
        </div>
      </div>

      {showVoice ? (
        <VoiceCaptureModal
          onClose={() => setShowVoice(false)}
          onSave={async (t) => {
            appendText(t);
            setShowVoice(false);
          }}
        />
      ) : null}
      {showNote ? (
        <TextCaptureModal
          onClose={() => setShowNote(false)}
          onSave={async (t) => {
            appendText(t);
            setShowNote(false);
          }}
        />
      ) : null}
    </div>
  );
}

function CaptureTile({
  icon: Icon,
  color,
  label,
  onClick,
  loading,
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
      className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/50 px-3 py-4 text-sm font-semibold text-slate-700 transition-all hover:border-slate-300 hover:bg-white disabled:opacity-50"
    >
      <span
        className="flex size-10 items-center justify-center rounded-full"
        style={{ backgroundColor: `${color}1f`, color }}
      >
        {loading ? <Loader2 className="size-5 animate-spin" /> : <Icon className="size-5" />}
      </span>
      {label}
    </button>
  );
}

function MilestoneRow({
  token,
  projectId,
  milestone,
  readOnly,
  sections,
  onLocalUpdate,
  onLocalRemove,
  onPreview,
}: {
  token: string;
  projectId: string;
  milestone: ProjectMilestone;
  readOnly: boolean;
  sections: ProjectSection[];
  onLocalUpdate: (patch: Partial<ProjectMilestone>) => void;
  onLocalRemove: () => void;
  onPreview: (m: ProjectMedia) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(milestone.title);
  const [description, setDescription] = useState(milestone.description_es ?? "");
  const [status, setStatus] = useState<MilestoneStatus>(milestone.status);
  const [occurredOn, setOccurredOn] = useState(milestone.occurred_on ?? "");
  const [sectionId, setSectionId] = useState<string | null>(milestone.section_id ?? null);
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
        const file =
          kind === "photo"
            ? await compressImage(f, { maxDimension: 1920, quality: 0.85 })
            : f;
        const ext = (file.name.split(".").pop() ?? (kind === "video" ? "mp4" : "jpg")).toLowerCase();
        const path = `tech/${token.slice(0, 8)}/${projectId}/${milestone.id}/${crypto.randomUUID()}.${ext}`;
        const up = await uploadToProjectsBucket(file, path);
        if ("error" in up) throw new Error(up.error);
        const r = await registerTechnicianMilestoneMedia(token, projectId, milestone.id, kind, up.path);
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
    const r = await updateTechnicianMilestone(token, milestone.id, projectId, {
      title: title.trim() || milestone.title,
      description_es: description.trim() || null,
      status,
      occurred_on: occurredOn || null,
    });
    if (r && "error" in r) {
      setError(r.error);
      return;
    }
    if (sectionId !== (milestone.section_id ?? null)) {
      const mv = await moveTechnicianMilestone(token, milestone.id, projectId, sectionId);
      if (mv && "error" in mv) {
        setError(mv.error);
        return;
      }
    }
    onLocalUpdate({
      title: title.trim() || milestone.title,
      description_es: description.trim() || null,
      status,
      occurred_on: occurredOn || null,
      section_id: sectionId,
    });
    setEditing(false);
    router.refresh();
  }

  async function handleDelete() {
    if (!confirm("¿Eliminar este hito y sus fotos?")) return;
    const r = await deleteTechnicianMilestone(token, milestone.id, projectId);
    if (r && "error" in r) {
      setError(r.error);
      return;
    }
    onLocalRemove();
  }

  async function handleRemoveMedia(id: string) {
    const r = await removeTechnicianMilestoneMedia(token, projectId, id);
    if (r && "error" in r) {
      setError(r.error);
      return;
    }
    setMedia((prev) => prev.filter((m) => m.id !== id));
  }

  return (
    <li className="relative">
      <span
        className="absolute -left-[33px] top-1 size-5 rounded-full border-4 border-slate-50"
        style={{ backgroundColor: dotColor }}
      />
      <article className="rounded-2xl border border-border bg-card p-4">
        {editing && !readOnly ? (
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
            <div
              className={cn(
                "grid grid-cols-1 gap-3",
                sections.length > 0 ? "sm:grid-cols-3" : "sm:grid-cols-2",
              )}
            >
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
              {sections.length > 0 ? (
                <select
                  value={sectionId ?? ""}
                  onChange={(e) => setSectionId(e.target.value || null)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
                  title="Pestaña"
                >
                  <option value="">Sin categoría</option>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              ) : null}
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
                <h3 className="mt-1 text-base font-semibold text-slate-900">{milestone.title}</h3>
                {milestone.description_es ? (
                  <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-slate-700">
                    {milestone.description_es}
                  </p>
                ) : null}
              </div>
              {!readOnly ? (
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
              ) : null}
            </header>

            {milestone.entries.length > 0 ? (
              <MilestoneEntriesList
                entries={milestone.entries}
                onPreview={(m) => onPreview(m)}
              />
            ) : null}

            {media.length > 0 ? (
              <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {media.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onPreview(m)}
                    className="group relative aspect-square overflow-hidden rounded-lg ring-1 ring-slate-200 hover:ring-slate-300"
                  >
                    {m.kind === "photo" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={projectImageUrl(m.path)}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover transition-transform group-hover:scale-105"
                      />
                    ) : (
                      <div className="relative size-full bg-slate-900">
                        <video
                          src={projectImageUrl(m.path)}
                          className="size-full object-cover"
                          muted
                          playsInline
                          preload="metadata"
                        />
                        <span className="absolute inset-0 flex items-center justify-center bg-black/30">
                          <Play className="size-8 fill-white text-white drop-shadow-md" />
                        </span>
                      </div>
                    )}
                    {!readOnly ? (
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
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}

            {!readOnly ? (
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
                  {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <VideoIcon className="size-3.5" />}
                  Video{videoCount > 0 ? ` · ${videoCount}` : ""}
                </button>
                {milestone.status !== "completado" ? (
                  <button
                    type="button"
                    onClick={async () => {
                      const r = await updateTechnicianMilestone(token, milestone.id, projectId, {
                        status: "completado",
                      });
                      if (r && "error" in r) setError(r.error);
                      else {
                        onLocalUpdate({
                          status: "completado",
                          completed_at: new Date().toISOString(),
                        });
                        router.refresh();
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                  >
                    <CheckCircle2 className="size-3.5" />
                    Completar
                  </button>
                ) : null}
              </div>
            ) : null}
            <input
              ref={photoRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              hidden
              onChange={(e) =>
                uploadFiles(Array.from(e.target.files ?? []), "photo").finally(() => {
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
                uploadFiles(Array.from(e.target.files ?? []), "video").finally(() => {
                  if (videoRef.current) videoRef.current.value = "";
                })
              }
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

function Lightbox({ media, onClose }: { media: ProjectMedia; onClose: () => void }) {
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

function TechProjectDetailsForm({
  token,
  project,
  onCancel,
  onSaved,
}: {
  token: string;
  project: ClientProject;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(project.name);
  const [projectType, setProjectType] = useState(project.project_type);
  const [description, setDescription] = useState(project.description_es ?? "");
  const [startDate, setStartDate] = useState(project.expected_start_date ?? "");
  const [completionDate, setCompletionDate] = useState(project.expected_completion_date ?? "");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function handleSave() {
    if (!name.trim()) {
      setErr("El nombre no puede quedar vacío");
      return;
    }
    setErr(null);
    startTransition(async () => {
      const r = await updateTechnicianProject(token, project.id, {
        name: name.trim(),
        project_type: projectType,
        description_es: description.trim() || null,
        expected_start_date: startDate || null,
        expected_completion_date: completionDate || null,
      });
      if (r && "error" in r) {
        setErr(r.error);
        return;
      }
      onSaved();
    });
  }

  return (
    <div className="mt-4 rounded-2xl border border-slate-300 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-bold text-slate-900">Editar detalles del proyecto</h3>
      <div className="space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre del proyecto"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold focus:border-slate-400 focus:outline-none"
        />
        <select
          value={projectType}
          onChange={(e) => setProjectType(e.target.value as typeof projectType)}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
        >
          {(["instalacion", "obra", "remodelacion", "otro"] as const).map((t) => (
            <option key={t} value={t}>
              {PROJECT_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Descripción del proyecto"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-xs">
            <span className="mb-1 block font-semibold uppercase tracking-wider text-slate-500">
              Inicio estimado
            </span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
            />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block font-semibold uppercase tracking-wider text-slate-500">
              Entrega estimada
            </span>
            <input
              type="date"
              value={completionDate}
              onChange={(e) => setCompletionDate(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
            />
          </label>
        </div>
      </div>
      {err ? (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">
          {err}
        </p>
      ) : null}
      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          Guardar cambios
        </button>
      </div>
    </div>
  );
}
