"use client";

import { Calendar as CalendarIcon, Play, Sparkles } from "lucide-react";
import {
  projectImageUrl,
  type ProjectMedia,
  type ProjectMilestoneEntry,
} from "@/lib/projects/types";

export function MilestoneEntriesList({
  entries,
  onPreview,
}: {
  entries: ProjectMilestoneEntry[];
  onPreview: (m: ProjectMedia) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <ol className="mt-4 space-y-3 border-l-2 border-slate-100 pl-4">
      {entries.map((e) => (
        <EntryCard key={e.id} entry={e} onPreview={onPreview} />
      ))}
    </ol>
  );
}

function EntryCard({
  entry,
  onPreview,
}: {
  entry: ProjectMilestoneEntry;
  onPreview: (m: ProjectMedia) => void;
}) {
  return (
    <li className="relative">
      <span className="absolute -left-[19px] top-2 size-3 rounded-full border-2 border-white bg-slate-300" />
      <article className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
        <div className="flex items-center gap-2 text-xs">
          {entry.occurred_on ? (
            <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
              <CalendarIcon className="size-3" />
              {new Date(entry.occurred_on).toLocaleDateString("es-PA", {
                day: "2-digit",
                month: "long",
                year: "numeric",
              })}
            </span>
          ) : null}
          {entry.ai_generated ? (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-violet-700">
              <Sparkles className="size-2.5" />
              IA
            </span>
          ) : null}
        </div>
        {entry.text_es ? (
          <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-slate-700">
            {entry.text_es}
          </p>
        ) : null}
        {entry.media.length > 0 ? (
          <div className="mt-3 grid grid-cols-3 gap-1.5 sm:grid-cols-5">
            {entry.media.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onPreview(m)}
                className="group relative aspect-square overflow-hidden rounded-md ring-1 ring-slate-200"
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
                      <Play className="size-6 fill-white text-white drop-shadow-md" />
                    </span>
                  </div>
                )}
              </button>
            ))}
          </div>
        ) : null}
      </article>
    </li>
  );
}
