import "server-only";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { anthropic, pickModel } from "@/lib/ai/client";
import { norm } from "@/lib/clients/normalize";

// Relevancia DICEC: primero keywords (gratis, instantáneo); lo que no matchea
// lo decide la IA (Haiku, en lotes). null = sin clasificar (se reintenta).

const KEYWORDS = [
  "climatizacion", "aire acondicionado", "aires acondicionados", "acondicionador de aire",
  "hvac", "chiller", "enfriador", "enfriadora", "torre de enfriamiento", "torres de enfriamiento",
  "bomba", "bombas", "ducto", "ductos", "limpieza de ductos", "serpentin", "serpentines",
  "refrigeracion", "refrigerante", "cuarto frio", "cuartos frios", "camara fria", "camara frigorifica",
  "ventilacion", "extractor", "extractores", "manejadora", "unidad manejadora", "condensador", "condensadora",
  "evaporador", "evaporadora", "split", "fan coil", "compresor", "compresores", "deshumidificador",
  "unidad paquete", "vrf", "mini split", "aislamiento termico", "rejilla", "difusor", "termostato",
  "aire central", "sistema de enfriamiento", "agua helada",
];
const KEYWORDS_NORM = KEYWORDS.map((k) => ({ k, n: norm(k) }));

export function matchKeywords(titulo: string | null): string[] {
  if (!titulo) return [];
  const t = ` ${norm(titulo)} `;
  const hits: string[] = [];
  for (const { k, n } of KEYWORDS_NORM) {
    if (n && t.includes(n)) hits.push(k);
  }
  return hits;
}

const schema = z.object({
  resultados: z.array(
    z.object({
      i: z.number().describe("Índice del título en la lista de entrada."),
      relevante: z.boolean().describe("true si el trabajo es del rubro de DICEC."),
      motivo: z.string().describe("Razón en 3-6 palabras (ej. 'mantenimiento de chillers')."),
    }),
  ),
});

const SYSTEM = `Clasificás licitaciones públicas de Panamá para DICEC, Inc — empresa de HVAC/refrigeración.
Es RELEVANTE todo proceso cuyo objeto involucre: climatización, aires acondicionados (suministro, instalación, mantenimiento, reparación), chillers/enfriadores, torres de enfriamiento, bombas (de agua, de recirculación), ductos (fabricación, instalación, limpieza, aislamiento), serpentines, refrigeración (cuartos fríos, cámaras), ventilación/extractores, manejadoras, condensadoras, evaporadoras, VRF/splits, rejillas/difusores, agua helada, o servicios directamente asociados a estos sistemas.
NO es relevante: obras civiles generales, informática, alimentos, vehículos, medicamentos, papelería, seguridad, etc., salvo que incluyan explícitamente los sistemas de arriba.
Ante la duda razonable (ej. "remodelación integral" que probablemente incluya A/A), marcá relevante=false — solo true con señal clara.`;

export async function classifyWithAI(items: { i: number; titulo: string }[]): Promise<Map<number, { relevante: boolean; motivo: string }>> {
  const out = new Map<number, { relevante: boolean; motivo: string }>();
  for (let start = 0; start < items.length; start += 40) {
    const batch = items.slice(start, start + 40);
    try {
      const response = await anthropic.messages.parse({
        model: pickModel("micro"),
        max_tokens: 3000,
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: batch.map((b) => `${b.i}. ${b.titulo}`).join("\n"),
          },
        ],
        output_config: { format: zodOutputFormat(schema) },
      });
      for (const r of response.parsed_output?.resultados ?? []) out.set(r.i, { relevante: r.relevante, motivo: r.motivo });
    } catch {
      /* lote fallido: quedan null y se reintentan en el próximo refresh */
    }
  }
  return out;
}
