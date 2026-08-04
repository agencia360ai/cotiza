import "server-only";

// Envío de correo por la API HTTP de Resend. Sin SDK a propósito: es un POST con
// JSON, y una dependencia menos que mantener. La API key vive SOLO en el entorno.
//
// EMAIL_FROM debe ser una dirección de un dominio verificado en Resend
// (ej. "Cotiza DICEC <no-reply@dicecpanama.com>"); sin dominio verificado,
// Resend solo entrega a las direcciones verificadas de la cuenta.

export type Adjunto = { filename: string; content: Uint8Array };

export function hasEmailConfig(): boolean {
  return !!process.env.RESEND_API_KEY;
}

const FROM_DEFAULT = "Cotiza DICEC <onboarding@resend.dev>";

export async function sendEmail(input: {
  to: string[];
  subject: string;
  html: string;
  attachments?: Adjunto[];
  replyTo?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "RESEND_API_KEY no está configurada" };
  const to = input.to.map((t) => t.trim()).filter(Boolean);
  if (to.length === 0) return { ok: false, error: "Sin destinatarios" };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || FROM_DEFAULT,
        to,
        subject: input.subject,
        html: input.html,
        // Responder debe escribirle a una persona, no al remitente técnico.
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
        attachments: input.attachments?.map((a) => ({
          filename: a.filename,
          content: Buffer.from(a.content).toString("base64"),
        })),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!res.ok) return { ok: false, error: body.message || body.name || `Resend HTTP ${res.status}` };
    return { ok: true, id: body.id ?? "" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo enviar el correo" };
  }
}

// Escapa lo que venga de la base antes de meterlo en el HTML del correo.
export function esc(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
