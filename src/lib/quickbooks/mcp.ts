// Cliente MCP mínimo (sin SDK) para el gateway de QuickBooks de Dicec.
// La app actúa como MCP client sobre streamable-HTTP: initialize → (session) →
// tools/call. Parsea respuestas JSON o SSE. La URL (con el secreto en el path)
// vive en QBO_MCP_URL — solo server-side, nunca en el cliente.
//
// Nota: el endpoint está bloqueado por la política de egress del entorno de
// desarrollo de Claude, pero NO desde Vercel; esto corre en runtime de servidor.

const PROTOCOL_VERSION = "2025-06-18";

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
): Promise<{ res: RpcResponse | null; sessionId: string | undefined }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  const payload: Record<string, unknown> = { jsonrpc: "2.0", method, params };
  if (id !== null) payload.id = id; // las notificaciones no llevan id

  const r = await fetch(endpoint(), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    // sin cache; cada llamada es una operación
    cache: "no-store",
  });

  const newSession = r.headers.get("mcp-session-id") ?? sessionId;

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`QBO MCP ${method} → HTTP ${r.status}${txt ? `: ${txt.slice(0, 200)}` : ""}`);
  }

  // Las notificaciones (id null) pueden devolver 202 sin cuerpo.
  if (id === null) return { res: null, sessionId: newSession };

  const ct = r.headers.get("content-type") ?? "";
  const body = await r.text();
  const res = parseRpcPayload(ct, body);
  if (res.error) throw new Error(`QBO MCP ${method} error ${res.error.code}: ${res.error.message}`);
  return { res, sessionId: newSession };
}

// Handshake + una llamada. Robusto a gateways con o sin sesión: si initialize
// devuelve Mcp-Session-Id, mandamos notifications/initialized y lo arrastramos.
async function withSession<T>(fn: (session: string | undefined) => Promise<T>): Promise<T> {
  const init = await rpc(
    "initialize",
    {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "cotiza", version: "1.0" },
    },
    1,
    undefined,
  );
  const session = init.sessionId;
  if (session) {
    await rpc("notifications/initialized", {}, null, session).catch(() => {});
  }
  return fn(session);
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

export async function callQboTool(name: string, args: Record<string, unknown> = {}): Promise<QboToolResult> {
  return withSession(async (session) => {
    const { res } = await rpc("tools/call", { name, arguments: args }, 3, session);
    return (res?.result as QboToolResult) ?? {};
  });
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
