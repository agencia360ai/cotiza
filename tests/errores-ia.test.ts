import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { mensajeDeIA, SIN_SALDO } from "../src/lib/ai/errores";
import { ClienteIA } from "../src/lib/ai/client";

const err = (type: string, message: string) => ({ type: "error", error: { type, message } });

// El cuerpo exacto que llegó a la pantalla del cotizador.
const SALDO = err(
  "invalid_request_error",
  "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
);

test("saldo agotado: se dice qué pasó y dónde se arregla, aunque llegue como 400 genérico", () => {
  assert.equal(mensajeDeIA(400, SALDO), SIN_SALDO);
  assert.match(SIN_SALDO, /console\.anthropic\.com/);
});

test("cada falla de la API tiene su explicación", () => {
  assert.match(mensajeDeIA(401, err("authentication_error", "invalid x-api-key"))!, /ANTHROPIC_API_KEY/);
  assert.match(mensajeDeIA(429, err("rate_limit_error", "Number of request tokens has exceeded your per-minute rate limit"))!, /un minuto/);
  assert.match(mensajeDeIA(529, err("overloaded_error", "Overloaded"))!, /saturada/);
  assert.match(mensajeDeIA(500, err("api_error", "Internal server error"))!, /saturada/);
  assert.match(mensajeDeIA(413, err("request_too_large", "Request exceeds the maximum allowed number of bytes."))!, /demasiado grande/);
  assert.match(mensajeDeIA(400, err("invalid_request_error", "prompt is too long: 250000 tokens > 200000 maximum"))!, /demasiado grande/);
  assert.match(
    mensajeDeIA(400, err("invalid_request_error", "You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC."))!,
    /tope de gasto/,
  );
});

test("un 400 desconocido muestra el texto de la API, no el JSON", () => {
  assert.equal(
    mensajeDeIA(400, err("invalid_request_error", "messages: text content blocks must be non-empty")),
    "La IA rechazó la consulta: messages: text content blocks must be non-empty",
  );
});

test("sin cuerpo reconocible no se inventa nada", () => {
  assert.equal(mensajeDeIA(400, undefined), null);
  assert.equal(mensajeDeIA(400, "texto suelto"), null);
});

// Contra el SDK de verdad: si una versión nueva deja de pasar por
// makeStatusError, esto falla en vez de volver al JSON en pantalla en silencio.
test("el cliente compartido entrega el mensaje claro y conserva status y tipo", async () => {
  const cliente = new ClienteIA({
    apiKey: "sk-prueba",
    maxRetries: 0,
    fetch: async () =>
      new Response(JSON.stringify(SALDO), {
        status: 400,
        headers: { "content-type": "application/json", "request-id": "req_prueba" },
      }),
  });
  await assert.rejects(
    cliente.messages.create({ model: "claude-sonnet-4-6", max_tokens: 10, messages: [{ role: "user", content: "hola" }] }),
    (e: unknown) => {
      assert.ok(e instanceof Anthropic.BadRequestError, "sigue siendo el error tipado del SDK");
      assert.equal(e.message, SIN_SALDO);
      assert.equal(e.status, 400);
      assert.equal(e.requestID, "req_prueba");
      return true;
    },
  );
});
