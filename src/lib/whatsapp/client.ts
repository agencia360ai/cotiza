import "server-only";
import crypto from "node:crypto";

// Cliente de la WhatsApp Cloud API de Meta (Graph API). Envía mensajes de
// servicio (gratis dentro de la ventana de 24 h que abre el mensaje del
// empleado) y valida la firma de los webhooks entrantes.

const GRAPH = "https://graph.facebook.com/v23.0";

export function hasWhatsAppConfig(): boolean {
  return !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

// Verifica X-Hub-Signature-256 = 'sha256=' + HMAC-SHA256(body_crudo, APP_SECRET).
// Comparación constant-time. Si no hay APP_SECRET configurado, devuelve false
// (mejor rechazar que aceptar sin verificar).
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !signatureHeader) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Handshake de alta del webhook (GET): Meta manda hub.mode/hub.verify_token/
// hub.challenge; si el token coincide con el nuestro, devolvemos el challenge.
export function verifyWebhookChallenge(params: URLSearchParams): string | null {
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  if (mode === "subscribe" && token && token === process.env.WHATSAPP_VERIFY_TOKEN) return challenge ?? "";
  return null;
}

async function send(payload: Record<string, unknown>): Promise<void> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) throw new Error("Faltan WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID");
  const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`WhatsApp send ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export async function sendText(to: string, body: string): Promise<void> {
  await send({ to, type: "text", text: { body, preview_url: false } });
}

// Botones de respuesta rápida (máx. 3). Cada uno: { id, title }.
export async function sendButtons(to: string, body: string, buttons: { id: string; title: string }[]): Promise<void> {
  await send({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: { buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })) },
    },
  });
}
