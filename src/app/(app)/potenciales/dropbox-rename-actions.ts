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

// NO destructivo: solo padea el número de secuencia a 3 dígitos (para que ordene
// bien) y limpia espacios. Conserva TODO el resto del nombre (cliente,
// descripción, revisión) tal como está. No borra nada.
function buildCanonical(originalName: string): string {
  const dot = originalName.lastIndexOf(".");
  const ext = dot >= 0 ? originalName.slice(dot).toLowerCase() : "";
  let base = dot >= 0 ? originalName.slice(0, dot) : originalName;
  base = base.replace(/(COT\s+[A-Za-z]{1,3}\s+\d{2}-)(\d{1,4})/i, (_m, prefix, seq) => prefix + seq.padStart(3, "0"));
  base = base.replace(/\s+/g, " ").trim();
  return base + ext;
}

export type RenameItem = {
  fileId: string;
  fromPath: string;
  fromName: string;
  toName: string;
  changed: boolean;
};

export async function listDropboxRenames(folder: string): Promise<Result<{ files: RenameItem[] }>> {
  const c = await ctx();
  if (!c.ok) return { error: c.error };
  if (!hasDropboxConfig()) return { error: "Dropbox no está configurado (faltan las env vars)." };
  try {
    const entries = await listFolder(folder);
    const files = entries.filter((e) => e.tag === "file" && PDF_IMG.test(e.name));
    const items: RenameItem[] = files
      .map((f) => {
        const toName = buildCanonical(f.name);
        return { fileId: f.id, fromPath: f.path, fromName: f.name, toName, changed: toName !== f.name };
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
    // Mantener el path en sync si la cotización vino de Dropbox (file-id estable).
    await c.supabase.from("sales_quotes").update({ dropbox_path: newPath }).eq("org_id", c.orgId).eq("dropbox_file_id", fileId);
    return { ok: true, data: { newPath } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Error renombrando" };
  }
}
