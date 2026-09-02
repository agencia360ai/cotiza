// Cliente MCP mínimo (sin SDK) para el gateway de QuickBooks de Dicec.
// La app actúa como MCP client sobre streamable-HTTP: initialize → (session) →
// tools/call. Parsea respuestas JSON o SSE. La URL (con el secreto en el path)
// vive en QBO_MCP_URL — solo server-side, nunca en el cliente.
//
// Nota: el endpoint está bloqueado por la política de egress del entorno de
// desarrollo de Claude, pero NO desde Vercel; esto corre en runtime de servidor.

import { fetch as undiciFetch, Agent } from "undici";

const PROTOCOL_VERSION = "2025-06-18";

// El fetch nativo corta la CONEXIÓN a los 10s (UND_ERR_CONNECT_TIMEOUT) — se
// queda corto si el gateway está despertando de un cold start, que en el
// e2-micro tarda 30-60s. Agent propio con margen de conexión de 45s (por debajo
// de eso cortábamos antes de que el VM terminara de arrancar) + pool keep-alive:
// initialize → notifications → tools/call (y el loop de financials) reusan el socket.
const qboAgent = new Agent({ connect: { timeout: 45_000 } });

export function hasQboConfig(): boolean {
  return !!process.env.QBO_MCP_URL;
}

function endpoint(): string {
  const url = process.env.QBO_MCP_URL;
  if (!url) throw new Error("QBO_MCP_URL no está configurada");
  return url;
}

type RpcResponse = {
  jsonrpc: "2.0";
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

// Fallo de TRANSPORTE (red caída, timeout, gateway ocupado) vs error de
// aplicación. Solo los de transporte se reintentan: un rechazo de QBO va a
// devolver lo mismo, pero un "fetch failed" suele ser un blip que al segundo
// intento pasa — y el mensaje crudo de undici no le dice nada al usuario.
export class QboTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QboTransportError";
  }
}

// Traducción de los códigos de red más comunes a algo accionable.
const CODIGO_HUMANO: Record<string, string> = {
  UND_ERR_CONNECT_TIMEOUT: "no aceptó la conexión a tiempo (puede estar arrancando)",
  UND_ERR_HEADERS_TIMEOUT: "aceptó la conexión pero no respondió",
  UND_ERR_SOCKET: "cortó la conexión a mitad de la llamada",
  ECONNREFUSED: "rechazó la conexión (¿servicio caído?)",
  ECONNRESET: "cortó la conexión a mitad de la llamada",
  ENOTFOUND: "no se encontró el host (revisa QBO_MCP_URL)",
  EAI_AGAIN: "falló el DNS (transitorio)",
};

function describeFetchError(e: unknown, method: string, fase: "pedido" | "respuesta" = "pedido"): string {
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
    return fase === "respuesta"
      ? `el gateway de QBO empezó a responder pero no terminó a tiempo — ${method}`
      : `el gateway de QBO no respondió — timeout en ${method}`;
  }
  // undici tira TypeError "fetch failed" con la causa real (ECONNRESET,
  // ENOTFOUND…) escondida en e.cause — o en cause.errors[0] cuando el host
  // resuelve a varias direcciones (AggregateError).
  const cause = (e as { cause?: { code?: unknown; errors?: Array<{ code?: unknown }> } } | null)?.cause;
  const code =
    typeof cause?.code === "string"
      ? cause.code
      : typeof cause?.errors?.[0]?.code === "string"
        ? cause.errors[0].code
        : null;
  const humano = code ? CODIGO_HUMANO[code] : null;
  const detalle = humano ? `${humano} · ${code}` : (code ?? "fallo de red");
  return `sin conexión con el gateway de QBO — ${detalle} en ${method}`;
}

// Estos status vienen del proxy/infra, no de la lógica de QBO: transitorios.
const HTTP_TRANSITORIO = new Set([429, 502, 503, 504]);

// El primer intento paga el arranque en frío del e2-micro (conexión hasta 45s
// + autenticación contra Intuit). Los reintentos no: si no contestó en 60s, no
// va a necesitar otros 60 — y tres intentos completos se comían el maxDuration
// de 300s de la server action antes de llegar a consultar un solo proyecto.
const TOPE_PRIMER_INTENTO = 60_000;
const TOPE_REINTENTO = 25_000;

// Circuit breaker: cuando el gateway está caído/colgado, un refresh recorre
// docenas de llamadas y a 3 intentos × 30s cada una revienta el maxDuration de
// la server action. Tras agotar reintentos, por 60s las llamadas van directo
// (sin reintentos) y con timeout corto para fallar rápido.
let gatewayCaidoHasta = 0;
const gatewayCaido = () => Date.now() < gatewayCaidoHasta;

// El servidor puede responder application/json o text/event-stream. En SSE el
// payload viene en líneas `data:`; tomamos el último objeto JSON-RPC con result/error.
function parseRpcPayload(contentType: string, body: string): RpcResponse {
  const text = body.trim();
  if (contentType.includes("text/event-stream") || text.startsWith("event:") || text.startsWith("data:")) {
    let last: RpcResponse | null = null;
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^data:\s?(.*)$/);
      if (!m || !m[1].trim()) continue;
      try {
        const obj = JSON.parse(m[1]) as RpcResponse;
        if (obj && (("result" in obj) || ("error" in obj))) last = obj;
      } catch {
        // fragmento parcial; ignorar
      }
    }
    if (last) return last;
    throw new Error("Respuesta SSE sin objeto JSON-RPC válido");
  }
  return JSON.parse(text) as RpcResponse;
}

async function rpc(
  method: string,
  params: unknown,
  id: number | null,
  sessionId: string | undefined,
  tope?: number,
): Promise<{ res: RpcResponse | null; sessionId: string | undefined }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  const payload: Record<string, unknown> = { jsonrpc: "2.0", method, params };
  if (id !== null) payload.id = id; // las notificaciones no llevan id

  // undiciFetch (no el fetch parcheado de Next) para poder pasar el dispatcher
  // con el connect timeout largo. Total generoso (conexión fría + respuesta),
  // pero un gateway colgado no debe congelar la server action: con el breaker
  // abierto se corta a los 8s.
  const r = await undiciFetch(endpoint(), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    dispatcher: qboAgent,
    // Total > connect (45s) para no cortar una conexión fría a mitad; con el
    // breaker abierto, en cambio, se corta a los 8s para fallar rápido. Los
    // reintentos mandan un tope más corto: ver TOPE_REINTENTO.
    signal: AbortSignal.timeout(gatewayCaido() ? 8_000 : (tope ?? TOPE_PRIMER_INTENTO)),
  }).catch((e) => {
    throw new QboTransportError(describeFetchError(e, method));
  });

  const newSession = r.headers.get("mcp-session-id") ?? sessionId;

  if (!r.ok) {
    if (HTTP_TRANSITORIO.has(r.status)) {
      throw new QboTransportError(`el gateway de QBO devolvió HTTP ${r.status} en ${method}`);
    }
    const txt = await r.text().catch(() => "");
    throw new Error(`QBO MCP ${method} → HTTP ${r.status}${txt ? `: ${txt.slice(0, 200)}` : ""}`);
  }

  // Las notificaciones (id null) pueden devolver 202 sin cuerpo.
  if (id === null) return { res: null, sessionId: newSession };

  const ct = r.headers.get("content-type") ?? "";
  // Leer el cuerpo también es red: el timeout y el socket siguen vivos después
  // de que llegan los headers. Sin este catch, un gateway que responde y se
  // queda a mitad del cuerpo tiraba el TimeoutError crudo de undici —"The
  // operation was aborted due to timeout"— que no es de transporte para
  // `withSession`, así que NO se reintentaba y salía tal cual en pantalla.
  const body = await r.text().catch((e) => {
    throw new QboTransportError(describeFetchError(e, method, "respuesta"));
  });
  const res = parseRpcPayload(ct, body);
  if (res.error) throw new Error(`QBO MCP ${method} error ${res.error.code}: ${res.error.message}`);
  return { res, sessionId: newSession };
}

// Handshake MCP: initialize (+ notifications/initialized si el gateway da
// sesión). Devuelve el Mcp-Session-Id para arrastrarlo en las siguientes llamadas.
async function handshake(tope?: number): Promise<string | undefined> {
  const init = await rpc(
    "initialize",
    { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "cotiza", version: "1.0" } },
    1,
    undefined,
    tope,
  );
  const session = init.sessionId;
  if (session) await rpc("notifications/initialized", {}, null, session).catch(() => {});
  return session;
}

// Handshake + una llamada. Robusto a gateways con o sin sesión: si initialize
// devuelve Mcp-Session-Id, mandamos notifications/initialized y lo arrastramos.
// Los fallos de transporte se reintentan con handshake fresco (la sesión pudo
// morir con la conexión); retries: 0 para operaciones no idempotentes (creates).
async function withSession<T>(
  fn: (session: string | undefined) => Promise<T>,
  opts?: { retries?: number },
): Promise<T> {
  const intentos = 1 + (gatewayCaido() ? 0 : (opts?.retries ?? 2));
  for (let intento = 1; ; intento++) {
    try {
      const session = await handshake(intento === 1 ? undefined : TOPE_REINTENTO);
      const out = await fn(session);
      gatewayCaidoHasta = 0;
      return out;
    } catch (e) {
      if (!(e instanceof QboTransportError)) {
        gatewayCaidoHasta = 0; // la respuesta llegó al gateway: la conexión está bien
        throw e;
      }
      if (intento >= intentos) {
        gatewayCaidoHasta = Date.now() + 60_000;
        throw e;
      }
      // Pausa larga a propósito: si el gateway está despertando de un cold
      // start, los 3 intentos (con conexión de hasta 25s cada uno) cubren
      // una ventana de ~80s de arranque.
      await new Promise((res) => setTimeout(res, 2_000 * intento));
    }
  }
}

// Muchas tools/call sobre UNA sola sesión: un solo handshake, no uno por llamada.
// El `initialize` del gateway de QBO cuesta varios segundos (autentica contra
// Intuit); pagarlo una vez —en vez de por cada uno de decenas de proyectos—
// acelera el refresh y evita abrir muchas sesiones a la vez, que en hosts lentos
// (p.ej. un e2-micro) tumban a supergateway. El caller lo usa SECUENCIAL (nada
// de Promise.all): dos requests concurrentes sobre el bridge stateful lo cuelgan.
// Si la sesión muere a mitad del lote, reconstruye el handshake y reintenta.
export async function withQboSession<T>(
  fn: (call: (name: string, args?: Record<string, unknown>) => Promise<QboToolResult>) => Promise<T>,
): Promise<T> {
  let session = await handshake();
  const attempt = async (sid: string | undefined, name: string, args: Record<string, unknown>): Promise<QboToolResult> => {
    const { res } = await rpc("tools/call", { name, arguments: args }, 3, sid);
    return (res?.result as QboToolResult) ?? {};
  };
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<QboToolResult> => {
    try {
      return await attempt(session, name, args);
    } catch (e) {
      if (!(e instanceof QboTransportError) || gatewayCaido()) throw e;
      // Sesión caída a mitad del lote: reconstruir la sesión (para esta y las
      // siguientes) y reintentar UNA vez. Si vuelve a caer, abrir el breaker.
      try {
        session = await handshake(TOPE_REINTENTO);
        return await attempt(session, name, args);
      } catch (e2) {
        if (e2 instanceof QboTransportError) gatewayCaidoHasta = Date.now() + 60_000;
        throw e2;
      }
    }
  };
  const out = await fn(call);
  gatewayCaidoHasta = 0;
  return out;
}

export type QboTool = { name: string; description?: string; inputSchema?: unknown };

export async function listQboTools(): Promise<QboTool[]> {
  return withSession(async (session) => {
    const { res } = await rpc("tools/list", {}, 2, session);
    const tools = (res?.result as { tools?: QboTool[] } | undefined)?.tools;
    return tools ?? [];
  });
}

// Devuelve el contenido crudo del tool result. Los servers MCP devuelven
// { content: [{ type: "text", text: "..." }], structuredContent?: {...} }.
export type QboToolResult = {
  content?: Array<{ type: string; text?: string; [k: string]: unknown }>;
  structuredContent?: unknown;
  isError?: boolean;
};

export async function callQboTool(
  name: string,
  args: Record<string, unknown> = {},
  opts?: { retries?: number },
): Promise<QboToolResult> {
  return withSession(async (session) => {
    const { res } = await rpc("tools/call", { name, arguments: args }, 3, session);
    return (res?.result as QboToolResult) ?? {};
  }, opts);
}

// Conveniencia: muchos tools de QBO devuelven JSON dentro de content[].text.
// Intenta parsear el primer bloque de texto como JSON; si no, lo devuelve crudo.
export function extractJson<T = unknown>(result: QboToolResult): T | string | null {
  if (result.structuredContent !== undefined) return result.structuredContent as T;
  const text = result.content?.find((c) => c.type === "text")?.text;
  if (text === undefined) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text;
  }
}
