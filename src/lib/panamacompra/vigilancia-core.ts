// Comparación de licitaciones participadas contra el portal. Lógica pura: sin
// red ni base, para poder verificarla sola — es la que decide qué se avisa y
// qué se calla, así que equivocarse acá es avisar de más (y que dejen de
// mirarlo) o de menos (y perder un contrato).

import type { PcRegistro } from "./client";

// Estados que cuentan como "ya presentamos y esperamos respuesta".
export const ESTADOS_VIGILADOS = ["presentada", "por_partir", "en_revision"] as const;

// Señales que se comparan entre revisiones. Son las que el portal expone en la
// búsqueda por número y que se mueven cuando pasa algo:
//   estado        — el proceso avanzó de etapa
//   reclamos      — apareció un reclamo (propio o de un competidor)
//   actaApertura  — se publicó el acta: ahí es donde suelen pedir subsanaciones
//   convocatoria  — el proceso se relanzó
export type Snapshot = {
  estado: string | null;
  reclamos: string | null;
  actaApertura: string | null;
  convocatoria: string | null;
  fechaCierre: string | null;
};

const str = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  return String(v);
};

export function snapshotDe(r: PcRegistro): Snapshot {
  return {
    estado: str(r.idEstado),
    reclamos: str(r.conteoReclamos),
    actaApertura: str(r.tieneActaApertura),
    convocatoria: str(r.numeroConvocatoria),
    fechaCierre: str(r.fechaCierre),
  };
}

export type Cambio = { campo: keyof Snapshot; antes: string | null; despues: string | null; resumen: string };

// Cómo se le explica cada cambio a una persona. El texto dice QUÉ HACER, no solo
// qué pasó: leer "idEstado 36 → 18" no le sirve a nadie.
const COMO_SE_LEE: Record<keyof Snapshot, (antes: string | null, despues: string | null) => string> = {
  actaApertura: () => "Se publicó el acta de apertura — revisa si piden subsanar algo",
  reclamos: (a, d) =>
    Number(d ?? 0) > Number(a ?? 0)
      ? "Entró un reclamo en el proceso — puede cambiar el resultado"
      : "Cambió la cantidad de reclamos del proceso",
  convocatoria: () => "El proceso se relanzó con una convocatoria nueva — hay que volver a presentar",
  estado: (a, d) => `El proceso cambió de etapa en el portal (${a ?? "?"} → ${d ?? "?"})`,
  fechaCierre: (_a, d) => `Movieron la fecha de cierre${d ? ` a ${d.slice(0, 10)}` : ""}`,
};

// Orden de importancia: si cambian varias cosas a la vez, la primera es la que
// se muestra en la fila. El acta manda porque es donde aparecen las
// subsanaciones, que es el riesgo que motivó todo esto.
const PRIORIDAD: (keyof Snapshot)[] = ["actaApertura", "reclamos", "convocatoria", "estado", "fechaCierre"];

export function compararSnapshots(antes: Snapshot | null, ahora: Snapshot): Cambio[] {
  // Primera revisión: se guarda la foto sin inventar cambios. Avisar de todo la
  // primera vez sería ruido puro y entrenaría al equipo a ignorar el panel.
  if (!antes) return [];
  const out: Cambio[] = [];
  for (const campo of PRIORIDAD) {
    const a = antes[campo] ?? null;
    const d = ahora[campo] ?? null;
    if (a === d) continue;
    out.push({ campo, antes: a, despues: d, resumen: COMO_SE_LEE[campo](a, d) });
  }
  return out;
}

