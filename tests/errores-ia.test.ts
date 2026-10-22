import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { mensajeDeIA, sinSaldo } from "../src/lib/ai/errores";
import { ClienteIA, modeloPara, opcionesDelEntorno } from "../src/lib/ai/client";

const err = (type: string, message: string) => ({ type: "error", error: { type, message } });

// El cuerpo exacto que llegó a la pantalla del cotizador.
const SALDO = err(
  "invalid_request_error",
  "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
);

test("saldo agotado: se dice qué pasó y dónde se arregla, aunque llegue como 400 genérico", () => {
  assert.equal(mensajeDeIA(400, SALDO), sinSaldo());
  assert.match(sinSaldo(), /console\.anthropic\.com/);
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
      assert.equal(e.message, sinSaldo());
      assert.equal(e.status, 400);
      assert.equal(e.requestID, "req_prueba");
      return true;
    },
  );
});

test("sin OPENROUTER_API_KEY sigue yendo directo a Anthropic", () => {
  assert.equal(opcionesDelEntorno({ ANTHROPIC_API_KEY: "sk-ant" }).proveedor, "anthropic");
  assert.equal(opcionesDelEntorno({ ANTHROPIC_API_KEY: "sk-ant", OPENROUTER_API_KEY: "" }).proveedor, "anthropic");
  assert.equal(opcionesDelEntorno({ ANTHROPIC_API_KEY: "sk-ant", OPENROUTER_API_KEY: "sk-or" }).proveedor, "openrouter");
});

test("OpenRouter nombra los mismos modelos con prefijo y punto", () => {
  assert.equal(modeloPara("claude-sonnet-4-6", "openrouter"), "anthropic/claude-sonnet-4.6");
  assert.equal(modeloPara("claude-opus-4-7", "openrouter"), "anthropic/claude-opus-4.7");
  assert.equal(modeloPara("claude-haiku-4-5", "openrouter"), "anthropic/claude-haiku-4.5");
  assert.equal(modeloPara("claude-sonnet-4-6", "anthropic"), "claude-sonnet-4-6");
});

test("con OpenRouter: su endpoint, su clave, Anthropic primero, y el pedido intacto", async () => {
  let pedido: { url: string; headers: Headers; body: Record<string, unknown> } | null = null;
  const cliente = new ClienteIA({
    ...opcionesDelEntorno({ OPENROUTER_API_KEY: "sk-or-prueba", ANTHROPIC_API_KEY: "sk-ant-no-usar" }),
    maxRetries: 0,
    fetch: async (url, init) => {
      pedido = { url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) };
      return new Response(
        JSON.stringify({
          id: "gen-1",
          type: "message",
          role: "assistant",
          model: "anthropic/claude-sonnet-4.6",
          content: [{ type: "text", text: '{"ok":true}' }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 3 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  const r = await cliente.messages.create({
    model: modeloPara("claude-sonnet-4-6", cliente.proveedor),
    max_tokens: 10,
    output_config: { format: { type: "json_schema", schema: { type: "object", properties: { ok: { type: "boolean" } } } } },
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0=" }, cache_control: { type: "ephemeral" } },
          { type: "text", text: "hola" },
        ],
      },
    ],
  });
  assert.equal(r.content[0].type === "text" && r.content[0].text, '{"ok":true}');
  const p = pedido!;
  assert.equal(p.url, "https://openrouter.ai/api/v1/messages");
  assert.equal(p.headers.get("authorization"), "Bearer sk-or-prueba");
  assert.equal(p.headers.get("x-api-key"), null, "la clave de Anthropic no viaja a OpenRouter");
  assert.equal(p.body.model, "anthropic/claude-sonnet-4.6");
  assert.deepEqual(p.body.provider, { order: ["anthropic"], require_parameters: true });
  assert.ok(p.body.output_config, "la salida estructurada viaja igual");
  const doc = (p.body.messages as { content: { type: string; cache_control?: unknown }[] }[])[0].content[0];
  assert.equal(doc.type, "document");
  assert.deepEqual(doc.cache_control, { type: "ephemeral" });
});

test("los errores de OpenRouter dicen OpenRouter y dónde se arregla", async () => {
  const sinCreditos = { error: { code: 402, message: "Insufficient credits. Add more using https://openrouter.ai/settings/credits" } };
  assert.equal(mensajeDeIA(402, sinCreditos, "openrouter"), sinSaldo("openrouter"));
  assert.match(sinSaldo("openrouter"), /openrouter\.ai\/settings\/credits/);
  assert.equal(
    mensajeDeIA(
      402,
      err("billing_error", "This request requires more credits, or fewer max_tokens. You requested up to 16000 tokens, but can only afford 900."),
      "openrouter",
    ),
    sinSaldo("openrouter"),
  );
  assert.match(mensajeDeIA(401, err("authentication_error", "No auth credentials found"), "openrouter")!, /OPENROUTER_API_KEY/);
  assert.match(
    mensajeDeIA(403, { error: { code: 403, message: "Key limit exceeded (monthly limit)." } }, "openrouter")!,
    /tope de gasto.*OpenRouter/,
  );
  assert.match(mensajeDeIA(404, err("not_found_error", "No endpoints found that can handle the requested parameters."), "openrouter")!, /OpenRouter/);
  assert.match(mensajeDeIA(503, err("api_error", "No available provider"), "openrouter")!, /OpenRouter.*saturada/);

  const cliente = new ClienteIA({
    ...opcionesDelEntorno({ OPENROUTER_API_KEY: "sk-or-prueba" }),
    maxRetries: 0,
    fetch: async () => new Response(JSON.stringify(sinCreditos), { status: 402, headers: { "content-type": "application/json" } }),
  });
  await assert.rejects(
    cliente.messages.create({ model: "anthropic/claude-sonnet-4.6", max_tokens: 10, messages: [{ role: "user", content: "hola" }] }),
    (e: unknown) => e instanceof Anthropic.APIError && e.status === 402 && e.message === sinSaldo("openrouter"),
  );
});
