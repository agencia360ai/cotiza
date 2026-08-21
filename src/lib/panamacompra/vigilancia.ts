import "server-only";
import { pcLoginCached, pcBuscarProcesos, hasPanamaCompraConfig } from "./client";
import { snapshotDe, compararSnapshots, type Snapshot, type Cambio } from "./vigilancia-core";

export * from "./vigilancia-core";

// Vigilancia de licitaciones PARTICIPADAS.
//
// Cuando una licitación ya se presentó, nadie avisa si el proceso se movió: hay
// que entrar a PanamaCompra y mirarlo a mano. Si piden una subsanación y nadie
// la ve a tiempo, se pierde el contrato.
//
// Solo se vigilan las participadas, a propósito. Son pocas —2 a 8 a la vez— y
// son las únicas donde un cambio obliga a actuar: en una "por participar" el
// cambio es información, en una participada es una fecha límite. Por eso se las
// consulta UNA POR UNA con su número de acto, en vez de rastrillar las 9.286
// del portal: es más barato y llega antes.

const str = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

export type RevisionUna = {
  tenderId: string;
  acto: string;
  ok: boolean;
  motivo?: string;
  snapshot?: Snapshot;
  cambios: Cambio[];
};

/**
 * Consulta el portal por el número de acto y compara con la última foto.
 * No escribe nada: devolver el resultado deja que quien llama decida si
 * persiste, y hace la función testeable sin base de datos.
 */
export async function revisarUna(acto: string, tenderId: string, previo: Snapshot | null): Promise<RevisionUna> {
  const base = { tenderId, acto, cambios: [] as Cambio[] };
  if (!hasPanamaCompraConfig()) return { ...base, ok: false, motivo: "Faltan credenciales de PanamaCompra" };
  if (!acto.trim()) return { ...base, ok: false, motivo: "La licitación no tiene número de acto" };

  try {
    const session = await pcLoginCached();
    const regs = await pcBuscarProcesos(session, acto);
    if (regs.length === 0) return { ...base, ok: false, motivo: "El portal no devolvió ese número de acto" };

    // Un proceso relanzado devuelve varias convocatorias con el mismo número.
    // Interesa la ÚLTIMA: es la que está viva.
    const reg = regs.reduce((mejor, r) =>
      Number(str(r.numeroConvocatoria) ?? 0) > Number(str(mejor.numeroConvocatoria) ?? 0) ? r : mejor,
    );
    const snapshot = snapshotDe(reg);
    return { ...base, ok: true, snapshot, cambios: compararSnapshots(previo, snapshot) };
  } catch (e) {
    return { ...base, ok: false, motivo: e instanceof Error ? e.message : "No se pudo consultar el portal" };
  }
}
