import "server-only";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, pickModel, type ModelTier } from "./client";
import { equipmentRecommendationSchema, type EquipmentRecommendation, type ProjectExtraction } from "./types";

type CatalogItem = {
  sku: string;
  name: string;
  brand: string | null;
  category: string;
  capacity_btu: number | null;
  voltage: string | null;
  unit_price_usd: number;
  notes: string | null;
};

const SYSTEM_PROMPT_BASE = `Sos un ingeniero HVAC senior especializado en proyectos en Panamá. Tu trabajo es proponer la lista de equipos para una cotización, eligiendo SKUs del catálogo provisto.

Reglas:
1. Usá SOLO SKUs que aparezcan en el catálogo. Si necesitás algo que no está, usá custom_name con descripción clara y un precio razonable estimado para Panamá.
2. Carga térmica de referencia para Panamá (clima tropical, alta humedad):
   - Residencial bien aislado: 700 BTU/m²
   - Residencial estándar: 800 BTU/m²
   - Oficina con equipo: 1000 BTU/m²
   - Comercial con vidrios grandes: 1100-1200 BTU/m²
   - Industrial: depende, calcular conservador
3. Para áreas chicas (<60 m²) → mini-splits individuales por zona.
4. Para áreas medianas (60-150 m²) → split central o varios mini-splits según zonas.
5. Para edificios (>150 m² o >3 zonas independientes) → VRF preferido.
6. SIEMPRE incluí instalación (INSTALL-MS o INSTALL-VRF según el caso) y termostatos.
7. Sumá ductería/cobre/drenajes según el tipo de sistema.
8. Sumá ITBMS NO — el sistema lo agrega después automáticamente. Solo poné los items.
9. Cantidad debe ser entera para equipos, decimal solo para tubería/ducto por metro.
10. reasoning en español, una línea, técnica pero clara.`;

export async function recommendEquipment({
  extraction,
  catalog,
  tier = "default",
}: {
  extraction: ProjectExtraction;
  catalog: CatalogItem[];
  tier?: ModelTier;
}): Promise<{ recommendation: EquipmentRecommendation; usage: { input: number; output: number; cacheRead: number }; model: string }> {
  const catalogText = catalog
    .map(
      (i) =>
        `${i.sku} | ${i.name} | brand: ${i.brand ?? "—"} | cat: ${i.category} | btu: ${i.capacity_btu ?? "—"} | ${i.voltage ?? "—"} | USD ${i.unit_price_usd}${i.notes ? ` | ${i.notes}` : ""}`,
    )
    .join("\n");

  const model = pickModel(tier);
  const response = await anthropic.messages.parse({
    model,
    max_tokens: 4000,
    system: [
      { type: "text", text: SYSTEM_PROMPT_BASE, cache_control: { type: "ephemeral" } },
      {
        type: "text",
        text: `CATÁLOGO DISPONIBLE (Panamá, USD):\n\n${catalogText}`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Proyecto a cotizar:\n\n${JSON.stringify(extraction, null, 2)}\n\nDevolvé la lista de equipos para la cotización.`,
      },
    ],
    output_config: {
      format: zodOutputFormat(equipmentRecommendationSchema),
    },
  });

  if (!response.parsed_output) {
    throw new Error("AI did not return parseable recommendation");
  }

  return {
    recommendation: response.parsed_output as EquipmentRecommendation,
    usage: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      cacheRead: response.usage.cache_read_input_tokens ?? 0,
    },
    model,
  };
}

