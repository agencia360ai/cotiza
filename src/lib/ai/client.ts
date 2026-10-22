import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk";
import { mensajeDeIA, type ProveedorIA } from "./errores";

export type { ProveedorIA };

// Anthropic primero: es el proveedor de OpenRouter que garantiza todo lo que
// usa la plataforma (PDFs, salida estructurada, caché). require_parameters
// hace que, si Anthropic cae, la consulta vaya solo a quien soporte lo mismo —
// otro proveedor ignoraría output_config y devolvería texto que no se lee.
const RUTEO_OPENROUTER = { order: ["anthropic"], require_parameters: true };

// makeStatusError es donde el SDK arma TODOS los errores HTTP de la API. Se
// traducen acá, en el único cliente, y así cada función con IA —cotizador,
// pliegos, portal de técnicos— dice qué pasó sin tocar cada catch. Se cambia
// solo el mensaje: status, tipo y request id quedan para quien los mire.
export class ClienteIA extends Anthropic {
  readonly proveedor: ProveedorIA;

  constructor({ proveedor = "anthropic", ...opciones }: ClientOptions & { proveedor?: ProveedorIA } = {}) {
    super(opciones);
    this.proveedor = proveedor;
  }

  protected override makeStatusError(status: number, error: object, message: string | undefined, headers: Headers) {
    const e = super.makeStatusError(status, error, message, headers);
    const claro = mensajeDeIA(status, error, this.proveedor);
    if (claro) e.message = claro;
    return e;
  }

  protected override async prepareOptions(options: { method: string; path: string; body?: unknown }) {
    if (this.proveedor !== "openrouter" || options.method !== "post" || options.path !== "/v1/messages") return;
    if (options.body && typeof options.body === "object") options.body = { ...options.body, provider: RUTEO_OPENROUTER };
  }
}

// Con OPENROUTER_API_KEY las consultas van por OpenRouter, que habla el mismo
// formato que la API de Anthropic: mismos modelos, otra cuenta y otro saldo.
//
// El fallback "missing" evita que el constructor TIRE al cargar el módulo si la
// env var falta: los módulos de acciones que importan IA estáticamente dejarían
// de cargar y hasta las acciones sin IA (listados puros de DB) fallarían. Con
// el placeholder, solo las llamadas de IA fallan — con un error claro de auth.
export function opcionesDelEntorno(env: Record<string, string | undefined> = process.env) {
  if (env.OPENROUTER_API_KEY) {
    return {
      proveedor: "openrouter" as const,
      baseURL: "https://openrouter.ai/api",
      apiKey: null,
      authToken: env.OPENROUTER_API_KEY,
      defaultHeaders: { "X-Title": "Cotiza" },
    };
  }
  return { proveedor: "anthropic" as const, apiKey: env.ANTHROPIC_API_KEY ?? "missing-anthropic-api-key" };
}

export const anthropic = new ClienteIA(opcionesDelEntorno());

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

// OpenRouter nombra los mismos modelos con prefijo y punto en la versión.
export function modeloPara(id: string, proveedor: ProveedorIA): string {
  return proveedor === "openrouter" ? `anthropic/${id.replace(/-(\d+)-(\d+)$/, "-$1.$2")}` : id;
}

export function pickModel(tier: ModelTier = "default") {
  return modeloPara(MODELS[tier], anthropic.proveedor);
}
