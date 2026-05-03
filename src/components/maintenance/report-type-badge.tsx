import { Calendar, Wrench, PackagePlus, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  REPORT_TYPE_LABEL,
  REPORT_TYPE_LABEL_SHORT,
  REPORT_TYPE_TINT,
  type ReportType,
} from "@/lib/maintenance/types";

const ICON: Record<ReportType, typeof Calendar> = {
  preventivo: Calendar,
  correctivo: Wrench,
  instalacion: PackagePlus,
  inspeccion: ClipboardList,
};

export function ReportTypeBadge({
  type,
  short = false,
  size = "md",
}: {
  type: ReportType;
  short?: boolean;
  size?: "sm" | "md";
}) {
  const Icon = ICON[type];
  const label = short ? REPORT_TYPE_LABEL_SHORT[type] : REPORT_TYPE_LABEL[type];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium ring-1 ring-inset",
        REPORT_TYPE_TINT[type],
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs",
      )}
    >
      <Icon className={size === "sm" ? "size-3" : "size-3.5"} />
      {label}
    </span>
  );
}

export function ReportTypeIcon({ type, className }: { type: ReportType; className?: string }) {
  const Icon = ICON[type];
  return <Icon className={className} />;
}
