import "server-only";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { anthropic, pickModel } from "@/lib/ai/client";
import { norm } from "@/lib/clients/normalize";

// Relevancia DICEC en dos capas:
//   1. Keywords FUERTES (inequívocamente HVAC) con límite de palabra → relevante directo.
//   2. Todo lo demás lo decide la IA con la taxonomía del tool Java original
//      (12 categorías, "Aires Acondicionados o Climas" = lo de DICEC) + regla
//      explícita para bombas/ductos (ambiguos: ducto pluvial/eléctrico NO cuenta).
// Los matches parciales dentro de palabras (proDUCTOs, vigaDUCTO) no cuentan.

const STRONG_KEYWORDS = [
  "climatizacion", "aire acondicionado", "aires acondicionados", "acondicionador de aire", "aire central",
  "hvac", "chiller", "chillers", "enfriador", "enfriadora", "enfriadores", "enfriadoras",
  "torre de enfriamiento", "torres de enfriamiento", "limpieza de ductos",
  "serpentin", "serpentines", "refrigeracion", "refrigerante", "cuarto frio", "cuartos frios",
  "camara fria", "camaras frias", "camara frigorifica", "manejadora", "manejadoras", "unidad manejadora",
  "fan coil", "vrf", "mini split", "minisplit", "split", "splits", "agua helada", "agua fria",
  "unidad paquete", "deshumidificador", "evaporadora", "evaporadoras", "condensadora", "condensadoras",
  "sistema de enfriamiento",
];

// Pueden ser de otro rubro (ducto pluvial/eléctrico, bomba de pozo, extractor
// industrial...) → los decide la IA.
const AMBIG_KEYWORDS = [
  "bomba", "bombas", "ducto", "ductos", "ventilacion", "extractor", "extractores",
  "compresor", "compresores", "condensador", "evaporador", "rejilla", "rejillas",
  "difusor", "difusores", "termostato", "aislamiento termico",
];

function toRegex(kw: string): RegExp {
  // límite de palabra + tolerancia de plural simple en la última palabra
  const escaped = norm(kw).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:s|es)?(?:$|[^a-z0-9])`);
}
const STRONG = STRONG_KEYWORDS.map((k) => ({ k, re: toRegex(k) }));
const AMBIG = AMBIG_KEYWORDS.map((k) => ({ k, re: toRegex(k) }));

export function matchKeywords(titulo: string | null): { strong: string[]; ambiguous: string[] } {
  if (!titulo) return { strong: [], ambiguous: [] };
  const t = norm(titulo);
  return {
    strong: STRONG.filter(({ re }) => re.test(t)).map(({ k }) => k),
    ambiguous: AMBIG.filter(({ re }) => re.test(t)).map(({ k }) => k),
  };
}

const schema = z.object({
  resultados: z.array(
    z.object({
      i: z.number().describe("Índice del título en la lista de entrada."),
      categoria: z
        .enum([
          "Construcción e Infraestructura",
          "Equipos y Suministros Médicos",
          "Educación y Suministros Escolares",
          "Seguridad y Vigilancia",
          "Tecnología y Comunicaciones",
          "Transporte y Logística",
          "Servicios Profesionales y Consultorías",
          "Medio Ambiente y Agua",
          "Alimentación y Productos de Consumo",
          "Gestión de Residuos y Evidencias",
          "Aires Acondicionados o Climas",
          "Otros",
        ])
        .describe("La categoría DOMINANTE del objeto del proceso."),
      relevante: z.boolean().describe("true SOLO si el trabajo contratado es del rubro DICEC (ver reglas)."),
      motivo: z.string().describe("3-6 palabras: por qué sí/no (ej. 'mantenimiento de chillers', 'ducto pluvial, obra civil')."),
    }),
  ),
});

const SYSTEM = `Clasificás títulos de procesos de compra pública de Panamá para DICEC, Inc — empresa de HVAC/refrigeración.

Para cada título: (1) asigná la categoría DOMINANTE de la lista, (2) decidí si es RELEVANTE para DICEC.

RELEVANTE = el TRABAJO CONTRATADO en sí es sobre estos sistemas:
- Aires acondicionados / climatización (suministro, instalación, mantenimiento, reparación)
- Refrigeración: chillers, enfriadores, cuartos fríos, cámaras frigoríficas
- Torres de enfriamiento, manejadoras, agua helada, fan coils, VRF/splits
- Ventilación mecánica / extracción de aire de edificios
- Bombas de agua de sistemas de enfriamiento/HVAC o de recirculación de edificios
- Ductos DE AIRE (fabricación, instalación, limpieza, aislamiento)

NO RELEVANTE (aunque suene parecido):
- Ductos pluviales, eléctricos, viaductos/vigaductos, alcantarillado → obra civil
- Bombas de pozos, aguas residuales, estaciones de bombeo sanitarias → Medio Ambiente y Agua
- Pintura, techos, impermeabilización, obra civil en instalaciones frías (el trabajo no es el sistema de frío)
- Compresores/extractores de uso industrial ajeno a HVAC
- Refrigeradoras domésticas / neveras de oficina como suministro menor

Regla de oro: si el objeto contratado NO es diseñar/instalar/mantener/reparar el sistema de clima/frío/aire/bombeo HVAC, relevante=false. Categoría "Aires Acondicionados o Climas" ⇒ relevante=true casi siempre.`;

export async function classifyWithAI(
  items: { i: number; titulo: string }[],
): Promise<Map<number, { relevante: boolean; motivo: string }>> {
  const out = new Map<number, { relevante: boolean; motivo: string }>();
  for (let start = 0; start < items.length; start += 40) {
    const batch = items.slice(start, start + 40);
    try {
      const response = await anthropic.messages.parse({
        model: pickModel("micro"),
        max_tokens: 4000,
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: batch.map((b) => `${b.i}. ${b.titulo}`).join("\n") }],
        output_config: { format: zodOutputFormat(schema) },
      });
      for (const r of response.parsed_output?.resultados ?? []) {
        out.set(r.i, { relevante: r.relevante, motivo: r.relevante ? r.motivo : `${r.categoria} — ${r.motivo}` });
      }
    } catch {
      /* lote fallido: quedan null y se reintentan */
    }
  }
  return out;
}
