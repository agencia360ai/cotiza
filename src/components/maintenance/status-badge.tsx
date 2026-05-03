import { CheckCircle2, AlertTriangle, XOctagon, PowerOff, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, STATUS_LABEL_SHORT, STATUS_TINT, type EquipmentStatus } from "@/lib/maintenance/types";

const ICON: Record<EquipmentStatus, typeof CheckCircle2> = {
  operativo: CheckCircle2,
  atencion: AlertTriangle,
  critico: XOctagon,
  fuera_de_servicio: PowerOff,
  sin_inspeccion: HelpCircle,
};

export function StatusBadge({
  status,
  size = "md",
  short = false,
}: {
  status: EquipmentStatus;
  size?: "sm" | "md";
  short?: boolean;
}) {
  const Icon = ICON[status];
  const label = short ? STATUS_LABEL_SHORT[status] : STATUS_LABEL[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium ring-1 ring-inset",
        STATUS_TINT[status],
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs",
      )}
    >
      <Icon className={cn(size === "sm" ? "size-3" : "size-3.5")} />
      {label}
    </span>
  );
}

export function StatusDot({ status, className }: { status: EquipmentStatus; className?: string }) {
  const colorMap: Record<EquipmentStatus, string> = {
    operativo: "bg-emerald-500",
    atencion: "bg-amber-500",
    critico: "bg-red-500",
    fuera_de_servicio: "bg-gray-500",
    sin_inspeccion: "bg-slate-400",
  };
  return <span className={cn("inline-block size-2 rounded-full", colorMap[status], className)} />;
}
