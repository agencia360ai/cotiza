"use client";

import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

// Ordenamiento por columnas compartido entre todas las tablas de la app
// (cotizaciones, licitaciones, board del gobierno). Una sola fuente = misma
// interacción y misma estética en todas las pantallas.

export type SortDir = "asc" | "desc";
export type SortState<K extends string> = { key: K; dir: SortDir };

export function toggleSort<K extends string>(cur: SortState<K>, key: K, defaultDir: SortDir = "asc"): SortState<K> {
  if (cur.key === key) return { key, dir: cur.dir === "asc" ? "desc" : "asc" };
  return { key, dir: defaultDir };
}

export function compareVals(a: unknown, b: unknown, dir: SortDir): number {
  const an = a === null || a === undefined || a === "";
  const bn = b === null || b === undefined || b === "";
  if (an && bn) return 0;
  if (an) return 1; // nulls/vacíos siempre al final
  if (bn) return -1;
  let r: number;
  if (typeof a === "number" && typeof b === "number") r = a - b;
  else r = String(a).localeCompare(String(b), "es", { numeric: true });
  return dir === "asc" ? r : -r;
}

export function SortTh<K extends string>({
  label,
  k,
  sort,
  onSort,
  align = "left",
  className,
}: {
  label: string;
  k: K;
  sort: SortState<K>;
  onSort: (k: K) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort.key === k;
  return (
    <th
      className={cn("cursor-pointer select-none px-3 py-2.5 font-semibold hover:text-slate-700", className)}
      onClick={() => onSort(k)}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <span className={cn("inline-flex items-center gap-1", align === "right" && "flex-row-reverse")}>
        {label}
        {active ? (
          sort.dir === "asc" ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />
        ) : (
          <ChevronsUpDown className="size-3.5 opacity-30" />
        )}
      </span>
    </th>
  );
}
