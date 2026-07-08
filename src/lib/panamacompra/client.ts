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
// en maxPages para no colgar el serverless; `truncado` avisa si el corte fue
// por tope (quedaban páginas) para poder auditar cobertura.
export async function pcListProcesos(
  session: PcSession,
  opts: {
    idEstado: string;
    idTipoProceso: string;
    enviada?: string;
    maxPages?: number;
    // Incremental: si una página entera ya es conocida, corta (lo nuevo sale primero).
    shouldStop?: (pageNums: string[]) => boolean;
  },
): Promise<{ registros: PcRegistro[]; truncado: boolean }> {
  const out: PcRegistro[] = [];
  let valorSiguiente = "";
  let truncado = false;
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
    if (opts.shouldStop) {
      const nums = regs.map((r) => (r.numProcesoOriginal || r.numProceso || "").trim()).filter(Boolean);
      if (nums.length > 0 && opts.shouldStop(nums)) break;
    }
    if (page === maxPages - 1) truncado = true; // quedaban páginas después del tope
    valorSiguiente = next;
  }
  return { registros: out, truncado };
}

// Detalle del pliego (componentes de página). Devuelve el JSON crudo; el
// precio de referencia se extrae buscando la clave recursivamente (el shape
// exacto varía por tipo de proceso — patrón adaptativo, se valida en vivo).
// LANZA en errores transitorios (401 token vencido / 5xx / rate-limit) para no
// confundirlos con "el pliego no existe"; devuelve null solo en 404/respuesta
// vacía. Así el backfill reintenta lo transitorio en vez de marcarlo "sin precio".
export async function pcPliegoRaw(session: PcSession, idTipoProceso: string, idFlujos: string): Promise<unknown | null> {
  const res = await fetch(`${BASE}/procesos-configuracion/pagina-componentes/${idTipoProceso}/procesoVistaPliego/${idFlujos}`, {
    method: "GET",
    headers: baseHeaders(session),
    cache: "no-store",
  });
  if (!res.ok) {
    if (res.status === 404) return null; // el pliego genuinamente no está
    throw new Error(`PanamaCompra pliego HTTP ${res.status}`); // transitorio → reintentar
  }
  return res.json().catch(() => null);
}

// ── Precio de referencia del proceso ──────────────────────────────────────────
// El pliego trae DOS niveles de precio: el "precio estimado" del proceso (el
// total correcto) y un "precio referencia" POR RENGLÓN. Buscar la primera clave
// que suene a precio devuelve el primer renglón (ej: $90.00 de una bomba en un
// proceso de B/. 244.70). Orden correcto:
//   1. (precio|monto)estimado a nivel proceso → ese es el total.
//   2. Sin estimado: sumar los precio*ref de los renglones (la columna del
//      pliego suma exactamente el total del proceso).
//   3. Último recurso: el primer precio*ref suelto.

function parseNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.]/g, ""));
  return !Number.isNaN(n) && n > 0 ? n : null;
}

function findFirstByKey(node: unknown, keyRe: RegExp, depth = 0): number | null {
  if (node == null || depth > 8) return null;
  if (Array.isArray(node)) {
    for (const it of node) {
      const v = findFirstByKey(it, keyRe, depth + 1);
      if (v !== null) return v;
    }
    return null;
  }
  if (typeof node === "object") {
    const o = node as Record<string, unknown>;
    for (const [k, v] of Object.entries(o)) {
      if (keyRe.test(k.replace(/[_\s]/g, ""))) {
        const n = parseNum(v);
        if (n !== null) return n;
      }
    }
    for (const v of Object.values(o)) {
      const r = findFirstByKey(v, keyRe, depth + 1);
      if (r !== null) return r;
    }
  }
  return null;
}

const RE_PRECIO_REF = /precio.*ref/i;
const RE_PRECIO_REF_TOTAL = /precio.*ref.*(total|reng|linea|item)/i;
const RE_UNITARIO = /unitari/i;

// Claves que representan un MONTO de referencia/estimado/total del proceso o de
// un renglón. El total del proceso = la suma de los renglones = el MAYOR de
// estos valores (el total siempre ≥ cualquier renglón). Excluye montos que no
// son el precio (fianza, %, ITBMS, partida presupuestaria, cantidades).
// Estrictamente el "precio de referencia/estimado" de renglón o proceso. NO se
// amplía a "presupuesto"/"monto proceso" para no agarrar montos ajenos (partida
// del depto, etc.) que inflarían el total.
const RE_PRICE_LIKE = /(precio.*ref|estimad|montoreferencia|totalreferencia)/i;
const RE_PRICE_EXCLUDE = /(unitari|fianza|garant|porcentaje|itbms|impuesto|partida|saldo|disponible|cantidad|subsan)/i;

// Todos los montos "precio-like" del documento (renglones + total si existe).
function collectPriceLike(node: unknown, out: { key: string; value: number }[] = [], depth = 0): { key: string; value: number }[] {
  if (node == null || depth > 12) return out;
  if (Array.isArray(node)) {
    for (const it of node) collectPriceLike(it, out, depth + 1);
    return out;
  }
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const nk = k.replace(/[_\s]/g, "");
      if (RE_PRICE_LIKE.test(nk) && !RE_PRICE_EXCLUDE.test(nk)) {
        const n = parseNum(v);
        if (n !== null) out.push({ key: k, value: n });
      }
      collectPriceLike(v, out, depth + 1);
    }
  }
  return out;
}

// precio de referencia de UN renglón: preferí el total del renglón; nunca el
// unitario suelto (subvaluaría cuando cantidad>1).
function precioDeRenglon(it: Record<string, unknown>): number | null {
  const total = findFirstByKey(it, RE_PRECIO_REF_TOTAL, 6);
  if (total !== null) return total;
  for (const [k, v] of Object.entries(it)) {
    const nk = k.replace(/[_\s]/g, "");
    if (RE_PRECIO_REF.test(nk) && !RE_UNITARIO.test(nk)) {
      const n = parseNum(v);
      if (n !== null) return n;
    }
  }
  return null;
}

// Primer array cuyos elementos (objetos) traen su propio precio*ref = renglones.
function findItemsArray(node: unknown, depth = 0): Record<string, unknown>[] | null {
  if (node == null || depth > 8) return null;
  if (Array.isArray(node)) {
    const objs = node.filter((it): it is Record<string, unknown> => !!it && typeof it === "object" && !Array.isArray(it));
    if (objs.length > 0 && objs.some((it) => findFirstByKey(it, RE_PRECIO_REF, 6) !== null)) return objs;
    for (const it of node) {
      const r = findItemsArray(it, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (typeof node === "object") {
    for (const v of Object.values(node as Record<string, unknown>)) {
      const r = findItemsArray(v, depth + 1);
      if (r) return r;
    }
  }
  return null;
}

// ¿La descripción del renglón es una fila "TOTAL" resumen (no un ítem real)?
function esFilaTotal(it: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(it)) {
    if (/descripcion|nombre|detalle/i.test(k) && typeof v === "string" && /^\s*(sub)?total\b/i.test(v)) return true;
  }
  return false;
}

export type PrecioBreakdown = {
  elegido: number | null;
  metodo: "total_explicito" | "suma_renglones" | "unico" | null;
  maxRef: number | null; // mayor monto "precio-like" encontrado
  suma: number | null; // suma de TODOS los montos precio-like
  nValores: number; // cuántos montos precio-like se encontraron
  candidatos: { key: string; value: number }[]; // valores precio-like (diagnóstico)
};

// Núcleo auditable del precio de referencia del proceso.
//
// El pliego guarda el precio de referencia POR RENGLÓN (ej. chiller 141,082.40 +
// mano de obra 35,270.60). El TOTAL del proceso (176,353.09) casi nunca está como
// campo aparte → es la SUMA de los renglones. Pero algunos pliegos SÍ traen un
// total explícito además de los renglones; sumar todo doble-contaría.
//
// Regla (sobre los montos precio-like ordenados desc):
//   - Si el mayor = suma de los demás (y hay ≥2 "demás") → es el total explícito.
//   - Si no → total = suma de todos los renglones.
export function extractPrecioBreakdown(node: unknown): PrecioBreakdown {
  const priceLike = collectPriceLike(node);
  const candidatos = [...priceLike].sort((a, b) => b.value - a.value).slice(0, 12);
  const valores = priceLike.map((p) => p.value).sort((a, b) => b - a);
  const round2 = (n: number) => Math.round(n * 100) / 100;

  if (valores.length === 0) return { elegido: null, metodo: null, maxRef: null, suma: null, nValores: 0, candidatos };

  const maxRef = valores[0];
  const suma = round2(valores.reduce((a, b) => a + b, 0));

  if (valores.length === 1) {
    return { elegido: maxRef, metodo: "unico", maxRef, suma, nValores: 1, candidatos };
  }

  const restante = round2(suma - maxRef);
  // El mayor valor = suma de los demás (≥2 renglones) ⇒ total explícito.
  if (valores.length >= 3 && Math.abs(maxRef - restante) < 0.5) {
    return { elegido: maxRef, metodo: "total_explicito", maxRef, suma, nValores: valores.length, candidatos };
  }
  // Si no, el total = la suma de todos los renglones.
  return { elegido: suma, metodo: "suma_renglones", maxRef, suma, nValores: valores.length, candidatos };
}

export function extractPrecioRef(node: unknown): number | null {
  return extractPrecioBreakdown(node).elegido;
}

// ── Renglones del pliego (para la evaluación IA de "¿cumplimos?") ─────────────

function findFirstString(node: unknown, keyRe: RegExp, depth = 0): string | null {
  if (node == null || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const it of node) {
      const v = findFirstString(it, keyRe, depth + 1);
      if (v !== null) return v;
    }
    return null;
  }
  if (typeof node === "object") {
    const o = node as Record<string, unknown>;
    for (const [k, v] of Object.entries(o)) {
      if (keyRe.test(k.replace(/[_\s]/g, "")) && typeof v === "string" && v.trim().length > 1) return v.trim();
    }
    for (const v of Object.values(o)) {
      const r = findFirstString(v, keyRe, depth + 1);
      if (r !== null) return r;
    }
  }
  return null;
}

export type PliegoItem = { descripcion: string; cantidad: number | null; unidad: string | null; precioRef: number | null };

export function extractItems(node: unknown): PliegoItem[] {
  const arr = findItemsArray(node);
  if (!arr) return [];
  return arr
    .slice(0, 40)
    .map((it) => ({
      descripcion: findFirstString(it, /descripcion|nombre|detalle|titulo/i) ?? "",
      cantidad: findFirstByKey(it, /^cantidad/i, 4),
      unidad: findFirstString(it, /unidad/i),
      precioRef: findFirstByKey(it, RE_PRECIO_REF, 6),
    }))
    .filter((i) => i.descripcion.length > 1);
}

// ── Detalle completo del pliego (para evaluar si podemos licitar) ─────────────
// Extracción best-effort por patrones de clave (el pliego es un árbol de
// componentes con nombres etiquetados). Devuelve lo que encuentra; los campos
// que no matcheen quedan null y la UI los omite.
export type GovDetalle = {
  objeto: string | null;
  descripcion: string | null;
  modalidadAdjudicacion: string | null;
  formaEntrega: string | null;
  formaPago: string | null;
  provinciaEntrega: string | null;
  fechaPublicacion: string | null;
  contacto: { nombre: string | null; cargo: string | null; telefono: string | null; correo: string | null };
  entidad: { dependencia: string | null; unidadCompra: string | null; provincia: string | null; direccion: string | null };
  items: PliegoItem[];
  at: string;
};

export function extractDetalle(node: unknown, nowIso: string): GovDetalle {
  return {
    objeto: findFirstString(node, /objetocontratacion|objetodecontratacion|^objeto/i),
    descripcion: findFirstString(node, /^descripcion$|descripciongeneral|descripcionproceso/i),
    modalidadAdjudicacion: findFirstString(node, /modalidadadjudicacion|modalidaddeadjudicacion/i),
    formaEntrega: findFirstString(node, /formaentrega|formadeentrega/i),
    formaPago: findFirstString(node, /formapago|formadepago/i),
    provinciaEntrega: findFirstString(node, /provinciaentrega|provinciadeentrega/i),
    fechaPublicacion: findFirstString(node, /fechapublicacion|fechadepublicacion/i),
    contacto: {
      nombre: findFirstString(node, /nombrecontacto|contactonombre|nombreunidad/i),
      cargo: findFirstString(node, /^cargo$|cargocontacto/i),
      telefono: findFirstString(node, /telefono|celular/i),
      correo: findFirstString(node, /correo|email|^mail/i),
    },
    entidad: {
      dependencia: findFirstString(node, /dependencia/i),
      unidadCompra: findFirstString(node, /unidadcompra|unidaddecompra/i),
      provincia: findFirstString(node, /^provincia$/i),
      direccion: findFirstString(node, /direccion/i),
    },
    items: extractItems(node),
    at: nowIso,
  };
}
