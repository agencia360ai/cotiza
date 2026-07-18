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

// ── Búsqueda de UN proceso por número de acto ─────────────────────────────────
// Para licitaciones viejas (2025 y anteriores) que el escaneo de vigentes nunca
// capturó: la FECHA del acto y el idProcesosContratacionFlujos solo se
// consiguen buscando el proceso por su número. La clave exacta del filtro de
// búsqueda no está confirmada → TANTEO de variantes sobre el endpoint conocido
// (busqueda/proceso-lista); el match se valida por número EXACTO, así que una
// variante ignorada por la API no puede dar un falso positivo. Deja diagnóstico
// en logs para afinar con datos reales.
// Comparación de números de proceso tolerante a formato (separadores, ceros,
// mayúsculas): "2026-1-11-01-08-LP-000014" == "2026 1 11 1 8 lp 14"? No —
// solo quita separadores y mayúsculas, NO ceros de padding, para no confundir
// "000014" con "000140". El padding real siempre coincide entre portal y filtro.
const normNumProceso = (s: string | undefined | null) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function pcBuscarProceso(session: PcSession, numero: string): Promise<PcRegistro | null> {
  const num = numero.trim();
  if (!num) return null;
  const target = normNumProceso(num);
  // Cuerpos candidatos para POST busqueda/proceso-lista (el endpoint que usa
  // "Búsqueda Pliego" del portal, confirmado por captura). No se conoce la clave
  // exacta del filtro → se tantean; el match se valida por número EXACTO
  // (normalizado), así que una variante que la API ignore no da falso positivo.
  const bodies: Record<string, unknown>[] = [
    { registrosPorPagina: 20, valorSiguiente: "", filtro: { numProceso: num } },
    { registrosPorPagina: 20, valorSiguiente: "", filtro: { numProcesoOriginal: num } },
    { registrosPorPagina: 20, valorSiguiente: "", filtro: { numeroProceso: num } },
    { registrosPorPagina: 20, valorSiguiente: "", filtro: { numLc: num } },
    { registrosPorPagina: 20, valorSiguiente: "", filtro: { busqueda: num } },
    { registrosPorPagina: 20, valorSiguiente: "", numProceso: num },
    { numProceso: num },
  ];
  for (const body of bodies) {
    try {
      const res = await fetch(`${BASE}/busqueda/proceso-lista`, {
        method: "POST",
        headers: baseHeaders(session),
        body: JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) continue;
      const j = (await res.json()) as { result?: { registros?: PcRegistro[] } };
      const regs = j.result?.registros ?? [];
      const match = regs.find((r) => [r.numProcesoOriginal, r.numProceso].some((n) => normNumProceso(n) === target));
      if (match) return match;
      if (regs.length > 0) {
        const key = body.filtro ? Object.keys(body.filtro as object)[0] : Object.keys(body)[0];
        console.warn(`[pcBuscarProceso] variante ${key} devolvió ${regs.length} registros sin match para ${num}`);
      }
    } catch {
      continue; // timeout/red en una variante no corta el tanteo
    }
  }
  console.warn(`[pcBuscarProceso] sin match para ${num} tras ${bodies.length} variantes`);
  return null;
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

// Endpoints candidatos, en orden. El cuadroPropuesta es EL confirmado con un
// response real completo del portal (CM-021746): `result.ofertasGlobal[]` trae
// UNA oferta por proponente con empresa.nombreComercial (anidado), precioTotal
// (el total de la propuesta, no el de un renglón) y los flags esAdjudicado /
// cumple. La lista de propuestas (POST) y el resumen quedan de respaldo para
// procesos donde el cuadro no esté expuesto. {t}=idTipoProceso {f}=idFlujos.
type EndpointPropuestas = { url: string; method: "GET" | "POST"; body?: string };
const ENDPOINTS_PROPUESTAS: ((t: string, f: string) => EndpointPropuestas)[] = [
  (t, f) => ({ url: `${BASE}/documentos-actos-publico/cuadroPropuesta/${t}/procesoVistaCuadroPropuesta/${f}`, method: "GET" }),
  (t, f) => ({
    url: `${BASE}/ps/procesos/ofertar/lista-propuesta-page/get-page`,
    method: "POST",
    body: JSON.stringify({ idTipoProceso: Number(t), idProcesosContratacionFlujos: Number(f) }),
  }),
  (t, f) => ({ url: `${BASE}/procesos-configuracion/pagina-componentes/${t}/procesoVistaResumen/${f}`, method: "GET" }),
];

// Claves de NOMBRE en dos niveles: las fuertes identifican inequívocamente a la
// empresa; las débiles pueden aparecer también en filas de renglones (el cuadro
// comparativo mezcló "proveedor"/"casa" y salían descripciones como oferente).
const RE_NOMBRE_FUERTE = /proponente|oferente|razonsocial|razon_social|nombreempresa|nombre_empresa/i;
const RE_NOMBRE_DEBIL = /proponente|oferente|razonsocial|razon_social|nombreempresa|nombre_empresa|contratista|participante|proveedor/i;
// El cuadro por proponente tiene en cada RENGLÓN la columna "Especificaciones
// del Proponente" — contiene "proponente" pero su valor es la descripción del
// artículo, no la empresa. Estas claves NUNCA cuentan como nombre.
const RE_NOMBRE_EXCLUIR = /especificacion|descripcion|detalle|observacion|justificacion/i;
const RE_PROP_MONTO = /monto|precio|oferta|valor|total|importe/i;
// Clave CONTENEDORA (la que sostiene el array) que indica inequívocamente una
// lista de proponentes. Cuando el array vive bajo una de estas, confiamos en él
// aunque sus filas nombren la empresa con un campo genérico ("nombre",
// "razonSocial") que las regex de arriba no cubren — así la vista lista-propuesta
// (nombres bajo `nombre`) deja de venir vacía.
const RE_CONTENEDOR_PROP = /proponente|propuesta|oferente|oferta|participante|competidor/i;
// Nombre de empresa dentro de un objeto YA sabido proponente (contenedor
// confiable): acepta claves genéricas además de las fuertes.
const RE_NOMBRE_EN_CONTENEDOR = /proponente|oferente|razonsocial|razon_social|nombreempresa|nombre_empresa|nombre|empresa|contratista|proveedor|participante/i;

// Monto de la propuesta: preferir el TOTAL del proponente (no impuestos) sobre
// precios de renglón; si no hay total, el primer monto positivo que aparezca.
function extraerMonto(o: Record<string, unknown>): number | null {
  const leer = (v: unknown): number | null => {
    const num = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^0-9.-]/g, "")) : NaN;
    return Number.isFinite(num) && num > 0 ? num : null;
  };
  for (const [k, v] of Object.entries(o)) {
    if (/total/i.test(k) && !/impuesto/i.test(k)) {
      const n = leer(v);
      if (n !== null) return n;
    }
  }
  for (const [k, v] of Object.entries(o)) {
    if (RE_PROP_MONTO.test(k)) {
      const n = leer(v);
      if (n !== null) return n;
    }
  }
  return null;
}

// Busca recursivamente el array que MEJOR luce como lista de proponentes. Dos
// pasadas: primero solo claves fuertes; si nada, con las débiles.
function buscarProponentes(node: unknown): PcProponente[] {
  const conRegex = (re: RegExp): PcProponente[] => {
    let mejor: PcProponente[] = [];
    const visit = (n: unknown): void => {
      if (Array.isArray(n)) {
        const objetos = n.filter((x) => x && typeof x === "object" && !Array.isArray(x)) as Record<string, unknown>[];
        if (objetos.length > 0) {
          const conNombre = objetos.filter((o) => Object.keys(o).some((k) => re.test(k) && !RE_NOMBRE_EXCLUIR.test(k)));
          // Un array de proponentes: la mayoría de sus filas tienen clave de nombre.
          if (conNombre.length >= Math.max(1, Math.floor(objetos.length * 0.6))) {
            const parsed = conNombre.map((o) => parseProp(o, re)).filter((p): p is PcProponente => p !== null);
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
  };
  // Pasada por CONTENEDOR: un array sostenido por una clave proponente-ish se
  // trata como lista de proponentes aunque sus filas nombren la empresa con un
  // campo genérico (los otros pases exigen la clave "proponente" en cada fila).
  const desdeContenedor = (): PcProponente[] => {
    let mejor: PcProponente[] = [];
    const visit = (n: unknown, keyPadre: string | null): void => {
      if (Array.isArray(n)) {
        if (keyPadre && RE_CONTENEDOR_PROP.test(keyPadre)) {
          const objetos = n.filter((x) => x && typeof x === "object" && !Array.isArray(x)) as Record<string, unknown>[];
          const parsed = objetos.map((o) => parseProp(o, RE_NOMBRE_EN_CONTENEDOR)).filter((p): p is PcProponente => p !== null);
          if (parsed.length > mejor.length) mejor = parsed;
        }
        for (const x of n) visit(x, keyPadre);
        return;
      }
      if (n && typeof n === "object") for (const [k, v] of Object.entries(n as Record<string, unknown>)) visit(v, k);
    };
    visit(node, null);
    return mejor;
  };

  const contenedor = desdeContenedor();
  const fuerte = contenedor.length > 0 ? contenedor : conRegex(RE_NOMBRE_FUERTE);
  const lista = fuerte.length > 0 ? fuerte : conRegex(RE_NOMBRE_DEBIL);
  // Dedup por nombre (el cuadro repite al proponente por renglón); conservar el
  // que traiga monto.
  const porNombre = new Map<string, PcProponente>();
  for (const p of lista) {
    const k = p.nombre.toLowerCase();
    const prev = porNombre.get(k);
    if (!prev || (prev.monto === null && p.monto !== null)) porNombre.set(k, p);
  }
  return Array.from(porNombre.values());
}

// La empresa puede venir ANIDADA: el cuadroPropuesta real guarda cada oferta
// como { empresa: { nombreComercial }, precioTotal, esAdjudicado, … }. Si el
// objeto no trae el nombre como string directo, mirar UN nivel adentro de sus
// valores-objeto "empresa-ish" (nunca más hondo: a dos saltos ya viven los
// renglones, cuyos precios parciales contaminarían el monto).
const RE_OBJETO_EMPRESA = /empresa|proponente|oferente|razon/i;

function nombreDirecto(o: Record<string, unknown>, reNombre: RegExp): string | null {
  for (const [k, v] of Object.entries(o)) {
    if (reNombre.test(k) && !RE_NOMBRE_EXCLUIR.test(k) && typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function parseProp(o: Record<string, unknown>, reNombre: RegExp): PcProponente | null {
  let nombre = nombreDirecto(o, reNombre);
  if (nombre === null) {
    for (const [k, v] of Object.entries(o)) {
      if (v && typeof v === "object" && !Array.isArray(v) && RE_OBJETO_EMPRESA.test(k)) {
        nombre = nombreDirecto(v as Record<string, unknown>, RE_NOMBRE_EN_CONTENEDOR);
        if (nombre !== null) break;
      }
    }
  }
  const monto = extraerMonto(o);
  // Un "nombre" de >140 chars es una descripción de renglón, no una empresa.
  if (!nombre || nombre.length > 140) return null;
  // Estado/resultado si viene (adjudicado, descalificado…).
  const estadoKey = Object.keys(o).find((k) => /estado|resultado|condicion|posicion|lugar/i.test(k));
  const estadoVal = estadoKey ? o[estadoKey] : null;
  let extra = typeof estadoVal === "string" && estadoVal.trim() ? estadoVal.trim() : null;
  // El cuadro real no trae estado en texto sino FLAGS: esAdjudicado / cumple.
  if (extra === null) {
    if (o.esAdjudicado === 1 || o.esAdjudicado === true) extra = "Adjudicado";
    else if (o.cumple === 0 || o.cumple === false) extra = "No cumple";
    else if (o.cumple === 1 || o.cumple === true) extra = "Cumple";
  }
  return { nombre, monto, extra };
}

// Diagnóstico: estructura compacta (claves + tipos + muestras cortas) de un JSON
// para poder mapear los campos reales desde los logs de Vercel sin adivinar. Los
// valores string se recortan a 40 chars — es data pública de licitación, no hay
// secretos, pero se acota para no inflar el log.
function shapePreview(node: unknown, depth = 0): unknown {
  if (depth > 4) return "…";
  if (Array.isArray(node)) return node.length === 0 ? [] : [`${node.length}×`, shapePreview(node[0], depth + 1)];
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).slice(0, 25)) out[k] = shapePreview(o[k], depth + 1);
    return out;
  }
  if (typeof node === "string") return node.length > 40 ? node.slice(0, 40) + "…" : node;
  return typeof node;
}

export async function pcProponentes(
  session: PcSession,
  idTipoProceso: string,
  idFlujos: string,
): Promise<{ proponentes: PcProponente[]; vistaUsada: string | null }> {
  let base: PcProponente[] = [];
  let vistaUsada: string | null = null;
  for (const build of ENDPOINTS_PROPUESTAS) {
    // Si ya tenemos proponentes CON monto, no hace falta seguir consultando.
    if (base.length > 0 && base.every((p) => p.monto !== null)) break;
    const ep = build(idTipoProceso, idFlujos);
    let json: unknown = null;
    try {
      const res = await fetch(ep.url, {
        method: ep.method,
        headers: baseHeaders(session),
        body: ep.body,
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) continue; // 404 = ese endpoint no aplica para este tipo → siguiente
      // Estas APIs responden con Content-Type text/html pero el cuerpo es JSON
      // → parsear el texto (json() fallaría por el header).
      const text = await res.text();
      try {
        json = JSON.parse(text);
      } catch {
        const i = text.indexOf("{");
        const j = text.lastIndexOf("}");
        if (i >= 0 && j > i) {
          try {
            json = JSON.parse(text.slice(i, j + 1));
          } catch {
            json = null;
          }
        }
      }
    } catch {
      continue; // red/timeout en un endpoint no tumba el intento
    }
    const props = json ? buscarProponentes(json) : [];
    if (props.length === 0) {
      // El endpoint respondió pero no supimos leer proponentes: registrar el
      // shape real (campos + muestras) para poder mapearlo desde los logs sin
      // adivinar. Solo cuando trajo cuerpo (json != null); no ensucia el caso 404.
      if (json) {
        try {
          console.warn(`[pcProponentes] sin proponentes de ${ep.url}: ${JSON.stringify(shapePreview(json)).slice(0, 1500)}`);
        } catch {
          /* preview mejor-esfuerzo */
        }
      }
      continue;
    }
    if (base.length === 0) {
      base = props;
      vistaUsada = ep.url;
      continue;
    }
    // Enriquecer: la lista trae los nombres; el cuadro puede traer los montos.
    for (const b of base) {
      if (b.monto !== null) continue;
      const match = props.find((p) => p.nombre.toLowerCase() === b.nombre.toLowerCase() && p.monto !== null);
      if (match) b.monto = match.monto;
    }
  }
  return { proponentes: base, vistaUsada };
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

// El pliego guarda datos como pares { nombre: "<etiqueta>", value: "<dato>" }
// (no como claves nombradas). Busca el value del primer par cuya etiqueta
// matchee. Así se leen "Fecha … presentación de propuestas", "Precio de
// referencia", etc., que viven bajo la clave genérica "nombre".
function findValueByLabel(node: unknown, labelRe: RegExp): string | null {
  let found: string | null = null;
  const visit = (n: unknown): void => {
    if (found !== null) return;
    if (Array.isArray(n)) {
      for (const x of n) visit(x);
      return;
    }
    if (n && typeof n === "object") {
      const o = n as Record<string, unknown>;
      if (typeof o.nombre === "string" && labelRe.test(o.nombre) && typeof o.value === "string" && o.value.trim()) {
        found = o.value.trim();
        return;
      }
      for (const v of Object.values(o)) visit(v);
    }
  };
  visit(node);
  return found;
}

// Fecha de PARTICIPACIÓN = cierre de presentación de propuestas (la fecha "de
// cuando es la licitación"). El pliego la trae como "24-06-2026 hasta 10:30 AM"
// (DD-MM-YYYY). Cae a la de apertura y luego a la de publicación. Devuelve
// YYYY-MM-DD o null.
export function extractFechaCierre(pliego: unknown): string | null {
  const raw =
    findValueByLabel(pliego, /presentaci[oó]n de propuestas/i) ??
    findValueByLabel(pliego, /apertura de propuestas/i) ??
    findValueByLabel(pliego, /fecha de publicaci[oó]n/i);
  if (!raw) return null;
  const m = raw.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const iso = `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

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
