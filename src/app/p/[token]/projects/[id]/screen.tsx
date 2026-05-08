"use client";

import { useState, useRef, useEffect } from "react";
import {
  Building2,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronRight,
  Hammer,
  MapPin,
  Play,
  Share2,
  Sparkles,
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
  type ProjectMedia,
  type ProjectMilestone,
  type PublicProjectData,
} from "@/lib/projects/types";
import { acceptProject } from "./actions";

export function PublicProjectScreen({
  token,
  data,
}: {
  token: string;
  data: PublicProjectData;
}) {
  const [acceptance, setAcceptance] = useState(data.acceptance);
  const [showAcceptForm, setShowAcceptForm] = useState(false);
  const [lightbox, setLightbox] = useState<ProjectMedia | null>(null);
  const project = data.project;
  const total = data.milestones.length;
  const done = data.milestones.filter((m) => m.status === "completado").length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const accent = project.status === "aceptado" ? "#10B981" : PROJECT_TYPE_COLOR[project.project_type];
  const isAccepted = project.status === "aceptado" || !!acceptance;
  const canAccept = (project.status === "completado" || isAccepted) && !isAccepted;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Hero */}
      <header
        className="relative overflow-hidden text-white"
        style={{
          background: project.cover_photo_path
            ? `linear-gradient(180deg, rgba(15,23,42,0.20) 0%, rgba(15,23,42,0.85) 100%), url(${projectImageUrl(project.cover_photo_path)}) center/cover`
            : `linear-gradient(135deg, ${accent} 0%, #0F172A 100%)`,
        }}
      >
        <div className="mx-auto max-w-4xl px-5 pt-10 pb-12 sm:px-8 sm:pt-14 sm:pb-16">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-white/80">
              {data.service_provider.logo_path ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={projectImageUrl(data.service_provider.logo_path)}
                  alt={data.service_provider.name}
                  className="size-6 rounded bg-white object-contain p-0.5"
                />
              ) : (
                <Sparkles className="size-4" />
              )}
              {data.service_provider.name}
            </div>
            <span className="rounded-full bg-white/15 px-2.5 py-0.5 font-semibold uppercase tracking-wider text-white/90">
              Proyecto
            </span>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-2">
            <span
              className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
              style={{ backgroundColor: PROJECT_TYPE_COLOR[project.project_type] }}
            >
              {PROJECT_TYPE_LABEL[project.project_type]}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ring-inset ring-white/30",
              )}
              style={{ backgroundColor: `${PROJECT_STATUS_COLOR[project.status]}30`, color: "white" }}
            >
              <span
                className="size-1.5 rounded-full"
                style={{ backgroundColor: PROJECT_STATUS_COLOR[project.status] }}
              />
              {PROJECT_STATUS_LABEL[project.status]}
            </span>
          </div>

          <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
            {project.name}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-white/85">
            <span className="inline-flex items-center gap-1.5">
              <Building2 className="size-4" />
              {data.client.name}
            </span>
            {data.location ? (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-4" />
                {data.location.name}
              </span>
            ) : project.new_location_label ? (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-4" />
                {project.new_location_label}
              </span>
            ) : null}
            {project.expected_completion_date ? (
              <span className="inline-flex items-center gap-1.5">
                <CalendarIcon className="size-4" />
                Entrega prevista{" "}
                {new Date(project.expected_completion_date).toLocaleDateString("es-PA", {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}
              </span>
            ) : null}
          </div>

          {/* Progress strip */}
          <div className="mt-6 max-w-xl rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-sm">
            <div className="flex items-center justify-between text-xs uppercase tracking-wider text-white/80">
              <span>Avance</span>
              <span className="tabular-nums">
                {done}/{total} hitos · {pct}%
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{
                  width: `${pct}%`,
                  background: "linear-gradient(90deg, #2563EB 0%, #F97316 100%)",
                }}
              />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
        {project.description_es ? (
          <p className="mb-8 rounded-2xl border border-border bg-white p-5 text-sm leading-relaxed text-slate-700 sm:text-base">
            {project.description_es}
          </p>
        ) : null}

        {isAccepted ? (
          <div className="mb-8 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
              <CheckCircle2 className="size-5" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-emerald-900">Proyecto aceptado</p>
              <p className="mt-0.5 text-xs text-emerald-800/85">
                Firmado por {acceptance?.signed_by_name ?? "—"}
                {acceptance?.signed_at
                  ? ` · ${new Date(acceptance.signed_at).toLocaleDateString("es-PA", { day: "2-digit", month: "long", year: "numeric" })}`
                  : ""}
              </p>
            </div>
          </div>
        ) : null}

        <section>
          <header className="mb-6 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Línea de tiempo
            </h2>
            <ShareButton />
          </header>

          {data.milestones.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-14 text-center">
              <Hammer className="mx-auto mb-3 size-8 text-slate-300" />
              <p className="text-sm font-semibold text-slate-900">Aún sin hitos cargados</p>
              <p className="mt-1 text-sm text-slate-500">
                Cuando arranque la obra vas a ver acá el progreso paso a paso.
              </p>
            </div>
          ) : (
            <ol className="relative space-y-7 border-l-2 border-slate-200 pl-7 sm:pl-10">
              {data.milestones.map((m, i) => (
                <PublicMilestone
                  key={m.id}
                  milestone={m}
                  index={i + 1}
                  onPreview={(media) => setLightbox(media)}
                />
              ))}
            </ol>
          )}
        </section>

        {canAccept ? (
          <section className="mt-12 rounded-2xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-6 text-center sm:p-8">
            <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-emerald-600 text-white">
              <CheckCircle2 className="size-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 sm:text-xl">El proyecto está listo</h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
              Si todo está conforme, dejá tu firma y aceptación para cerrar el proyecto.
            </p>
            <button
              type="button"
              onClick={() => setShowAcceptForm(true)}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
            >
              Aceptar proyecto
              <ChevronRight className="size-4" />
            </button>
          </section>
        ) : null}

        <footer className="mt-12 border-t border-border pt-6 text-center text-xs text-slate-400">
          Reportes y tracking por <strong className="text-slate-600">{data.service_provider.name}</strong>
        </footer>
      </main>

      {lightbox ? <Lightbox media={lightbox} onClose={() => setLightbox(null)} /> : null}
      {showAcceptForm ? (
        <AcceptForm
          token={token}
          projectId={project.id}
          clientName={data.client.name}
          onClose={() => setShowAcceptForm(false)}
          onAccepted={(a) => {
            setAcceptance(a);
            setShowAcceptForm(false);
          }}
        />
      ) : null}
    </div>
  );
}

function PublicMilestone({
  milestone,
  index,
  onPreview,
}: {
  milestone: ProjectMilestone;
  index: number;
  onPreview: (m: ProjectMedia) => void;
}) {
  const dotColor = MILESTONE_STATUS_COLOR[milestone.status];
  return (
    <li className="relative">
      <span
        className="absolute -left-[34px] top-1.5 flex size-7 items-center justify-center rounded-full border-4 border-slate-50 text-[10px] font-bold text-white shadow-sm sm:-left-[44px] sm:size-8 sm:text-xs"
        style={{ backgroundColor: dotColor }}
      >
        {milestone.status === "completado" ? <CheckCircle2 className="size-4" /> : index}
      </span>
      <article className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        <header className="px-4 py-4 sm:px-6 sm:py-5">
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
          <h3 className="mt-2 text-lg font-bold text-slate-900 sm:text-xl">{milestone.title}</h3>
          {milestone.description_es ? (
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700 sm:text-base">
              {milestone.description_es}
            </p>
          ) : null}
        </header>

        {milestone.entries.length > 0 ? (
          <div className="border-t border-slate-100 px-4 py-4 sm:px-6 sm:py-5">
            <ol className="space-y-4 border-l-2 border-slate-200 pl-5 sm:pl-6">
              {milestone.entries.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[27px] top-1.5 size-4 rounded-full border-[3px] border-white bg-slate-300 sm:-left-[33px] sm:size-5" />
                  {e.occurred_on ? (
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      {new Date(e.occurred_on).toLocaleDateString("es-PA", {
                        day: "2-digit",
                        month: "long",
                        year: "numeric",
                      })}
                    </p>
                  ) : null}
                  {e.text_es ? (
                    <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-800 sm:text-base">
                      {e.text_es}
                    </p>
                  ) : null}
                  {e.media.length > 0 ? (
                    <div className="mt-3 grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                      {e.media.map((mm) => (
                        <button
                          key={mm.id}
                          type="button"
                          onClick={() => onPreview(mm)}
                          className="group relative aspect-square overflow-hidden rounded-lg ring-1 ring-slate-200"
                        >
                          {mm.kind === "photo" ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={projectImageUrl(mm.path)}
                              alt={mm.caption_es ?? milestone.title}
                              loading="lazy"
                              className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                            />
                          ) : (
                            <>
                              <video
                                src={projectImageUrl(mm.path)}
                                className="size-full object-cover"
                                muted
                                playsInline
                                preload="metadata"
                              />
                              <span className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors group-hover:bg-black/15">
                                <Play className="size-7 fill-white text-white drop-shadow-md" />
                              </span>
                            </>
                          )}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        {milestone.media.length > 0 ? (
          <div className="border-t border-slate-100">
            <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-3 md:grid-cols-4">
              {milestone.media.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onPreview(m)}
                  className="group relative aspect-square overflow-hidden bg-white"
                >
                  {m.kind === "photo" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={projectImageUrl(m.path)}
                      alt={m.caption_es ?? milestone.title}
                      loading="lazy"
                      className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <>
                      <video
                        src={projectImageUrl(m.path)}
                        className="size-full object-cover"
                        muted
                        playsInline
                        preload="metadata"
                      />
                      <span className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors group-hover:bg-black/15">
                        <Play className="size-9 fill-white text-white drop-shadow-md" />
                      </span>
                    </>
                  )}
                </button>
              ))}
            </div>
          </div>
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
          alt={media.caption_es ?? ""}
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

function ShareButton() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          if (typeof navigator !== "undefined" && navigator.share) {
            await navigator.share({ url: window.location.href, title: document.title });
            return;
          }
          if (typeof navigator !== "undefined" && navigator.clipboard) {
            await navigator.clipboard.writeText(window.location.href);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          }
        } catch {
          // user cancelled — ignore
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
    >
      <Share2 className="size-3.5" />
      {copied ? "¡Link copiado!" : "Compartir"}
    </button>
  );
}

function AcceptForm({
  token,
  projectId,
  clientName,
  onClose,
  onAccepted,
}: {
  token: string;
  projectId: string;
  clientName: string;
  onClose: () => void;
  onAccepted: (a: PublicProjectData["acceptance"]) => void;
}) {
  const [name, setName] = useState(clientName);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [hasSig, setHasSig] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = canvas.offsetWidth * window.devicePixelRatio;
    canvas.height = canvas.offsetHeight * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#0F172A";
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  function pos(e: React.PointerEvent) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function start(e: React.PointerEvent) {
    e.preventDefault();
    drawing.current = true;
    last.current = pos(e);
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !last.current) return;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    setHasSig(true);
  }
  function end() {
    drawing.current = false;
    last.current = null;
  }
  function clear() {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, c.width, c.height);
    setHasSig(false);
  }

  async function submit() {
    if (!name.trim()) {
      setError("Ingresá tu nombre");
      return;
    }
    if (!hasSig) {
      setError("Falta la firma");
      return;
    }
    const c = canvasRef.current;
    if (!c) return;
    setError(null);
    setSubmitting(true);
    try {
      const blob: Blob | null = await new Promise((res) => c.toBlob(res, "image/png", 0.9));
      if (!blob) throw new Error("No se pudo capturar la firma");
      const fd = new FormData();
      fd.append("signature", new File([blob], "firma.png", { type: "image/png" }));
      fd.append("name", name.trim());
      fd.append("email", email.trim());
      const r = await acceptProject(token, projectId, fd);
      if ("error" in r) throw new Error(r.error);
      onAccepted({
        id: r.data.id,
        project_id: projectId,
        signed_by_name: name.trim(),
        signed_by_email: email.trim() || null,
        signature_path: r.data.signature_path,
        signed_at: new Date().toISOString(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falló");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-4 sm:items-center">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">Aceptar proyecto</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
            aria-label="Cerrar"
          >
            <X className="size-5" />
          </button>
        </header>
        <div className="space-y-4 p-5">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
              Tu nombre
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
              Email (opcional)
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
            />
          </label>
          <div>
            <div className="mb-1 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-500">
              <span>Firma</span>
              <button
                type="button"
                onClick={clear}
                className="font-medium normal-case text-blue-600 hover:underline"
              >
                Limpiar
              </button>
            </div>
            <canvas
              ref={canvasRef}
              onPointerDown={start}
              onPointerMove={move}
              onPointerUp={end}
              onPointerLeave={end}
              className="h-44 w-full touch-none rounded-xl border-2 border-dashed border-slate-300 bg-white"
            />
          </div>
          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {submitting ? "Enviando…" : "Confirmar aceptación"}
          </button>
        </div>
      </div>
    </div>
  );
}
