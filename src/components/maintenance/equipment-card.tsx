import Link from "next/link";
import { Snowflake, Wind, Box, Refrigerator, ChevronRight } from "lucide-react";
import { StatusBadge } from "./status-badge";
import { StatusSparkline } from "./charts";
import type { Equipment } from "@/lib/maintenance/types";

const CATEGORY_ICON: Record<string, typeof Snowflake> = {
  nevera: Refrigerator,
  congelador: Snowflake,
  aire_acondicionado: Wind,
  evaporadora: Wind,
};

function formatRelativeDate(iso: string | null): string {
  if (!iso) return "Sin inspección";
  const date = new Date(iso);
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days < 1) return "hoy";
  if (days < 7) return `hace ${days} día${days === 1 ? "" : "s"}`;
  if (days < 30) return `hace ${Math.floor(days / 7)} sem`;
  if (days < 365) return `hace ${Math.floor(days / 30)} mes`;
  return `hace ${Math.floor(days / 365)} año`;
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

  const inner = (
    <>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 transition-colors group-hover:bg-slate-200">
          <Icon className="size-5" />
        </div>
        <StatusBadge status={status} size="sm" short />
      </div>

      <div className="mb-3 min-h-[3rem]">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
          {equipment.brand ?? ""}
        </p>
        <p className="mt-0.5 line-clamp-2 text-sm font-semibold text-slate-900">
          {equipment.model && equipment.model !== "S/A"
            ? equipment.model
            : equipment.custom_name}
        </p>
        {equipment.location_label ? (
          <p className="mt-0.5 truncate text-xs text-slate-500">{equipment.location_label}</p>
        ) : null}
      </div>

      <div className="mt-auto flex items-end justify-between gap-2 border-t border-slate-100 pt-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-400">Última inspección</p>
          <p className="text-xs font-medium text-slate-700">
            {formatRelativeDate(equipment.latest_inspection_at)}
          </p>
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
