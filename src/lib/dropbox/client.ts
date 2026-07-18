import "server-only";

// Cliente mínimo de la API de Dropbox usando refresh token (acceso permanente).
// Requiere env vars: DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN.

export function hasDropboxConfig(): boolean {
  return !!(process.env.DROPBOX_APP_KEY && process.env.DROPBOX_APP_SECRET && process.env.DROPBOX_REFRESH_TOKEN);
}

let tokenCache: { token: string; exp: number } | null = null;
let rootNsCache: string | null | undefined; // undefined = no resuelto; null = sin team root

async function getAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: process.env.DROPBOX_REFRESH_TOKEN!,
    client_id: process.env.DROPBOX_APP_KEY!,
    client_secret: process.env.DROPBOX_APP_SECRET!,
  });
  const res = await fetch("https://api.dropbox.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Dropbox auth ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; expires_in?: number };
  tokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 14400) * 1000 };
  return tokenCache.token;
}

// Para cuentas de equipo (Dropbox Business), las carpetas compartidas viven en
// el namespace raíz del equipo. Lo seteamos con Dropbox-API-Path-Root.
async function getRootNamespaceId(token: string): Promise<string | null> {
  if (rootNsCache !== undefined) return rootNsCache;
  try {
    const res = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    // Fallo transitorio: NO cachear el negativo — si se cacheara, toda la vida
    // de la instancia operaría sin Path-Root y una cuenta Business fallaría con
    // path/not_found en cada llamada.
    if (!res.ok) return null;
    const j = (await res.json()) as { root_info?: { root_namespace_id?: string } };
    rootNsCache = j.root_info?.root_namespace_id ?? null; // resolución REAL → cachear
  } catch {
    return null;
  }
  return rootNsCache;
}

// Dropbox exige que los headers Dropbox-API-Arg / Path-Root sean ASCII puro:
// escapamos cualquier caracter > 127 como \uXXXX. (Sin literales no-ASCII acá.)
function asciiHeader(value: unknown): string {
  const s = JSON.stringify(value);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    out += code > 127 ? "\\u" + code.toString(16).padStart(4, "0") : s[i];
  }
  return out;
}

async function rpcHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  const rootNs = await getRootNamespaceId(token);
  const h: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (rootNs) h["Dropbox-API-Path-Root"] = asciiHeader({ ".tag": "root", root: rootNs });
  return h;
}

export type DbxEntry = {
  tag: "file" | "folder";
  name: string;
  path: string;
  id: string;
  modified: string | null;
  size: number;
};

/** Lista los archivos directos de una carpeta (no recursivo). */
export async function listFolder(path: string): Promise<DbxEntry[]> {
  const headers = { ...(await rpcHeaders()), "Content-Type": "application/json" };
  const norm = path.trim().replace(/\/+$/, "");
  const out: DbxEntry[] = [];
  let cursor: string | null = null;
  do {
    const url = cursor
      ? "https://api.dropboxapi.com/2/files/list_folder/continue"
      : "https://api.dropboxapi.com/2/files/list_folder";
    const payload = cursor ? { cursor } : { path: norm === "/" ? "" : norm, recursive: false, limit: 2000 };
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(`Dropbox list ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as {
      entries: { [".tag"]: string; name: string; path_display?: string; path_lower?: string; id: string; client_modified?: string; size?: number }[];
      has_more: boolean;
      cursor: string;
    };
    for (const e of j.entries) {
      out.push({
        tag: e[".tag"] === "folder" ? "folder" : "file",
        name: e.name,
        path: e.path_display ?? e.path_lower ?? "",
        id: e.id,
        modified: e.client_modified ?? null,
        size: e.size ?? 0,
      });
    }
    cursor = j.has_more ? j.cursor : null;
  } while (cursor);
  return out;
}

/** Descarga un archivo y devuelve sus bytes. */
export async function downloadFile(path: string): Promise<Buffer> {
  const headers = { ...(await rpcHeaders()), "Dropbox-API-Arg": asciiHeader({ path }) };
  const res = await fetch("https://content.dropboxapi.com/2/files/download", { method: "POST", headers });
  if (!res.ok) throw new Error(`Dropbox download ${res.status}: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Sube un archivo. Por defecto autorename si ya existe; con overwrite lo pisa. */
export async function uploadFile(
  destPath: string,
  data: Uint8Array,
  opts?: { overwrite?: boolean },
): Promise<{ id: string; path: string; name: string }> {
  const arg = opts?.overwrite
    ? { path: destPath, mode: "overwrite", autorename: false, mute: true }
    : { path: destPath, mode: "add", autorename: true, mute: true };
  const headers = {
    ...(await rpcHeaders()),
    "Dropbox-API-Arg": asciiHeader(arg),
    "Content-Type": "application/octet-stream",
  };
  const res = await fetch("https://content.dropboxapi.com/2/files/upload", { method: "POST", headers, body: Buffer.from(data) });
  if (!res.ok) throw new Error(`Dropbox upload ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { id: string; path_display?: string; name: string };
  return { id: j.id, path: j.path_display ?? destPath, name: j.name };
}

/** Copia un archivo a otra ruta. Si el destino ya existe (409), lo trata como
 *  éxito idempotente y devuelve el path destino — así "Actualizar checklist"
 *  no acumula "Aviso (1).pdf", "Aviso (2).pdf" en cada corrida. */
export async function copyFile(fromPath: string, toPath: string): Promise<{ path: string; name: string; id: string }> {
  const headers = { ...(await rpcHeaders()), "Content-Type": "application/json" };
  const res = await fetch("https://api.dropboxapi.com/2/files/copy_v2", {
    method: "POST",
    headers,
    body: JSON.stringify({ from_path: fromPath, to_path: toPath, autorename: false }),
  });
  if (res.ok) {
    const j = (await res.json()) as { metadata: { path_display?: string; name: string; id: string } };
    return { path: j.metadata.path_display ?? toPath, name: j.metadata.name, id: j.metadata.id };
  }
  const errText = await res.text();
  if (res.status === 409 && errText.includes("conflict")) {
    return { path: toPath, name: toPath.split("/").pop() ?? toPath, id: "" }; // ya estaba copiado
  }
  throw new Error(`Dropbox copy ${res.status}: ${errText.slice(0, 200)}`);
}

/** Busca por nombre (recursivo) dentro de una ruta: archivos Y carpetas, con su
 * tag correcto. Más recientes primero (las carpetas, sin fecha, quedan al final). */
export async function searchFiles(query: string, opts?: { path?: string; maxResults?: number }): Promise<DbxEntry[]> {
  const headers = { ...(await rpcHeaders()), "Content-Type": "application/json" };
  const options: Record<string, unknown> = {
    max_results: Math.min(opts?.maxResults ?? 100, 1000),
    file_status: "active",
    filename_only: true,
  };
  if (opts?.path) options.path = opts.path.trim().replace(/\/+$/, "");
  const res = await fetch("https://api.dropboxapi.com/2/files/search_v2", {
    method: "POST",
    headers,
    body: JSON.stringify({ query, options }),
  });
  if (!res.ok) throw new Error(`Dropbox search ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as {
    matches?: {
      metadata?: {
        metadata?: { [".tag"]?: string; name?: string; path_display?: string; path_lower?: string; id?: string; server_modified?: string; size?: number };
      };
    }[];
  };
  const out: DbxEntry[] = [];
  for (const m of j.matches ?? []) {
    const md = m.metadata?.metadata;
    if (!md || !md.name) continue;
    out.push({
      tag: md[".tag"] === "folder" ? "folder" : "file",
      name: md.name,
      path: md.path_display ?? md.path_lower ?? "",
      id: md.id ?? "",
      modified: md.server_modified ?? null,
      size: md.size ?? 0,
    });
  }
  // Más recientes primero (para reutilizar la copia más nueva de un documento).
  return out.sort((a, b) => (b.modified ?? "").localeCompare(a.modified ?? ""));
}

/** Crea una carpeta (idempotente: si ya existe, devuelve su path). */
export async function createFolder(path: string): Promise<{ path: string }> {
  const headers = { ...(await rpcHeaders()), "Content-Type": "application/json" };
  const res = await fetch("https://api.dropboxapi.com/2/files/create_folder_v2", {
    method: "POST",
    headers,
    body: JSON.stringify({ path, autorename: false }),
  });
  if (res.ok) {
    const j = (await res.json()) as { metadata: { path_display?: string } };
    return { path: j.metadata.path_display ?? path };
  }
  const errText = await res.text();
  // Ya existe → OK, devolvemos el path pedido.
  if (res.status === 409 && errText.includes("conflict")) return { path };
  throw new Error(`Dropbox create_folder ${res.status}: ${errText.slice(0, 200)}`);
}

/** Link compartido (para WhatsApp/Email). Reusa el existente si ya hay uno. */
export async function getSharedLink(path: string): Promise<string> {
  const headers = { ...(await rpcHeaders()), "Content-Type": "application/json" };
  const res = await fetch("https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings", {
    method: "POST",
    headers,
    body: JSON.stringify({ path }),
  });
  if (res.ok) {
    const j = (await res.json()) as { url: string };
    return j.url;
  }
  const errText = await res.text();
  if (res.status === 409 && errText.includes("shared_link_already_exists")) {
    const res2 = await fetch("https://api.dropboxapi.com/2/sharing/list_shared_links", {
      method: "POST",
      headers,
      body: JSON.stringify({ path, direct_only: true }),
    });
    if (res2.ok) {
      const j2 = (await res2.json()) as { links: { url: string }[] };
      if (j2.links?.[0]?.url) return j2.links[0].url;
    }
  }
  throw new Error(`Dropbox shared link ${res.status}: ${errText.slice(0, 200)}`);
}
