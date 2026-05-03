import Link from "next/link";
import { STATUS_COLOR, type EquipmentStatus, type Equipment, type Location } from "@/lib/maintenance/types";

type HeatmapEntry = { date: string; status: EquipmentStatus };

function buildColumnDates(locations: Location[]): string[] {
  const set = new Set<string>();
  for (const loc of locations) {
    for (const eq of loc.equipment) {
      for (const h of eq.history) set.add(h.date);
    }
  }
  return Array.from(set).sort();
}

function statusOnDate(equipment: Equipment, date: string): EquipmentStatus | null {
  const entry = equipment.history.find((h) => h.date === date);
  return entry?.status ?? null;
}

function formatColLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("es-PA", { month: "short", year: "2-digit" });
}

export function HistoryHeatmap({
  locations,
  token,
}: {
  locations: Location[];
  token: string;
}) {
  const columns = buildColumnDates(locations);
  if (columns.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-end justify-between border-b border-slate-100 px-5 py-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Mapa histórico de equipos</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Estado de cada equipo en cada inspección publicada
          </p>
        </div>
        <div className="hidden items-center gap-3 text-xs text-slate-500 sm:flex">
          <Legend label="Operativo" color={STATUS_COLOR.operativo} />
          <Legend label="Atención" color={STATUS_COLOR.atencion} />
          <Legend label="Crítico" color={STATUS_COLOR.critico} />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white px-4 py-2 text-left font-medium text-slate-500">
                Equipo
              </th>
              {columns.map((c) => (
                <th
                  key={c}
                  className="px-2 py-2 text-center font-medium uppercase tracking-wider text-slate-500"
                >
                  {formatColLabel(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {locations.map((loc) => (
              <RowGroup key={loc.id} locationName={loc.name} equipment={loc.equipment} columns={columns} token={token} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowGroup({
  locationName,
  equipment,
  columns,
  token,
}: {
  locationName: string;
  equipment: Equipment[];
  columns: string[];
  token: string;
}) {
  return (
    <>
      <tr>
        <td
          colSpan={columns.length + 1}
          className="sticky left-0 z-10 bg-slate-50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500"
        >
          {locationName}
        </td>
      </tr>
      {equipment.map((eq) => (
        <tr key={eq.id} className="group">
          <td className="sticky left-0 z-10 max-w-[200px] truncate bg-white px-4 py-2 align-middle text-slate-800 group-hover:bg-slate-50">
            <Link
              href={`/p/${token}/equipment/${eq.id}`}
              className="font-medium text-slate-700 hover:text-slate-900 hover:underline"
            >
              <span className="font-semibold">{eq.brand ?? ""}</span>
              {eq.model && eq.model !== "S/A" ? ` ${eq.model}` : ""}
            </Link>
            {eq.location_label ? (
              <p className="truncate text-[10px] text-slate-400">{eq.location_label}</p>
            ) : null}
          </td>
          {columns.map((c) => {
            const status = statusOnDate(eq, c);
            return (
              <td key={c} className="px-2 py-1.5 text-center">
                <Cell status={status} date={c} />
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

function Cell({ status, date }: { status: EquipmentStatus | null; date: string }) {
  if (!status) {
    return (
      <span className="mx-auto block h-6 w-full max-w-[40px] rounded bg-slate-100" title={`No inspeccionado el ${date}`} />
    );
  }
  return (
    <span
      className="mx-auto block h-6 w-full max-w-[40px] rounded ring-1 ring-inset ring-black/5 transition-transform hover:scale-110"
      style={{ backgroundColor: STATUS_COLOR[status] }}
      title={`${status} · ${date}`}
    />
  );
}

function Legend({ label, color }: { label: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-3 rounded" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
