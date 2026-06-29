"use server";

import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { hasDropboxConfig, listFolder, moveFile } from "@/lib/dropbox/client";

type Result<T> = { error: string } | { ok: true; data: T };

const PDF_IMG = /\.(pdf|png|jpe?g|webp)$/i;

async function ctx() {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { ok: false as const, error: "Sesión expirada" };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false as const, error: "Sin organización" };
  return { ok: true as const, supabase, orgId };
}

type MatchedQuote = {
  quote_number: string;
  client_name: string | null;
  client_std_name: string | null;
  location_name: string | null;
  description: string | null;
};

function sanitize(s: string): string {
  // Dropbox/FS: sin / \ : * ? " < > | ; colapsar espacios.
  return s.replace(/[/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
}

// "COT DC 26-101 Rev 2" → { rubro, yy, seq, letter, rev }
function parseNum(raw: string) {
  const m = raw.match(/COT\s+([A-Za-z]{1,3})\s+(\d{2})-(\d{1,4})([A-Za-z])?(?:\s+(?:rev\.?\s*(\d+)|r(\d+(?:\.\d+)?)))?/i);
  if (!m) return null;
  return { rubro: m[1].toUpperCase(), yy: m[2], seq: m[3], letter: (m[4] ?? "").toUpperCase(), rev: m[5] ?? m[6] ?? null };
}

// Nombre canónico: "COT DC 26-009 · Cliente – Sucursal · Descripción.pdf".
// El número va con 3 dígitos (cero a la izquierda) para que ordene bien.
function buildCanonical(originalName: string, q: MatchedQuote | null): string | null {
  const extM = originalName.match(PDF_IMG);
  const ext = extM ? extM[1].toLowerCase() : "pdf";
  const p = (q?.quote_number ? parseNum(q.quote_number) : null) ?? parseNum(originalName);
  if (!p) return null; // sin número no podemos ordenar
  let prefix = `COT ${p.rubro} ${p.yy}-${p.seq.padStart(3, "0")}${p.letter}`;
  if (p.rev) prefix += ` Rev ${p.rev}`;
  const client = q ? sanitize(q.client_std_name ?? q.client_name ?? "") : "";
  const loc = q?.location_name ? sanitize(q.location_name) : "";
  let desc = q?.description ? sanitize(q.description) : "";
  if (desc.length > 60) desc = desc.slice(0, 57).trim() + "…";
  const parts = [prefix];
  if (client) parts.push(loc ? `${client} – ${loc}` : client);
  if (desc) parts.push(desc);
  return `${parts.join(" · ")}.${ext}`;
}

export type RenameItem = {
  fileId: string;
  fromPath: string;
  fromName: string;
  toName: string;
  changed: boolean;
  matched: boolean;
};

export async function listDropboxRenames(folder: string): Promise<Result<{ files: RenameItem[] }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  if (!hasDropboxConfig()) return { error: "Dropbox no está configurado (faltan las env vars)." };
  try {
    const entries = await listFolder(folder);
    const files = entries.filter((e) => e.tag === "file" && PDF_IMG.test(e.name));

    const byId = new Map<string, MatchedQuote>();
    const ids = files.map((f) => f.id);
    if (ids.length > 0) {
      const { data } = (await c.supabase
        .from("sales_quotes")
        .select("dropbox_file_id, quote_number, client_name, description, client:clients(name), location:client_locations(name)")
        .eq("org_id", c.orgId)
        .in("dropbox_file_id", ids)) as {
        data:
          | {
              dropbox_file_id: string | null;
              quote_number: string;
              client_name: string | null;
              description: string | null;
              client: { name: string } | null;
              location: { name: string } | null;
            }[]
          | null;
      };
      for (const r of data ?? []) {
        if (!r.dropbox_file_id) continue;
        byId.set(r.dropbox_file_id, {
          quote_number: r.quote_number,
          client_name: r.client_name,
          client_std_name: r.client?.name ?? null,
          location_name: r.location?.name ?? null,
          description: r.description,
        });
      }
    }

    const items: RenameItem[] = files
      .map((f) => {
        const q = byId.get(f.id) ?? null;
        const toName = buildCanonical(f.name, q) ?? f.name;
        return { fileId: f.id, fromPath: f.path, fromName: f.name, toName, changed: toName !== f.name, matched: !!q };
      })
      .sort((a, b) => a.toName.localeCompare(b.toName));

    return { ok: true, data: { files: items } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Error listando Dropbox" };
  }
}

export async function applyDropboxRename(fileId: string, fromPath: string, toName: string): Promise<Result<{ newPath: string }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  if (!hasDropboxConfig()) return { error: "Dropbox no configurado." };
  try {
    const slash = fromPath.lastIndexOf("/");
    const folder = slash >= 0 ? fromPath.slice(0, slash) : "";
    const toPath = `${folder}/${toName}`;
    if (toPath === fromPath) return { ok: true, data: { newPath: fromPath } };
    const newPath = await moveFile(fromPath, toPath);
    // Mantener el path en sync (el file-id es estable, el dedup no se rompe).
    await c.supabase
      .from("sales_quotes")
      .update({ dropbox_path: newPath })
      .eq("org_id", c.orgId)
      .eq("dropbox_file_id", fileId);
    return { ok: true, data: { newPath } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Error renombrando" };
  }
}
