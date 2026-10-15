import Anthropic from "@anthropic-ai/sdk";
import { mensajeDeIA } from "./errores";

// makeStatusError es donde el SDK arma TODOS los errores HTTP de la API. Se
// traducen acá, en el único cliente, y así cada función con IA —cotizador,
// pliegos, portal de técnicos— dice qué pasó sin tocar cada catch. Se cambia
// solo el mensaje: status, tipo y request id quedan para quien los mire.
export class ClienteIA extends Anthropic {
  protected override makeStatusError(status: number, error: object, message: string | undefined, headers: Headers) {
    const e = super.makeStatusError(status, error, message, headers);
    const claro = mensajeDeIA(status, error);
    if (claro) e.message = claro;
    return e;
  }
}

// El fallback "missing" evita que el constructor TIRE al cargar el módulo si la
// env var falta: los módulos de acciones que importan IA estáticamente dejarían
// de cargar y hasta las acciones sin IA (listados puros de DB) fallarían. Con
// el placeholder, solo las llamadas de IA fallan — con un error claro de auth.
export const anthropic = new ClienteIA({
  apiKey: process.env.ANTHROPIC_API_KEY ?? "missing-anthropic-api-key",
});

// Model routing per Phase 2 plan:
// - default: Sonnet 4.6 — handles parsing, clarification, recommendation
// - deep:    Opus 4.7   — invoked explicitly when the engineer asks for deep analysis
// - micro:   Haiku 4.5  — slug suggestions, validation hints, autocompletes
export const MODELS = {
  default: "claude-sonnet-4-6",
  deep: "claude-opus-4-7",
  micro: "claude-haiku-4-5",
} as const;

export type ModelTier = keyof typeof MODELS;

export function pickModel(tier: ModelTier = "default") {
  return MODELS[tier];
}
