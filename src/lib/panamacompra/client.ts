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
    // El gobierno a veces cuelga la conexión sin responder: sin timeout, una
    // sola request colgada se come el maxDuration entero de la función.
    signal: AbortSignal.timeout(25_000),
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

// Login con cache por instancia (~10 min). Evita re-loguear en cada archivo
// cuando la descarga de documentos hace una acción por archivo.
let pcSessionCache: { session: PcSession; exp: number } | null = null;
export async function pcLoginCached(): Promise<PcSession> {
  if (pcSessionCache && pcSessionCache.exp > Date.now()) return pcSessionCache.session;
  const session = await pcLogin();
  pcSessionCache = { session, exp: Date.now() + 10 * 60_000 };
  return session;
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
    // Time-box del caller (epoch ms): en escaneos completos un solo tipo puede
    // tener 20+ páginas y con el gobierno lento comerse el maxDuration entero
    // — cortar por página, no solo entre tipos.
    deadlineTs?: number;
    // Paginación reanudable: arrancar desde este cursor (valorSiguiente) en vez
    // de la página 0, para que el escaneo completo avance entre corridas en vez
    // de re-topar siempre el mismo cap.
    startCursor?: string;
  },
): Promise<{ registros: PcRegistro[]; truncado: boolean; cursor: string | null; agotado: boolean }> {
  const out: PcRegistro[] = [];
  let valorSiguiente = opts.startCursor ?? "";
  let truncado = false;
  let agotado = false;
  const maxPages = opts.maxPages ?? 10;
  for (let page = 0; page < maxPages; page++) {
    if (opts.deadlineTs && Date.now() > opts.deadlineTs) {
      truncado = true; // quedaban páginas — la próxima corrida las trae
      break;
    }
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
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) throw new Error(`PanamaCompra lista ${res.status}`);
    const j = (await res.json()) as {
      result?: { registros?: PcRegistro[]; valorInicial?: string | null };
    };
    const regs = j.result?.registros ?? [];
    out.push(...regs);
    const next = j.result?.valorInicial;
    if (!next || regs.length === 0) {
      agotado = true; // llegamos al final natural del listado
      valorSiguiente = "";
      break;
    }
    valorSiguiente = next;
    if (opts.shouldStop) {
      const nums = regs.map((r) => (r.numProcesoOriginal || r.numProceso || "").trim()).filter(Boolean);
      if (nums.length > 0 && opts.shouldStop(nums)) break;
    }
    if (page === maxPages - 1) truncado = true; // quedaban páginas después del tope
  }
  // cursor para reanudar: null si se agotó (o cortó incremental sin más que traer).
  return { registros: out, truncado, cursor: agotado ? null : valorSiguiente || null, agotado };
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
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) {
    if (res.status === 404) return null; // el pliego genuinamente no está
    throw new Error(`PanamaCompra pliego HTTP ${res.status}`); // transitorio → reintentar
  }
  return res.json().catch(() => null);
}

// ── Competidores / propuestas recibidas (TANTEO) ─────────────────────────────
// Las propuestas de otros oferentes son SECRETAS hasta el acto de apertura; solo
// aparecen en procesos ya cerrados/adjudicados. PanamaCompra las publica en una
// vista distinta al pliego, cuyo endpoint exacto no está confirmado — probamos
// varios candidatos con el mismo patrón `pagina-componentes` y devolvemos el
// primero que traiga una tabla de proponentes. Si ninguno pega, [] (degradación).
export type PcProponente = { nombre: string; monto: number | null; extra: string | null };

// Vistas candidatas del detalle del proceso donde suele vivir el cuadro de
// propuestas / acto público. Se prueban en orden hasta encontrar proponentes.
const VISTAS_PROPUESTAS = [
  "procesoVistaResumen",
  "procesoVistaActoPublico",
  "procesoVistaActo",
  "procesoVistaPropuestas",
  "procesoVistaOfertas",
  "procesoVistaAdjudicacion",
  "procesoVistaEvaluacion",
];

const RE_PROP_NOMBRE = /proponente|oferente|razonsocial|razon_social|nombreempresa|nombre_empresa|contratista|participante|proveedor/i;
const RE_PROP_MONTO = /monto|precio|oferta|valor|total|importe/i;

// Busca recursivamente el array que MEJOR luce como lista de proponentes: sus
// elementos son objetos con una clave de nombre y (idealmente) una de monto.
function buscarProponentes(node: unknown): PcProponente[] {
  let mejor: PcProponente[] = [];
  const visit = (n: unknown): void => {
    if (Array.isArray(n)) {
      const objetos = n.filter((x) => x && typeof x === "object" && !Array.isArray(x)) as Record<string, unknown>[];
      if (objetos.length > 0) {
        const conNombre = objetos.filter((o) => Object.keys(o).some((k) => RE_PROP_NOMBRE.test(k)));
        // Un array de proponentes: la mayoría de sus filas tienen clave de nombre.
        if (conNombre.length >= Math.max(1, Math.floor(objetos.length * 0.6))) {
          const parsed = conNombre.map((o) => parseProp(o)).filter((p): p is PcProponente => p !== null);
          if (parsed.length > mejor.length) mejor = parsed;
        }
      }
      for (const x of n) visit(x);
      return;
    }
    if (n && typeof n === "object") for (const v of Object.values(n as Record<string, unknown>)) visit(v);
  };
  visit(node);
  return mejor;
}

function parseProp(o: Record<string, unknown>): PcProponente | null {
  let nombre: string | null = null;
  let monto: number | null = null;
  for (const [k, v] of Object.entries(o)) {
    if (nombre === null && RE_PROP_NOMBRE.test(k) && typeof v === "string" && v.trim()) nombre = v.trim();
    if (monto === null && RE_PROP_MONTO.test(k)) {
      const num = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^0-9.-]/g, "")) : NaN;
      if (Number.isFinite(num) && num > 0) monto = num;
    }
  }
  if (!nombre) return null;
  // Estado/resultado si viene (adjudicado, descalificado…).
  const estadoKey = Object.keys(o).find((k) => /estado|resultado|condicion|posicion|lugar/i.test(k));
  const estadoVal = estadoKey ? o[estadoKey] : null;
  const extra = typeof estadoVal === "string" && estadoVal.trim() ? estadoVal.trim() : null;
  return { nombre, monto, extra };
}

export async function pcProponentes(
  session: PcSession,
  idTipoProceso: string,
  idFlujos: string,
): Promise<{ proponentes: PcProponente[]; vistaUsada: string | null }> {
  for (const vista of VISTAS_PROPUESTAS) {
    let json: unknown = null;
    try {
      const res = await fetch(`${BASE}/procesos-configuracion/pagina-componentes/${idTipoProceso}/${vista}/${idFlujos}`, {
        method: "GET",
        headers: baseHeaders(session),
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) continue; // 404 = esa vista no existe para este tipo → probar la siguiente
      json = await res.json().catch(() => null);
    } catch {
      continue; // red/timeout en una vista no tumba el intento
    }
    const props = json ? buscarProponentes(json) : [];
    if (props.length > 0) return { proponentes: props, vistaUsada: vista };
  }
  return { proponentes: [], vistaUsada: null };
}

// Solo el endpoint de archivos de PanamaCompra (no SSRF a otros hosts). El
// hostname debe SER panamacompra.gob.pa o un subdominio real (no un dominio
// hermano tipo "evilpanamacompra.gob.pa").
const ARCHIVO_URL_RE = /^https:\/\/(?:[a-z0-9-]+\.)*panamacompra\.gob\.pa\/procesos-contratacion-archivos\//i;

// Descarga un archivo del pliego (PDF/doc) con la sesión de proveedor. Devuelve
// los bytes + content-type, o null si el archivo no existe (404). Lanza en
// errores transitorios (auth/5xx) para poder reintentar.
export async function pcDownloadArchivo(
  session: PcSession,
  url: string,
): Promise<{ bytes: Buffer; contentType: string | null } | null> {
  if (!ARCHIVO_URL_RE.test(url.trim())) throw new Error("URL de archivo no permitida");
  const res = await fetch(url.trim(), {
    method: "GET",
    headers: {
      Accept: "*/*",
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
      Origin: "https://www.panamacompra.gob.pa",
      Referer: "https://www.panamacompra.gob.pa/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
      cookie: `userToken=${session.userToken}; userSesionId=${session.userSesionId}`,
    },
    cache: "no-store",
    // Más generoso que las llamadas JSON: los PDFs del pliego pueden pesar.
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Descarga HTTP ${res.status}`);
  }
  const ab = await res.arrayBuffer();
  return { bytes: Buffer.from(ab), contentType: res.headers.get("content-type") };
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

// Sanidad: ningún proceso real supera este monto; corta valores que en realidad
// son timestamps u otros números gigantes que se cuelan por nombre de clave.
const MAX_MONTO = 1e11;

function parseNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 && v < MAX_MONTO ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  // Fechas/horas disfrazadas de "estimado" ("2026-07-31", "31/07/2026", ISO):
  // jamás son montos.
  if (/\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|T\d{2}:/.test(s)) return null;
  // "B/. 1,234.56" → el punto de "B/." es espurio: primero quedarse solo con
  // dígitos y separadores, después decidir cuál separador es el decimal.
  let t = s.replace(/[^0-9.,]/g, "");
  if (!/[0-9]/.test(t)) return null;
  const keepLastAsDecimal = (str: string, dec: "." | ",") => {
    const other = dec === "." ? "," : ".";
    let x = str.split(other).join("");
    const i = x.lastIndexOf(dec);
    if (i === -1) return x;
    return x.slice(0, i).split(dec).join("") + "." + x.slice(i + 1);
  };
  const lastDot = t.lastIndexOf(".");
  const lastComma = t.lastIndexOf(",");
  if (lastDot !== -1 && lastComma !== -1) {
    t = keepLastAsDecimal(t, lastDot > lastComma ? "." : ",");
  } else if (lastComma !== -1) {
    // Solo comas: "1,234,567" = miles; "1234,56" = decimal es-style.
    const parts = t.split(",");
    t = parts.length === 2 && parts[1].length <= 2 ? parts.join(".") : parts.join("");
  } else if (lastDot !== -1) {
    t = keepLastAsDecimal(t, ".");
    // "1.234.567" (miles es-style) deja 3 "decimales" → eran miles.
    const frac = t.split(".")[1];
    if (frac && frac.length === 3 && s.split(".").length > 2) t = t.replace(".", "");
  }
  const n = parseFloat(t);
  return Number.isFinite(n) && n > 0 && n < MAX_MONTO ? n : null;
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
// Excluye montos que no son el precio (fianza, %, ITBMS, partida, cantidades) y
// claves temporales que contienen "estimad" (fechaEstimada, tiempoEstimado…).
const RE_PRICE_EXCLUDE = /(unitari|fianza|garant|porcentaje|itbms|impuesto|partida|saldo|disponible|cantidad|subsan|fecha|plazo|tiempo|duracion|dias|hora|vigencia)/i;

// ¿El objeto es una fila "TOTAL" resumen (no un ítem real)? Sus montos duplican
// la suma de los renglones — hay que excluirlos del cálculo del precio.
function esFilaTotal(it: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(it)) {
    if (/descripcion|nombre|detalle/i.test(k) && typeof v === "string" && /^\s*(sub)?total\b/i.test(v)) return true;
  }
  return false;
}

type PriceEntry = { key: string; value: number; arr: number };

// Todos los montos "precio-like" del documento, cada uno etiquetado con el
// array que lo contiene (arr) para poder distinguir "renglones hermanos" de un
// total a nivel proceso. Por objeto: si trae clave *total* se usa SOLO esa
// (evita contar precioReferencia + precioReferenciaTotal del mismo renglón dos
// veces); si no, sus valores deduplicados. Filas "TOTAL" resumen se saltan.
function collectPriceLike(node: unknown): PriceEntry[] {
  const out: PriceEntry[] = [];
  let arrSeq = 0;
  const walk = (n: unknown, arrId: number, depth: number) => {
    if (n == null || depth > 12) return;
    if (Array.isArray(n)) {
      const id = ++arrSeq;
      for (const it of n) walk(it, id, depth + 1);
      return;
    }
    if (typeof n !== "object") return;
    const o = n as Record<string, unknown>;
    if (!esFilaTotal(o)) {
      const propios: { key: string; nk: string; value: number }[] = [];
      for (const [k, v] of Object.entries(o)) {
        const nk = k.replace(/[_\s]/g, "");
        if (RE_PRICE_LIKE.test(nk) && !RE_PRICE_EXCLUDE.test(nk)) {
          const num = parseNum(v);
          if (num !== null) propios.push({ key: k, nk, value: num });
        }
      }
      const totales = propios.filter((p) => /total/i.test(p.nk));
      const usar = totales.length > 0 ? totales : propios;
      const vistos = new Set<number>();
      for (const p of usar) {
        if (vistos.has(p.value)) continue; // mismo monto repetido en el mismo objeto
        vistos.add(p.value);
        out.push({ key: p.key, value: p.value, arr: arrId });
      }
    }
    for (const v of Object.values(o)) walk(v, arrId, depth + 1);
  };
  walk(node, 0, 0);
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

// Encontrar el array de RENGLONES reales — no la lista de secciones del pliego.
//
// El pliego es un árbol de ~18 secciones ("Número de Proceso", "Contacto…",
// "Items de la licitación pública", "Archivos…", etc.). El bug viejo buscaba un
// precio ANIDADO (depth 6) dentro de cada sección; como la sección "Items"
// contiene renglones con precio, TODA la lista de secciones matcheaba y se
// mostraban 18 secciones en vez de los renglones.
//
// Un renglón real trae su precio y su cantidad/unidad/código como claves
// PROPIAS (directas); una sección los tiene anidados más abajo. Discriminamos
// por eso: el precio DIRECTO ya descarta las secciones; la firma de ítem
// (cantidad/código/unidad) confirma que es la tabla de renglones.
function isPlainObj(it: unknown): it is Record<string, unknown> {
  return !!it && typeof it === "object" && !Array.isArray(it);
}
function directKeys(it: Record<string, unknown>): string[] {
  return Object.keys(it).map((k) => k.replace(/[_\s]/g, "").toLowerCase());
}
function hasDirectPrecio(it: Record<string, unknown>): boolean {
  return directKeys(it).some((k) => RE_PRICE_LIKE.test(k) && !RE_PRICE_EXCLUDE.test(k));
}
const RE_ITEM_SIGNATURE = /^cantidad|^codigo|unidadmedida|unidaddemedida|numerorenglon|^renglon|numeroitem|^item$/;
function looksLikeItem(it: Record<string, unknown>): boolean {
  return hasDirectPrecio(it) && directKeys(it).some((k) => RE_ITEM_SIGNATURE.test(k));
}

// Recolecta TODOS los arrays cuyos objetos cumplen `pred`, con su puntaje
// (cuántos objetos cumplen). El array de renglones real es el de mayor puntaje.
function collectItemArrays(
  node: unknown,
  pred: (it: Record<string, unknown>) => boolean,
  out: { objs: Record<string, unknown>[]; score: number }[] = [],
  depth = 0,
): { objs: Record<string, unknown>[]; score: number }[] {
  if (node == null || depth > 14) return out;
  if (Array.isArray(node)) {
    const objs = node.filter(isPlainObj);
    const score = objs.filter(pred).length;
    if (score > 0) out.push({ objs, score });
    for (const it of node) collectItemArrays(it, pred, out, depth + 1);
    return out;
  }
  if (isPlainObj(node)) {
    for (const v of Object.values(node)) collectItemArrays(v, pred, out, depth + 1);
  }
  return out;
}

function findItemsArray(node: unknown): Record<string, unknown>[] | null {
  // 1) preferí arrays con firma de ítem completa (precio directo + cantidad/…);
  // 2) si ninguno, relajá a "precio directo" (igual descarta las secciones).
  let pool = collectItemArrays(node, looksLikeItem);
  if (pool.length === 0) pool = collectItemArrays(node, hasDirectPrecio);
  if (pool.length === 0) return null;
  pool.sort((a, b) => b.score - a.score);
  return pool[0].objs;
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
// Regla (con los montos etiquetados por el array que los contiene):
//   - "Renglones" = el grupo más grande de montos hermanos (mismo array, ≥2).
//   - Un monto FUERA del grupo ≈ suma del grupo (tolerancia relativa 0.5%) ⇒ es
//     el total explícito → elegirlo (evita el doble conteo aunque difiera por
//     centavos de redondeo del gobierno).
//   - Con grupo de renglones: total = suma del grupo (montos externos que no
//     matchean son partidas/estimados sueltos: se ignoran, no se suman).
//   - Sin grupo: 1 valor → único; 2 valores ≈ iguales → total explícito (total +
//     su único renglón); si no → suma.
export function extractPrecioBreakdown(node: unknown): PrecioBreakdown {
  const entries = collectPriceLike(node);
  const candidatos = entries
    .map(({ key, value }) => ({ key, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const valores = entries.map((e) => e.value).sort((a, b) => b - a);
  const maxRef = valores[0] ?? null;
  const sumaTodo = valores.length ? round2(valores.reduce((a, b) => a + b, 0)) : null;
  const base = { maxRef, suma: sumaTodo, nValores: valores.length, candidatos };

  if (valores.length === 0) return { elegido: null, metodo: null, ...base };
  if (valores.length === 1) return { elegido: valores[0], metodo: "unico", ...base };

  const tol = (ref: number) => Math.max(0.5, 0.005 * ref);

  // Grupo más grande de montos hermanos (renglones de la misma tabla).
  const porArr = new Map<number, PriceEntry[]>();
  for (const e of entries) porArr.set(e.arr, [...(porArr.get(e.arr) ?? []), e]);
  const grupos = [...porArr.values()].sort((a, b) => b.length - a.length);
  const renglones = grupos[0].length >= 2 ? grupos[0] : null;

  if (renglones) {
    const sumaRenglones = round2(renglones.reduce((a, e) => a + e.value, 0));
    const externos = entries.filter((e) => e.arr !== renglones[0].arr);
    const totalExplicito = externos.find((e) => Math.abs(e.value - sumaRenglones) <= tol(e.value));
    if (totalExplicito) {
      return { elegido: totalExplicito.value, metodo: "total_explicito", ...base };
    }
    return { elegido: sumaRenglones, metodo: "suma_renglones", ...base };
  }

  // Sin tabla de renglones detectable: 2+ montos sueltos.
  if (valores.length === 2 && Math.abs(valores[0] - valores[1]) <= tol(valores[0])) {
    // total + su único renglón (mismo monto dos veces) → contar una sola vez.
    return { elegido: valores[0], metodo: "total_explicito", ...base };
  }
  return { elegido: sumaTodo, metodo: "suma_renglones", ...base };
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
    .filter((it) => !esFilaTotal(it))
    .slice(0, 40)
    .map((it) => ({
      descripcion: findFirstString(it, /descripcion|nombre|detalle|titulo/i) ?? "",
      cantidad: findFirstByKey(it, /^cantidad/i, 3),
      unidad: findFirstString(it, /unidad/i),
      precioRef: precioDeRenglon(it),
    }))
    .filter((i) => i.descripcion.length > 1);
}

// ── Archivos descargables del pliego (para bajarlos a Dropbox) ────────────────
// El pliego trae los documentos (pliego de cargos, especificaciones, etc.). El
// portal los descarga desde:
//   {BASE}/procesos-contratacion-archivos/v2/download-file-{UUID}-{code}-{code}
// Estrategia de extracción (segura: si una URL sale mal, la descarga da 404 y se
// salta, nunca escribe data equivocada):
//   1) si el pliego trae una URL con "download-file" → usarla TAL CUAL (sin construir);
//   2) si no, construir {UUID}-{code}-{code} con el UUID y el código del archivo.
export type PliegoArchivo = { nombre: string; url: string };

const ARCHIVO_DL_BASE = `${BASE}/procesos-contratacion-archivos/v2/`;
const RE_UUID = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
const RE_DOC_EXT = /\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|csv|txt|dwg|dwf|jpe?g|png|gif)$/i;
// Código de archivo tipo "ZA-101-1AZ-11089496": mayúsculas/números con ≥2 guiones.
const RE_CODE = /^[A-Z0-9]+(?:-[A-Z0-9]+){2,}$/;

function stringValues(o: Record<string, unknown>): string[] {
  return Object.values(o).filter((v): v is string => typeof v === "string");
}
// Nombre de archivo legible: preferí un valor que TERMINE en extensión de doc;
// si no, un campo etiquetado nombre/archivo/descripción.
function nombreArchivo(o: Record<string, unknown>): string | null {
  for (const v of stringValues(o)) if (RE_DOC_EXT.test(v.trim())) return v.trim();
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "string" && /nombre|archivo|documento|descripcion|titulo/i.test(k.replace(/[_\s]/g, "")) && v.trim().length > 1) {
      return v.trim();
    }
  }
  return null;
}
function normalizarUrlDescarga(v: string): string {
  if (/^https?:\/\//i.test(v)) return v.trim();
  const m = v.match(/download-file.*/i);
  return m ? `${ARCHIVO_DL_BASE}${m[0].replace(/^\/+/, "")}` : v.trim();
}

export function extractArchivos(node: unknown): PliegoArchivo[] {
  const out: PliegoArchivo[] = [];
  const seen = new Set<string>();
  const add = (nombre: string | null, url: string) => {
    const u = url.trim();
    if (!u || seen.has(u.toLowerCase())) return;
    seen.add(u.toLowerCase());
    let name = (nombre ?? "").trim();
    if (!name) {
      const last = u.split("/").pop() ?? "documento";
      try {
        name = decodeURIComponent(last);
      } catch {
        name = last; // %-escape malformado en la URL del gobierno: usar crudo
      }
    }
    out.push({ nombre: name, url: u });
  };
  const walk = (n: unknown, parentName: string | null, depth: number) => {
    if (n == null || depth > 16) return;
    if (Array.isArray(n)) {
      for (const it of n) walk(it, parentName, depth + 1);
      return;
    }
    if (typeof n !== "object") return;
    const o = n as Record<string, unknown>;
    const nom = nombreArchivo(o);
    // 1) URL de descarga embebida (verbatim).
    let embebida = false;
    for (const v of stringValues(o)) {
      if (v.includes("download-file")) {
        embebida = true;
        add(nom ?? parentName, normalizarUrlDescarga(v));
      }
    }
    // 2) construir desde UUID + código si el objeto es un archivo (y no hubo URL).
    if (!embebida && nom && RE_DOC_EXT.test(nom)) {
      let uuid: string | null = null;
      let code: string | null = null;
      let codeFallback: string | null = null;
      for (const [k, v] of Object.entries(o)) {
        if (typeof v !== "string") continue;
        const m = v.match(RE_UUID);
        if (m && !uuid) uuid = m[0];
        const t = v.trim();
        if (RE_CODE.test(t) && !RE_UUID.test(t)) {
          // El código real vive en claves tipo "codigoArchivo"; un numProceso
          // ("2026-1-10-…") también matchea el shape — preferir la clave codigo.
          if (/codigo/i.test(k.replace(/[_\s]/g, "")) && !code) code = t;
          else if (!codeFallback) codeFallback = t;
        }
      }
      const c = code ?? codeFallback;
      if (uuid && c) add(nom, `${ARCHIVO_DL_BASE}download-file-${uuid}-${c}-${c}`);
    }
    for (const v of Object.values(o)) walk(v, nom ?? parentName, depth + 1);
  };
  walk(node, null, 0);
  return out.slice(0, 60);
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
