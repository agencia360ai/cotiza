"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { hasQboConfig } from "@/lib/quickbooks/mcp";
import { fetchQboCustomers, type QboCustomer } from "@/lib/quickbooks/customers";

export type SyncSummary = {
  toolUsed: string | null;
  fetched: number;
  clientsCreated: number;
  clientsUpdated: number;
  contactsUpserted: number;
  locationsUpserted: number;
  qboProjects: number; // sub-customers que son jobs/proyectos de QBO (no se importan como sucursales)
  skipped: number;
  errors: string[];
};

type SyncResult = { ok: true; summary: SyncSummary } | { ok: false; error: string };

function norm(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFD")) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x300 && code <= 0x36f) continue; // marcas diacriticas combinantes
    out += ch;
  }
  return out.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function inChunks<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

export async function syncQuickbooksCustomers(opts?: { subCustomersAsLocations?: boolean }): Promise<SyncResult> {
  // Default OFF: en esta cuenta los sub-customers de QBO son proyectos/jobs, no
  // sucursales. Aun en ON, los IsProject nunca se importan como sucursales.
  const subAsLoc = opts?.subCustomersAsLocations ?? false;
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { ok: false, error: "Sesión expirada" };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false, error: "Sin organización" };
  if (!hasQboConfig()) return { ok: false, error: "QBO_MCP_URL no está configurada (seteala en Vercel)." };

  const errors: string[] = [];
  let fetchRes;
  try {
    fetchRes = await fetchQboCustomers();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error trayendo customers de QBO" };
  }
  const { customers, toolUsed } = fetchRes;
  if (customers.length === 0) {
    return {
      ok: true,
      summary: { toolUsed, fetched: 0, clientsCreated: 0, clientsUpdated: 0, contactsUpserted: 0, locationsUpserted: 0, qboProjects: 0, skipped: 0, errors: ["QBO no devolvió customers (o no se pudo parsear la respuesta)."] },
    };
  }

  const tops = customers.filter((c) => !c.parentId);
  const subs = customers.filter((c) => c.parentId);
  // Los jobs/proyectos de QBO (IsProject) NO son sucursales — se cuentan aparte
  // y, más adelante (Fase D), se linkean a client_projects por su número de rubro.
  const branchSubs = subs.filter((s) => !s.isProject);
  const qboProjects = subs.length - branchSubs.length;

  // Clientes existentes de la org (para match por qb_id o por nombre).
  const { data: existingClients } = (await supabase
    .from("clients")
    .select("id, qb_customer_id, name")
    .eq("org_id", orgId)) as { data: { id: string; qb_customer_id: string | null; name: string }[] | null };
  const byQb = new Map<string, string>();
  const byName = new Map<string, string>(); // norm(name) → client id (solo los sin qb_id, para adoptar)
  for (const c of existingClients ?? []) {
    if (c.qb_customer_id) byQb.set(c.qb_customer_id, c.id);
    else if (!byName.has(norm(c.name))) byName.set(norm(c.name), c.id);
  }

  const clientIdByQb = new Map<string, string>();
  let clientsCreated = 0;
  let clientsUpdated = 0;
  const nowIso = new Date().toISOString();

  function clientPatch(c: QboCustomer) {
    return {
      name: c.displayName,
      legal_name: c.companyName,
      contact_email: c.email,
      contact_phone: c.phone ?? c.mobile,
      synced_at: nowIso,
      sync_status: "synced" as const,
    };
  }

  // Particionar tops en update (qb match), adopt (name match) e insert (nuevo).
  const toUpdate: { id: string; c: QboCustomer }[] = [];
  const toInsert: QboCustomer[] = [];
  for (const c of tops) {
    const qbId = byQb.get(c.id);
    if (qbId) {
      toUpdate.push({ id: qbId, c });
      clientIdByQb.set(c.id, qbId);
      continue;
    }
    const adoptId = byName.get(norm(c.displayName));
    if (adoptId) {
      toUpdate.push({ id: adoptId, c });
      clientIdByQb.set(c.id, adoptId);
      byName.delete(norm(c.displayName)); // no reusar para otro
      continue;
    }
    toInsert.push(c);
  }

  // Inserts en bloque.
  if (toInsert.length > 0) {
    const rows = toInsert.map((c) => ({ org_id: orgId, qb_customer_id: c.id, ...clientPatch(c) }));
    const { data: ins, error } = (await supabase.from("clients").insert(rows).select("id, qb_customer_id")) as {
      data: { id: string; qb_customer_id: string | null }[] | null;
      error: { message: string } | null;
    };
    if (error) errors.push(`Insert clientes: ${error.message}`);
    for (const r of ins ?? []) {
      if (r.qb_customer_id) clientIdByQb.set(r.qb_customer_id, r.id);
    }
    clientsCreated = ins?.length ?? 0;
  }

  // Updates en paralelo (chunked). Set qb_customer_id por si fue adopción.
  await inChunks(toUpdate, 20, async ({ id, c }) => {
    const { error } = await supabase
      .from("clients")
      .update({ qb_customer_id: c.id, ...clientPatch(c) })
      .eq("id", id);
    if (error) errors.push(`Update ${c.displayName}: ${error.message}`);
    else clientsUpdated++;
  });

  // ── Contactos primarios ────────────────────────────────────────────────
  const clientIds = Array.from(clientIdByQb.values());
  const primaryByClient = new Map<string, string>(); // client_id → contact id
  if (clientIds.length > 0) {
    const { data: existingContacts } = (await supabase
      .from("client_contacts")
      .select("id, client_id")
      .eq("is_primary", true)
      .in("client_id", clientIds)) as { data: { id: string; client_id: string }[] | null };
    for (const r of existingContacts ?? []) primaryByClient.set(r.client_id, r.id);
  }

  let contactsUpserted = 0;
  const withContact = tops.filter((c) => c.email || c.phone || c.mobile || c.contactName);
  const contactInserts: Record<string, unknown>[] = [];
  const contactUpdates: { id: string; c: QboCustomer }[] = [];
  for (const c of withContact) {
    const clientId = clientIdByQb.get(c.id);
    if (!clientId) continue;
    const existing = primaryByClient.get(clientId);
    if (existing) contactUpdates.push({ id: existing, c });
    else
      contactInserts.push({
        org_id: orgId,
        client_id: clientId,
        name: c.contactName ?? c.displayName,
        email: c.email,
        phone: c.phone ?? c.mobile,
        is_primary: true,
        source: "quickbooks",
      });
  }
  if (contactInserts.length > 0) {
    const { error } = await supabase.from("client_contacts").insert(contactInserts);
    if (error) errors.push(`Insert contactos: ${error.message}`);
    else contactsUpserted += contactInserts.length;
  }
  await inChunks(contactUpdates, 20, async ({ id, c }) => {
    const { error } = await supabase
      .from("client_contacts")
      .update({ name: c.contactName ?? c.displayName, email: c.email, phone: c.phone ?? c.mobile, source: "quickbooks" })
      .eq("id", id);
    if (error) errors.push(`Update contacto ${c.displayName}: ${error.message}`);
    else contactsUpserted++;
  });

  // ── Sub-customers → sucursales (client_locations) ──────────────────────
  let locationsUpserted = 0;
  let skipped = 0;
  if (subAsLoc && branchSubs.length > 0) {
    const subIds = branchSubs.map((s) => s.id);
    const { data: existingLocs } = (await supabase
      .from("client_locations")
      .select("id, qb_sub_customer_id")
      .in("qb_sub_customer_id", subIds)) as { data: { id: string; qb_sub_customer_id: string | null }[] | null };
    const locByQb = new Map<string, string>();
    for (const r of existingLocs ?? []) if (r.qb_sub_customer_id) locByQb.set(r.qb_sub_customer_id, r.id);

    const locInserts: Record<string, unknown>[] = [];
    const locUpdates: { id: string; name: string }[] = [];
    for (const s of branchSubs) {
      const parentClientId = s.parentId ? clientIdByQb.get(s.parentId) : undefined;
      if (!parentClientId) {
        skipped++; // padre no sincronizado (o sub-customer anidado)
        continue;
      }
      const leaf = s.fullyQualifiedName?.includes(":") ? s.fullyQualifiedName.split(":").pop()!.trim() : s.displayName;
      const existing = locByQb.get(s.id);
      if (existing) locUpdates.push({ id: existing, name: leaf });
      else locInserts.push({ client_id: parentClientId, name: leaf, qb_sub_customer_id: s.id });
    }
    if (locInserts.length > 0) {
      const { error } = await supabase.from("client_locations").insert(locInserts);
      if (error) errors.push(`Insert sucursales: ${error.message}`);
      else locationsUpserted += locInserts.length;
    }
    await inChunks(locUpdates, 20, async ({ id, name }) => {
      const { error } = await supabase.from("client_locations").update({ name }).eq("id", id);
      if (error) errors.push(`Update sucursal: ${error.message}`);
      else locationsUpserted++;
    });
  }

  revalidatePath("/maintenance/clients");
  return {
    ok: true,
    summary: { toolUsed, fetched: customers.length, clientsCreated, clientsUpdated, contactsUpserted, locationsUpserted, qboProjects, skipped, errors: errors.slice(0, 12) },
  };
}
