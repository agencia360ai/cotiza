"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveOrgId } from "@/lib/org-context";
import { revisarUna, ESTADOS_VIGILADOS, type Snapshot } from "@/lib/panamacompra/vigilancia";

async function ctx() {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { ok: false as const, error: "Sesión expirada" };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false as const, error: "Sin organización" };
  return { ok: true as const, supabase, orgId };
}

// La 0047 puede no estar corrida. Se distingue "falta la migración" de un error
// real para poder avisar bien en vez de tragarse el problema.
function faltaMigracion(msg: string | undefined): boolean {
  return /pc_estado|pc_snapshot|pc_checked_at|tender_pc_events|column .* does not exist|schema cache/i.test(msg ?? "");
}

export type ResultadoRevision =
  | { ok: true; revisadas: number; conCambios: number; fallidas: { acto: string; motivo: string }[] }
  | { ok: false; error: string };

type FilaVigilada = {
  id: string;
  acto_number: string | null;
  objeto: string | null;
  pc_snapshot: Snapshot | null;
};

/**
 * Revisa en PanamaCompra todas las licitaciones participadas de la org.
 *
 * Se hace UNA consulta por licitación, no un escaneo del portal: son pocas y
 * cada una se busca por su número de acto. Una que falla no corta a las demás
 * — que el portal no encuentre un número no puede dejar sin revisar al resto.
 */
export async function revisarParticipadas(): Promise<ResultadoRevision> {
  const c = await ctx();
  if (!c.ok) return { ok: false, error: c.error };

  const { data, error } = await c.supabase
    .from("tenders")
    .select("id, acto_number, objeto, pc_snapshot")
    .eq("org_id", c.orgId)
    .is("archived_at", null)
    .in("status", ESTADOS_VIGILADOS as unknown as string[]);

  if (error) {
    return {
      ok: false,
      error: faltaMigracion(error.message)
        ? "Falta correr la migración 0047 en Supabase — sin ella no hay dónde guardar la vigilancia."
        : error.message,
    };
  }

  const filas = (data ?? []) as FilaVigilada[];
  if (filas.length === 0) return { ok: true, revisadas: 0, conCambios: 0, fallidas: [] };

  // Los eventos y la foto los escribe el admin client: son datos del sistema,
  // no del usuario, y no deben depender de qué puede escribir quien mira.
  //
  // createAdminClient TIRA si falta la service role key, y ese throw salía como
  // un 500 con la pantalla rota. Cualquier fallo acá tiene que volver como
  // mensaje: el equipo necesita saber POR QUÉ no se revisó.
  let adminRaw;
  try {
    adminRaw = createAdminClient();
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error && /SERVICE_ROLE/i.test(e.message)
          ? "Falta configurar SUPABASE_SERVICE_ROLE_KEY en el entorno — sin ella no se puede guardar la revisión."
          : e instanceof Error
            ? e.message
            : "No se pudo preparar la revisión",
    };
  }
  const admin = adminRaw as unknown as {
    from: (t: string) => {
      insert: (rows: Record<string, unknown>[]) => Promise<{ error: { message: string } | null }>;
      update: (p: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> };
    };
  };

  const ahora = new Date().toISOString();
  const fallidas: { acto: string; motivo: string }[] = [];
  let conCambios = 0;

  try {

  // En serie a propósito: el portal es lento y frágil, y son pocas. Golpearlo
  // en paralelo con una sesión compartida es la forma de que corte la sesión.
  for (const f of filas) {
    const acto = f.acto_number ?? "";
    const r = await revisarUna(acto, f.id, f.pc_snapshot ?? null);

    if (!r.ok) {
      fallidas.push({ acto: acto || (f.objeto ?? "sin número"), motivo: r.motivo ?? "error" });
      continue;
    }

    if (r.cambios.length > 0) {
      conCambios++;
      const eventos = r.cambios.map((cb) => ({
        org_id: c.orgId,
        tender_id: f.id,
        campo: cb.campo,
        antes: cb.antes,
        despues: cb.despues,
        resumen: cb.resumen,
      }));
      const ins = await admin.from("tender_pc_events").insert(eventos);
      if (ins.error && !faltaMigracion(ins.error.message)) {
        return { ok: false, error: `No se pudieron guardar los cambios: ${ins.error.message}` };
      }
    }

    // La foto se guarda SIEMPRE que la revisión salió bien, haya cambios o no:
    // es lo que permite detectar el próximo cambio y saber cuándo se miró.
    const patch: Record<string, unknown> = {
      pc_estado: r.snapshot?.estado ?? null,
      pc_snapshot: r.snapshot ?? null,
      pc_checked_at: ahora,
    };
    if (r.cambios.length > 0) {
      patch.pc_changed_at = ahora;
      patch.pc_cambio = r.cambios[0].resumen; // el más importante: ya vienen ordenados
      patch.pc_visto_at = null; // un cambio nuevo vuelve a pedir atención
    }
    const up = await admin.from("tenders").update(patch).eq("id", f.id);
    if (up.error && !faltaMigracion(up.error.message)) {
      return { ok: false, error: `No se pudo guardar la revisión: ${up.error.message}` };
    }
  }

  } catch (e) {
    // El portal es lento y frágil; un timeout no puede tumbar la pantalla.
    return { ok: false, error: e instanceof Error ? e.message : "Se cortó la revisión — reintenta" };
  }

  revalidatePath("/licitaciones");
  return { ok: true, revisadas: filas.length - fallidas.length, conCambios, fallidas };
}

/** Acuse de lectura: el equipo vio el cambio y deja de aparecer como pendiente. */
export async function marcarCambioVisto(tenderId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = await ctx();
  if (!c.ok) return { ok: false, error: c.error };
  const ahora = new Date().toISOString();

  const { error } = await c.supabase
    .from("tenders")
    .update({ pc_visto_at: ahora })
    .eq("id", tenderId)
    .eq("org_id", c.orgId);
  if (error) {
    return {
      ok: false,
      error: faltaMigracion(error.message) ? "Falta correr la migración 0047 en Supabase." : error.message,
    };
  }

  await c.supabase
    .from("tender_pc_events")
    .update({ visto_at: ahora })
    .eq("tender_id", tenderId)
    .eq("org_id", c.orgId)
    .is("visto_at", null);

  revalidatePath("/licitaciones");
  return { ok: true };
}
