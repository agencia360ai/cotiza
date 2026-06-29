"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { norm } from "@/lib/clients/normalize";
import { clusterClientNames, type NameCluster } from "@/lib/clients/cluster";

async function ctx() {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { ok: false as const, error: "Sesión expirada" };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false as const, error: "Sin organización" };
  return { ok: true as const, supabase, orgId };
}

// Junta los nombres distintos (exactos) de cotizaciones + licitaciones con su conteo.
async function gatherLooseNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
): Promise<{ name: string; count: number }[]> {
  const counts = new Map<string, number>();
  // Clave = valor EXACTO de la BD (sin trim) para que el linkeo por .in() matchee.
  const add = (raw: string | null) => {
    if (!raw || !raw.trim()) return;
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  };
  const { data: q } = (await supabase.from("sales_quotes").select("client_name").eq("org_id", orgId)) as {
    data: { client_name: string | null }[] | null;
  };
  for (const r of q ?? []) add(r.client_name);
  const { data: t } = (await supabase.from("tenders").select("entity").eq("org_id", orgId)) as {
    data: { entity: string | null }[] | null;
  };
  for (const r of t ?? []) add(r.entity);
  return Array.from(counts, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

export type AnalyzeResult =
  | { ok: true; clusters: NameCluster[]; counts: Record<string, number>; total: number }
  | { ok: false; error: string };

export async function analyzeClientNames(): Promise<AnalyzeResult> {
  const c = await ctx();
  if (!c.ok) return { ok: false, error: c.error };
  const names = await gatherLooseNames(c.supabase, c.orgId);
  if (names.length === 0) return { ok: false, error: "No hay nombres de cliente para analizar." };
  try {
    const clusters = await clusterClientNames(names);
    const counts: Record<string, number> = {};
    for (const n of names) counts[n.name] = n.count;
    return { ok: true, clusters, counts, total: names.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error analizando con IA" };
  }
}

export type ConfirmedCluster = {
  canonical: string;
  category: string | null;
  existingClientId: string | null;
  members: { name: string; branch: string | null }[];
};

export type ApplySummary = {
  clientsCreated: number;
  clientsReused: number;
  aliases: number;
  locations: number;
  quotesLinked: number;
  tendersLinked: number;
  errors: string[];
};

type ApplyResult = { ok: true; summary: ApplySummary } | { ok: false; error: string };

export async function applyStandardization(clusters: ConfirmedCluster[]): Promise<ApplyResult> {
  const c = await ctx();
  if (!c.ok) return { ok: false, error: c.error };
  const { supabase, orgId } = c;
  const errors: string[] = [];
  const summary: ApplySummary = { clientsCreated: 0, clientsReused: 0, aliases: 0, locations: 0, quotesLinked: 0, tendersLinked: 0, errors };

  // Clientes existentes por nombre normalizado, para reusar en vez de duplicar.
  const { data: existing } = (await supabase.from("clients").select("id, name").eq("org_id", orgId)) as {
    data: { id: string; name: string }[] | null;
  };
  const byNorm = new Map<string, string>();
  for (const r of existing ?? []) if (!byNorm.has(norm(r.name))) byNorm.set(norm(r.name), r.id);

  // ¿La columna location_id ya existe? (migración 0005). Si no, linkeamos solo
  // client_id y no rompemos el flujo previo.
  const locProbe = await supabase.from("sales_quotes").select("location_id").limit(1);
  const locSupported = !locProbe.error;

  for (const cl of clusters) {
    const canonical = cl.canonical.trim();
    const members = cl.members.filter((m) => m.name.trim().length > 0);
    if (!canonical || members.length === 0) continue;

    // 1) Resolver cliente.
    let clientId: string | null = cl.existingClientId ?? null;
    if (clientId) summary.clientsReused++;
    else {
      const hit = byNorm.get(norm(canonical));
      if (hit) {
        clientId = hit;
        summary.clientsReused++;
      } else {
        const { data: ins, error } = (await supabase
          .from("clients")
          .insert({ org_id: orgId, name: canonical, category: cl.category })
          .select("id")
          .single()) as { data: { id: string } | null; error: { message: string } | null };
        if (error || !ins) {
          errors.push(`Crear cliente "${canonical}": ${error?.message ?? "falló"}`);
          continue;
        }
        clientId = ins.id;
        byNorm.set(norm(canonical), clientId);
        summary.clientsCreated++;
      }
    }

    // 2) Sucursales detectadas → client_locations; capturamos el id de cada una.
    const branchNames = Array.from(new Set(members.map((m) => m.branch?.trim()).filter((b): b is string => !!b)));
    const locIdByBranch = new Map<string, string>(); // norm(branch) → location id
    if (branchNames.length > 0) {
      const { data: locs } = (await supabase.from("client_locations").select("id, name").eq("client_id", clientId)) as {
        data: { id: string; name: string }[] | null;
      };
      for (const l of locs ?? []) locIdByBranch.set(norm(l.name), l.id);
      const toAdd = branchNames.filter((b) => !locIdByBranch.has(norm(b))).map((name) => ({ client_id: clientId, name }));
      if (toAdd.length > 0) {
        const { data: ins, error } = (await supabase.from("client_locations").insert(toAdd).select("id, name")) as {
          data: { id: string; name: string }[] | null;
          error: { message: string } | null;
        };
        if (error) errors.push(`Sucursales de "${canonical}": ${error.message}`);
        else {
          for (const l of ins ?? []) locIdByBranch.set(norm(l.name), l.id);
          summary.locations += ins?.length ?? 0;
        }
      }
    }
    const locFor = (m: { branch: string | null }) => (m.branch ? locIdByBranch.get(norm(m.branch)) ?? null : null);

    // 3) Aliases (un alias por nombre miembro), con su sucursal si corresponde.
    const aliasRows = members.map((m) => ({
      org_id: orgId,
      client_id: clientId,
      alias_norm: norm(m.name),
      location_id: locFor(m),
      source: "excel",
    }));
    if (aliasRows.length > 0) {
      const { error } = await supabase
        .from("client_aliases")
        .upsert(aliasRows, { onConflict: "org_id,alias_norm", ignoreDuplicates: true });
      if (error) errors.push(`Aliases de "${canonical}": ${error.message}`);
      else summary.aliases += aliasRows.length;
    }

    // 4) Linkear cotizaciones/licitaciones por grupo de sucursal (client_id + location_id).
    const byLoc = new Map<string | null, string[]>();
    for (const m of members) {
      const lid = locFor(m);
      const arr = byLoc.get(lid) ?? [];
      arr.push(m.name);
      byLoc.set(lid, arr);
    }
    for (const [locId, names] of byLoc) {
      const quotePatch = locSupported ? { client_id: clientId, location_id: locId } : { client_id: clientId };
      {
        const { data, error } = (await supabase
          .from("sales_quotes")
          .update(quotePatch)
          .eq("org_id", orgId)
          .in("client_name", names)
          .select("id")) as { data: { id: string }[] | null; error: { message: string } | null };
        if (error) errors.push(`Linkear cotizaciones de "${canonical}": ${error.message}`);
        else summary.quotesLinked += data?.length ?? 0;
      }
      {
        const { data, error } = (await supabase
          .from("tenders")
          .update(quotePatch)
          .eq("org_id", orgId)
          .in("entity", names)
          .select("id")) as { data: { id: string }[] | null; error: { message: string } | null };
        if (error) errors.push(`Linkear licitaciones de "${canonical}": ${error.message}`);
        else summary.tendersLinked += data?.length ?? 0;
      }
    }
  }

  summary.errors = errors.slice(0, 12);
  revalidatePath("/clientes");
  revalidatePath("/clientes/standardize");
  return { ok: true, summary };
}
