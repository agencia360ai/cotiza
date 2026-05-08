import Link from "next/link";
import { Snowflake, Wind, Box, Refrigerator, ChevronRight, Clock, AlertTriangle } from "lucide-react";
import { StatusBadge } from "./status-badge";
import { StatusSparkline } from "./charts";
import type { Equipment } from "@/lib/maintenance/types";
import { cn } from "@/lib/utils";

const CATEGORY_ICON: Record<string, typeof Snowflake> = {
  nevera: Refrigerator,
  congelador: Snowflake,
  aire_acondicionado: Wind,
  evaporadora: Wind,
};

const CATEGORY_FALLBACK_LABEL: Record<string, string> = {
  nevera: "Nevera",
  congelador: "Congelador",
  aire_acondicionado: "Aire acondicionado",
  evaporadora: "Evaporadora",
  otro: "Equipo",
};

function formatRelativeDate(iso: string | null): { text: string; days: number | null } {
  if (!iso) return { text: "Sin inspección", days: null };
  const date = new Date(iso);
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days < 1) return { text: "hoy", days };
  if (days < 7) return { text: `hace ${days} día${days === 1 ? "" : "s"}`, days };
  if (days < 30) return { text: `hace ${Math.floor(days / 7)} sem`, days };
  if (days < 365) return { text: `hace ${Math.floor(days / 30)} mes`, days };
  return { text: `hace ${Math.floor(days / 365)} año`, days };
}

export function EquipmentCard({
  equipment,
  href,
}: {
  equipment: Equipment;
  href?: string;
}) {
  const Icon = (equipment.category ? CATEGORY_ICON[equipment.category] : null) ?? Box;
  const status = equipment.latest_status ?? "sin_inspeccion";

  // Title priority: location_label (área) > custom_name > category fallback.
  const title =
    equipment.location_label?.trim() ||
    (equipment.custom_name && equipment.custom_name.trim() !== "" ? equipment.custom_name : null) ||
    (equipment.category ? CATEGORY_FALLBACK_LABEL[equipment.category] ?? "Equipo" : "Equipo");

  // Specifics line: brand · model (skip "S/A" placeholders).
  const brand = equipment.brand?.trim();
  const model = equipment.model && equipment.model !== "S/A" ? equipment.model.trim() : null;
  const specifics = [brand, model].filter(Boolean).join(" · ");

  const inspection = formatRelativeDate(equipment.latest_inspection_at);
  const stale = inspection.days === null || inspection.days > 90;

  const inner = (
    <>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 transition-colors group-hover:bg-slate-200">
          <Icon className="size-5" />
        </div>
        <StatusBadge status={status} size="sm" short />
      </div>

      <div className="mb-4">
        <p className="line-clamp-2 text-base font-bold leading-snug text-slate-900">{title}</p>
        {specifics ? (
          <p className="mt-1 truncate text-xs text-slate-500">{specifics}</p>
        ) : null}
      </div>

      <div
        className={cn(
          "mt-auto flex items-center justify-between gap-2 rounded-lg px-3 py-2 ring-1 ring-inset",
          stale
            ? "bg-amber-50 ring-amber-600/15 text-amber-900"
            : "bg-slate-50 ring-slate-200 text-slate-800",
        )}
      >
        <div className="flex items-center gap-2">
          {stale ? (
            <AlertTriangle className="size-3.5 shrink-0 text-amber-600" />
          ) : (
            <Clock className="size-3.5 shrink-0 text-slate-500" />
          )}
          <div className="min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-wider opacity-75">
              Última inspección
            </p>
            <p className="text-sm font-bold tabular-nums">{inspection.text}</p>
          </div>
        </div>
        <StatusSparkline history={equipment.history} />
      </div>

      {href ? (
        <ChevronRight className="absolute right-3 top-3 size-4 text-slate-300 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
      ) : null}
    </>
  );

  const baseClass =
    "group relative flex flex-col rounded-xl border border-slate-200 bg-white p-4 transition-all";

  if (href) {
    return (
      <Link href={href} className={`${baseClass} hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md`}>
        {inner}
      </Link>
    );
  }

  return <div className={`${baseClass} hover:shadow-md`}>{inner}</div>;
}
