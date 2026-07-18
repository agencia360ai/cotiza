import { NextResponse } from "next/server";
import { verifyWebhookChallenge, verifyWebhookSignature } from "@/lib/whatsapp/client";
import { processAttendanceWebhook } from "@/lib/whatsapp/attendance";

export const runtime = "nodejs"; // crypto para HMAC
export const dynamic = "force-dynamic";

// Webhook de la WhatsApp Cloud API (asistencia por ubicación).
// GET: handshake de alta (Meta manda hub.challenge). POST: mensajes entrantes.

export async function GET(req: Request) {
  const challenge = verifyWebhookChallenge(new URL(req.url).searchParams);
  if (challenge === null) return new NextResponse("forbidden", { status: 403 });
  return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

export async function POST(req: Request) {
  // Firma sobre el BODY CRUDO (bytes exactos), no sobre JSON re-serializado.
  const raw = await req.text();
  if (!verifyWebhookSignature(raw, req.headers.get("x-hub-signature-256"))) {
    return new NextResponse("invalid signature", { status: 401 });
  }
  // Devolver 200 SIEMPRE que la firma sea válida: si respondemos 5xx, Meta
  // reintenta ~1 h y puede desuscribir el webhook. Los errores de negocio van a
  // los logs, no al status code (el pipeline ya es resiliente por mensaje).
  try {
    await processAttendanceWebhook(JSON.parse(raw));
  } catch (e) {
    console.error("[asistencia] webhook error:", e instanceof Error ? e.message : e);
  }
  return NextResponse.json({ received: true });
}
