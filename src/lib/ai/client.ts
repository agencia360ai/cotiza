import Anthropic from "@anthropic-ai/sdk";

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
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
