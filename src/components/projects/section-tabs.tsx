"use client";

import { useRef, useState, useTransition } from "react";
import { Check, ChevronDown, Loader2, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SECTION_COLORS,
  SECTION_COLOR_HEX,
  SECTION_COLOR_SOFT,
  type ProjectSection,
  type SectionColor,
} from "@/lib/projects/types";

type SectionTabsProps = {
  sections: ProjectSection[];
  activeId: string | "all";
  onSelect: (id: string | "all") => void;
  /** Editable controls. Omit for the read-only public view. */
  onCreate?: (input: { name: string; color: SectionColor }) => Promise<{ error: string } | { ok: true }>;
  onRename?: (sectionId: string, name: string) => Promise<{ error: string } | { ok: true }>;
  onRecolor?: (sectionId: string, color: SectionColor) => Promise<{ error: string } | { ok: true }>;
  onDelete?: (sectionId: string) => Promise<{ error: string } | { ok: true }>;
  onReorder?: (orderedIds: string[]) => Promise<{ error: string } | { ok: true }>;
};

export function SectionTabs({
  sections,
  activeId,
  onSelect,
  onCreate,
  onRename,
  onRecolor,
  onDelete,
  onReorder,
}: SectionTabsProps) {
  const isEditable = !!onCreate;
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [showNew, setShowNew] = useState(false);

  // Drag-to-reorder state (HTML5 native)
  const dragId = useRef<string | null>(null);

  function handleDragStart(id: string) {
    dragId.current = id;
  }
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
  }
  function handleDrop(targetId: string) {
    const src = dragId.current;
    dragId.current = null;
    if (!src || src === targetId || !onReorder) return;
    const ids = sections.map((s) => s.id);
    const fromIdx = ids.indexOf(src);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...ids];
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, src);
    startTransition(async () => {
      await onReorder(next);
    });
  }

  // The "All" pseudo-tab — only shown when there are sections AND there might be
  // unassigned milestones. Always shown when editable so user can see ungrouped items.
  const showAllTab = sections.length > 0;

  return (
    <div className="border-b border-slate-200 bg-white">
      <div className="flex items-end gap-1 overflow-x-auto px-2 pt-2 sm:px-4">
        {showAllTab ? (
          <TabButton
            label="Todos"
            color="slate"
            active={activeId === "all"}
            onClick={() => onSelect("all")}
          />
        ) : null}

        {sections.map((s) => {
          const active = activeId === s.id;
          const isRenaming = renamingId === s.id;
          return (
            <div
              key={s.id}
              draggable={isEditable && !isRenaming}
              onDragStart={() => handleDragStart(s.id)}
              onDragOver={handleDragOver}
              onDrop={() => handleDrop(s.id)}
              className="relative"
            >
              {isRenaming ? (
                <RenameInline
                  initial={s.name}
                  onSave={async (name) => {
                    if (onRename) await onRename(s.id, name);
                    setRenamingId(null);
                  }}
                  onCancel={() => setRenamingId(null)}
                />
              ) : (
                <TabButton
                  label={s.name}
                  color={s.color}
                  active={active}
                  onClick={() => onSelect(s.id)}
                  trailing={
                    isEditable ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuFor(openMenuFor === s.id ? null : s.id);
                        }}
                        className="ml-1 flex size-5 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        aria-label="Acciones"
                      >
                        <ChevronDown className="size-3" />
                      </button>
                    ) : null
                  }
                />
              )}

              {openMenuFor === s.id && !isRenaming ? (
                <TabMenu
                  section={s}
                  onClose={() => setOpenMenuFor(null)}
                  onRename={() => {
                    setOpenMenuFor(null);
                    setRenamingId(s.id);
                  }}
                  onRecolor={async (color) => {
                    if (onRecolor) {
                      await onRecolor(s.id, color);
                    }
                    setOpenMenuFor(null);
                  }}
                  onDelete={async () => {
                    if (!onDelete) return;
                    if (!confirm(`¿Quitar la pestaña "${s.name}"? Los hitos quedan sin categoría.`)) return;
                    await onDelete(s.id);
                    setOpenMenuFor(null);
                  }}
                />
              ) : null}
            </div>
          );
        })}

        {isEditable ? (
          showNew ? (
            <NewTabInline
              onSave={async (name, color) => {
                if (onCreate) {
                  const r = await onCreate({ name, color });
                  if (r && "error" in r) return;
                }
                setShowNew(false);
              }}
              onCancel={() => setShowNew(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowNew(true)}
              className="ml-1 mb-[1px] inline-flex items-center gap-1 rounded-t-lg border border-b-0 border-dashed border-slate-300 bg-slate-50/50 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
              title="Agregar pestaña"
            >
              <Plus className="size-3.5" />
              <span className="hidden sm:inline">Nueva pestaña</span>
            </button>
          )
        ) : null}

        {pending ? <Loader2 className="ml-2 mb-2 size-3.5 animate-spin text-slate-400" /> : null}
      </div>
    </div>
  );
}

function TabButton({
  label,
  color,
  active,
  onClick,
  trailing,
}: {
  label: string;
  color: SectionColor;
  active: boolean;
  onClick: () => void;
  trailing?: React.ReactNode;
}) {
  const accent = SECTION_COLOR_HEX[color];
  const softBg = SECTION_COLOR_SOFT[color];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative inline-flex items-center gap-1.5 rounded-t-lg border-b-0 px-3 py-1.5 text-xs font-semibold transition-colors",
        active
          ? "border border-slate-200 bg-white text-slate-900 -mb-px"
          : "border border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900",
      )}
      style={
        active
          ? { boxShadow: `inset 0 3px 0 ${accent}`, backgroundColor: "white" }
          : undefined
      }
    >
      <span
        className="size-2 rounded-full"
        style={{ backgroundColor: active ? accent : softBg }}
      />
      <span className="max-w-[160px] truncate">{label}</span>
      {trailing}
    </button>
  );
}

function TabMenu({
  section,
  onClose,
  onRename,
  onRecolor,
  onDelete,
}: {
  section: ProjectSection;
  onClose: () => void;
  onRename: () => void;
  onRecolor: (color: SectionColor) => void;
  onDelete: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div className="absolute left-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
        <button
          type="button"
          onClick={onRename}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
        >
          <Pencil className="size-3.5 text-slate-400" />
          Renombrar
        </button>
        <div className="border-t border-slate-100 px-3 py-2">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Color
          </p>
          <div className="flex flex-wrap gap-1.5">
            {SECTION_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onRecolor(c)}
                className={cn(
                  "size-5 rounded-full border-2 transition-all",
                  section.color === c ? "border-slate-900" : "border-transparent hover:border-slate-300",
                )}
                style={{ backgroundColor: SECTION_COLOR_HEX[c] }}
                aria-label={`Color ${c}`}
              >
                {section.color === c ? <Check className="size-3 text-white" /> : null}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
        >
          <Trash2 className="size-3.5" />
          Quitar pestaña
        </button>
      </div>
    </>
  );
}

function RenameInline({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSave(name.trim());
      }}
      className="-mb-px flex items-center gap-1 rounded-t-lg border border-slate-300 bg-white px-2 py-1"
    >
      <input
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onBlur={(e) => {
          if (e.relatedTarget) return;
          onCancel();
        }}
        className="w-32 bg-transparent text-xs font-semibold text-slate-900 focus:outline-none"
      />
      <button type="submit" className="text-emerald-600 hover:text-emerald-800" aria-label="Guardar">
        <Check className="size-3.5" />
      </button>
      <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-700" aria-label="Cancelar">
        <X className="size-3.5" />
      </button>
    </form>
  );
}

function NewTabInline({
  onSave,
  onCancel,
}: {
  onSave: (name: string, color: SectionColor) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<SectionColor>("blue");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSave(name.trim(), color);
      }}
      className="-mb-px flex items-center gap-1 rounded-t-lg border border-slate-300 bg-white px-2 py-1"
    >
      <span
        className="inline-block size-2.5 rounded-full"
        style={{ backgroundColor: SECTION_COLOR_HEX[color] }}
      />
      <input
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        placeholder="Nombre"
        className="w-32 bg-transparent text-xs font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-none"
      />
      <ColorPicker color={color} onChange={setColor} />
      <button type="submit" className="text-emerald-600 hover:text-emerald-800" aria-label="Crear">
        <Check className="size-3.5" />
      </button>
      <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-700" aria-label="Cancelar">
        <X className="size-3.5" />
      </button>
    </form>
  );
}

function ColorPicker({ color, onChange }: { color: SectionColor; onChange: (c: SectionColor) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex size-5 items-center justify-center rounded text-slate-400 hover:bg-slate-100"
        aria-label="Cambiar color"
      >
        <MoreHorizontal className="size-3" />
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-30 mt-1 grid grid-cols-4 gap-1 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
          {SECTION_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                onChange(c);
                setOpen(false);
              }}
              className={cn(
                "size-5 rounded-full border-2",
                color === c ? "border-slate-900" : "border-transparent hover:border-slate-300",
              )}
              style={{ backgroundColor: SECTION_COLOR_HEX[c] }}
              aria-label={`Color ${c}`}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
