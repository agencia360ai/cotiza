import "server-only";

// Cliente de la API v3 de PanamaCompra (apisv3.panamacompra.gob.pa), portado
// del tool Java PanamaLicita de DICEC. Login con la cuenta de proveedor
// (PANAMACOMPRA_USER/PASSWORD) → cookie userToken/userSesionId → búsqueda
// paginada de procesos. Corre en Vercel; no requiere servidor propio.

const BASE = "https://apisv3.panamacompra.gob.pa";

export function hasPanamaCompraConfig(): boolean {
  return !!(process.env.PANAMACOMPRA_USER && process.env.PANAMACOMPRA_PASSWORD);
}

// Headers que la API espera (mismos que el navegador del sitio oficial).
function baseHeaders(session?: { userToken: string; userSesionId: string }): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/json;charset=utf-8",
    "Accept-Language": "en-US,en;q=0.9,es-ES;q=0.8,es;q=0.7",
    "Cache-Control": "no-cache",
    "Content-Type": "application/json;charset=utf-8",
    Origin: "https://www.panamacompra.gob.pa",
    Pragma: "no-cache",
    Referer: "https://www.panamacompra.gob.pa/",
    "Sec-Ch-Ua": '"Not A(Brand";v="8", "Chromium";v="132", "Google Chrome";v="132"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
  };
  if (session) h.cookie = `userToken=${session.userToken}; userSesionId=${session.userSesionId}`;
  return h;
}

export type PcSession = { userToken: string; userSesionId: string };

export async function pcLogin(): Promise<PcSession> {
  // trim(): un espacio/salto de línea al pegar la env var rompe el login.
  const user = process.env.PANAMACOMPRA_USER?.trim();
  const pass = process.env.PANAMACOMPRA_PASSWORD?.trim();
  if (!user || !pass) throw new Error("Faltan PANAMACOMPRA_USER / PANAMACOMPRA_PASSWORD");
  const res = await fetch(`${BASE}/autenticacion/ingresar`, {
    method: "POST",
    headers: baseHeaders(),
    body: JSON.stringify({ usuario: user, contrasena: pass }),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PanamaCompra login HTTP ${res.status}: ${text.slice(0, 200)}`);
  let j: { result?: { userToken?: string; userSesionId?: string } } = {};
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(`PanamaCompra: respuesta no-JSON al login: ${text.slice(0, 200)}`);
  }
  if (!j.result?.userToken || !j.result?.userSesionId) {
    // Mostrar qué contestó (mensaje de error del gobierno) sin exponer secretos.
    throw new Error(`PanamaCompra: login sin token. Respuesta: ${text.slice(0, 300)}`);
  }
  return { userToken: j.result.userToken, userSesionId: j.result.userSesionId };
}

export type PcRegistro = {
  idProcesosContratacion?: string;
  numProceso?: string;
  numProcesoOriginal?: string;
  titulo?: string;
  nombre?: string; // entidad
  fechaCierre?: string;
  idProcesosContratacionFlujos?: string;
  idProcesosOfertasRegistros?: string;
  [k: string]: unknown;
};

// Lista paginada de procesos. idEstado 36 = Vigente · idTipoProceso 7 =
// Licitación Pública (los valores del tool original). Corta por seguridad
// en maxPages para no colgar el serverless.
export async function pcListProcesos(
  session: PcSession,
  opts: { idEstado: string; idTipoProceso: string; enviada?: string; maxPages?: number },
): Promise<PcRegistro[]> {
  const out: PcRegistro[] = [];
  let valorSiguiente = "";
  const maxPages = opts.maxPages ?? 10;
  for (let page = 0; page < maxPages; page++) {
    const filtro: Record<string, number> = {
      idEstado: Number(opts.idEstado),
      idTipoProceso: Number(opts.idTipoProceso),
    };
    if (opts.enviada !== undefined) filtro.enviada = Number(opts.enviada);
    const res = await fetch(`${BASE}/busqueda/proceso-lista`, {
      method: "POST",
      headers: baseHeaders(session),
      body: JSON.stringify({ registrosPorPagina: 50, valorSiguiente, filtro }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`PanamaCompra lista ${res.status}`);
    const j = (await res.json()) as {
      result?: { registros?: PcRegistro[]; valorInicial?: string | null };
    };
    const regs = j.result?.registros ?? [];
    out.push(...regs);
    const next = j.result?.valorInicial;
    if (!next || regs.length === 0) break;
    valorSiguiente = next;
  }
  return out;
}

// Detalle del pliego (componentes de página). Devuelve el JSON crudo; el
// precio de referencia se extrae buscando la clave recursivamente (el shape
// exacto varía por tipo de proceso — patrón adaptativo, se valida en vivo).
export async function pcPliegoRaw(session: PcSession, idTipoProceso: string, idFlujos: string): Promise<unknown | null> {
  const res = await fetch(`${BASE}/procesos-configuracion/pagina-componentes/${idTipoProceso}/procesoVistaPliego/${idFlujos}`, {
    method: "GET",
    headers: baseHeaders(session),
    cache: "no-store",
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

// Busca recursivamente un valor numérico cuya clave matchee /precio.*ref/i.
export function extractPrecioRef(node: unknown, depth = 0): number | null {
  if (node == null || depth > 8) return null;
  if (Array.isArray(node)) {
    for (const it of node) {
      const v = extractPrecioRef(it, depth + 1);
      if (v !== null) return v;
    }
    return null;
  }
  if (typeof node === "object") {
    const o = node as Record<string, unknown>;
    for (const [k, v] of Object.entries(o)) {
      if (/precio.*ref|montoestimado|precioestimado/i.test(k.replace(/[_\s]/g, ""))) {
        const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.]/g, ""));
        if (!Number.isNaN(n) && n > 0) return n;
      }
    }
    for (const v of Object.values(o)) {
      const r = extractPrecioRef(v, depth + 1);
      if (r !== null) return r;
    }
  }
  return null;
}
