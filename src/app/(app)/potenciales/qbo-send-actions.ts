"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { hasQboConfig } from "@/lib/quickbooks/mcp";
import { createQboProject, suggestFromQbo, nextContractNumber, type QboParentOption } from "@/lib/quickbooks/create-project";
import { norm } from "@/lib/clients/normalize";

// Cotización aprobada → proyecto en QuickBooks. El correlativo (DC26-08) se
// sugiere desde QBO (autoridad real) con fallback a lo sincronizado en la base;
// el envío es idempotente (qbo_job_id en la cotización) y el proyecto aparece
// en el board al instante vía upsert en qbo_project_state.

type Result<T> = { error: string } | { ok: true; data: T };

function isMissingColumn(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42703") return true;
  return /does not exist|could not find|schema cache/i.test(error.message ?? "");
}

async function ctx() {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { ok: false as const, error: "Sesión expirada" };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false as const, error: "Sin organización" };
  return { ok: true as const, supabase, orgId };
}

export type QboSendSuggestion = {
  numero: string; // próximo correlativo (editable)
  nombre: string; // nombre sugerido del proyecto
  parents: QboParentOption[]; // clientes padre de QBO para elegir
  matchedParentId: string | null; // pre-selección por nombre del cliente
  desdeQbo: boolean; // false = QBO no respondió, correlativo desde la base
  yaEnviada: { qboJobId: string; at: string | null } | null;
};

// Sugerencia para el diálogo: correlativo + clientes padre + preselección.
export async function suggestQboProjectSetup(quoteId: string): Promise<Result<QboSendSuggestion>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  type Q = {
    rubro: string | null;
    year: number | null;
    client_name: string | null;
    client_std_name?: string | null;
    description: string | null;
    qbo_job_id?: string | null;
    qbo_sent_at?: string | null;
  };
  const run = (cols: string) =>
    c.supabase.from("sales_quotes").select(cols).eq("id", quoteId).eq("org_id", c.orgId).maybeSingle();
  let res = (await run("rubro, year, client_name, description, qbo_job_id, qbo_sent_at, client:clients(name)")) as {
    data: (Q & { client: { name: string } | null }) | null;
    error: { message: string; code?: string } | null;
  };
  if (isMissingColumn(res.error)) {
    res = (await run("rubro, year, client_name, description, client:clients(name)")) as typeof res;
  }
  if (res.error) return { error: res.error.message };
  const q = res.data;
  if (!q) return { error: "Cotización no encontrada" };

  // El rubro de contrato en QBO es DC o DM (los DS/DV no suelen ser proyectos);
  // se respeta el rubro de la cotización con default DC.
  const rubro = q.rubro === "DM" ? "DM" : "DC";
  const year = q.year ?? new Date().getFullYear();
  const clientName = q.client?.name ?? q.client_std_name ?? q.client_name ?? "";

  let numero: string;
  let parents: QboParentOption[] = [];
  let desdeQbo = false;
  if (hasQboConfig()) {
    try {
      const s = await suggestFromQbo(rubro, year);
      numero = s.numero.numero;
      parents = s.parents;
      desdeQbo = true;
    } catch {
      numero = "";
    }
  } else {
    numero = "";
  }
  if (!numero) {
    // Fallback: correlativo desde lo último sincronizado en la base.
    const { data: st } = (await c.supabase
      .from("qbo_project_state")
      .select("full_name, name")
      .eq("org_id", c.orgId)
      .eq("year", year)
      .limit(1000)) as { data: { full_name: string | null; name: string | null }[] | null };
    const names = (st ?? []).map((r) => r.full_name ?? r.name ?? "").filter(Boolean);
    numero = nextContractNumber(names, rubro, year).numero;
  }

  // Preselección del padre por nombre del cliente (contains en ambos sentidos).
  const cn = norm(clientName);
  const matched =
    cn.length > 1
      ? parents.find((p) => {
          const pn = norm(p.name);
          return pn === cn || pn.includes(cn) || cn.includes(pn);
        })
      : undefined;

  const desc = (q.description ?? "").trim();
  const nombre = [numero, desc, clientName ? `- ${clientName}` : null].filter(Boolean).join(" ").slice(0, 100);

  return {
    ok: true,
    data: {
      numero,
      nombre,
      parents,
      matchedParentId: matched?.id ?? null,
      desdeQbo,
      yaEnviada: q.qbo_job_id ? { qboJobId: q.qbo_job_id, at: q.qbo_sent_at ?? null } : null,
    },
  };
}

export type QboSendInput = {
  numero: string;
  nombre: string;
  parentId: string;
  parentName: string;
  email: string | null;
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null;
  notas: string | null;
};

// Crea el proyecto en QBO y deja todo enlazado. Guards: columnas de la 0022
// presentes (ANTES de crear nada en QBO), cotización sin enviar todavía.
export async function sendQuoteToQbo(quoteId: string, input: QboSendInput): Promise<Result<{ qboJobId: string; nombre: string }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  if (!hasQboConfig()) return { error: "QBO_MCP_URL no está configurada (setéala en Vercel)." };
  if (!input.numero.trim() || !input.nombre.trim()) return { error: "Número y nombre del proyecto son obligatorios." };
  if (!input.parentId) return { error: "Elige el cliente de QBO al que pertenece el proyecto." };

  // Probe de la migración 0022 ANTES de tocar QBO: si falta, no queremos crear
  // el proyecto y quedarnos sin dónde registrar el link (doble envío después).
  const probe = (await c.supabase
    .from("sales_quotes")
    .select("id, qbo_job_id, status")
    .eq("id", quoteId)
    .eq("org_id", c.orgId)
    .maybeSingle()) as { data: { id: string; qbo_job_id: string | null; status: string } | null; error: { message: string; code?: string } | null };
  if (isMissingColumn(probe.error)) return { error: "Falta la migración 0022 (qbo_job_id) — corre el SQL y reintenta." };
  if (probe.error) return { error: probe.error.message };
  if (!probe.data) return { error: "Cotización no encontrada" };
  if (probe.data.qbo_job_id) return { error: "Esta cotización ya fue enviada a QBO." };

  let created: { id: string; name: string };
  try {
    created = await createQboProject({
      displayName: input.nombre.trim(),
      parentId: input.parentId,
      parentName: input.parentName,
      email: input.email?.trim() || null,
      notes: input.notas?.trim() || null,
      startDate: input.startDate || null,
      endDate: input.endDate || null,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "QBO no pudo crear el proyecto" };
  }

  // Link en la cotización (compare-and-set sobre qbo_job_id null: dos clicks
  // concurrentes no crean dos links; el segundo ve el guard y reporta).
  const nowIso = new Date().toISOString();
  const { data: linked, error: linkErr } = (await c.supabase
    .from("sales_quotes")
    .update({ status: "aprobada", qbo_job_id: created.id, qbo_sent_at: nowIso })
    .eq("id", quoteId)
    .eq("org_id", c.orgId)
    .is("qbo_job_id", null)
    .select("id")) as { data: { id: string }[] | null; error: { message: string } | null };
  if (linkErr) return { error: `El proyecto se creó en QBO (${created.name}) pero no se pudo enlazar: ${linkErr.message}` };
  if (!linked || linked.length === 0) {
    return { error: `Otro envío ganó la carrera — revisa el proyecto ${created.name} en QBO (puede haber quedado duplicado).` };
  }

  // Aparece en el board YA (sin esperar "Actualizar"): upsert del estado con lo
  // que sabemos. income/cost null hasta el próximo refresh.
  const yy = input.numero.match(/(\d{2})\s*-/)?.[1];
  const stateRow: Record<string, unknown> = {
    org_id: c.orgId,
    qb_job_id: created.id,
    name: input.nombre.trim(),
    full_name: `${input.parentName}:${input.nombre.trim()}`,
    rubro: input.numero.slice(0, 2).toUpperCase(),
    year: yy ? 2000 + Number(yy) : new Date().getFullYear(),
    client_name: input.parentName,
    synced_at: nowIso,
    start_date: input.startDate || null,
    end_date: input.endDate || null,
    notes: input.notas?.trim() || null,
  };
  let up = await c.supabase.from("qbo_project_state").upsert(stateRow, { onConflict: "org_id,qb_job_id" });
  if (isMissingColumn(up.error)) {
    // 0022 en qbo_project_state pendiente: guardar sin fechas/notas.
    delete stateRow.start_date;
    delete stateRow.end_date;
    delete stateRow.notes;
    up = await c.supabase.from("qbo_project_state").upsert(stateRow, { onConflict: "org_id,qb_job_id" });
  }
  // Un fallo acá no invalida el envío (el refresh lo trae igual) — no se reporta
  // como error del flujo.

  revalidatePath("/potenciales");
  revalidatePath("/proyectos");
  return { ok: true, data: { qboJobId: created.id, nombre: created.name } };
}

// ── Seguimiento de enviadas viejas (action points) ────────────────────────────

export async function dismissSeguimiento(quoteId: string, motivo: string): Promise<Result<{ at: string }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const at = new Date().toISOString();
  const { error } = (await c.supabase
    .from("sales_quotes")
    .update({ seguimiento_descartado_at: at, seguimiento_descartado_motivo: motivo.trim() || null })
    .eq("id", quoteId)
    .eq("org_id", c.orgId)) as { error: { message: string; code?: string } | null };
  if (isMissingColumn(error)) return { error: "Falta la migración 0022 — corre el SQL y reintenta." };
  if (error) return { error: error.message };
  revalidatePath("/potenciales");
  return { ok: true, data: { at } };
}

export async function restoreSeguimiento(quoteId: string): Promise<Result<null>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  const { error } = (await c.supabase
    .from("sales_quotes")
    .update({ seguimiento_descartado_at: null, seguimiento_descartado_motivo: null })
    .eq("id", quoteId)
    .eq("org_id", c.orgId)) as { error: { message: string; code?: string } | null };
  if (isMissingColumn(error)) return { error: "Falta la migración 0022 — corre el SQL y reintenta." };
  if (error) return { error: error.message };
  revalidatePath("/potenciales");
  return { ok: true, data: null };
}
