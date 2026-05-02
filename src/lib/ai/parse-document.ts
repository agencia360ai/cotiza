import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, pickModel } from "./client";
import { projectExtractionSchema, type ProjectExtraction } from "./types";

const SYSTEM_PROMPT = `Sos un asistente experto en sistemas HVAC para Panamá. Tu trabajo es analizar planos arquitectónicos, especificaciones técnicas, e imágenes de proyectos para extraer la información que necesita un ingeniero para preparar una cotización de aire acondicionado.

Considerá el contexto de Panamá:
- Clima tropical, alta humedad (~85%), temperatura promedio 27-32°C
- Sistemas más comunes: mini-splits residenciales, splits centrales para oficinas, VRF para edificios comerciales medianos, chillers para grandes superficies
- Tensiones eléctricas: 115V (residencial chico) y 230V (cargas mayores)
- Carga térmica típica: 600-800 BTU/m² para residencial bien aislado, 800-1000 BTU/m² para oficinas, 1000-1200 BTU/m² si hay mucho equipo o ventanas grandes

Extraé SOLO lo que veas o puedas inferir con razonable certeza. No inventes datos. Si una sección no está clara, dejala en null y mencionala en source_summary.`;

type DocumentInput =
  | { kind: "pdf"; data: Buffer; filename: string }
  | { kind: "image"; data: Buffer; mediaType: "image/png" | "image/jpeg" | "image/webp"; filename: string };

export async function parseProjectDocuments(
  documents: DocumentInput[],
  userContext: { name: string; description?: string | null; scope: "simple" | "complex" },
): Promise<{ extraction: ProjectExtraction; usage: { input: number; output: number; cacheRead: number }; model: string }> {
  if (documents.length === 0) {
    throw new Error("Need at least one document to parse");
  }

  const userBlocks: Anthropic.MessageParam["content"] = [];

  for (const doc of documents) {
    if (doc.kind === "pdf") {
      userBlocks.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: doc.data.toString("base64") },
        title: doc.filename,
      });
    } else {
      userBlocks.push({
        type: "image",
        source: { type: "base64", media_type: doc.mediaType, data: doc.data.toString("base64") },
      });
    }
  }

  userBlocks.push({
    type: "text",
    text: `Proyecto: ${userContext.name}
Alcance declarado: ${userContext.scope === "simple" ? "simple (residencial / oficina chica)" : "complejo (edificio / industrial)"}
${userContext.description ? `Descripción del ingeniero: ${userContext.description}` : ""}

Analizá los documentos adjuntos y devolvé un JSON con todo lo que puedas determinar sobre el proyecto.`,
  });

  const model = pickModel("default");
  const response = await anthropic.messages.parse({
    model,
    max_tokens: 4000,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userBlocks }],
    output_config: {
      format: zodOutputFormat(projectExtractionSchema),
    },
  });

  if (!response.parsed_output) {
    throw new Error("AI did not return parseable extraction");
  }

  return {
    extraction: response.parsed_output as ProjectExtraction,
    usage: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      cacheRead: response.usage.cache_read_input_tokens ?? 0,
    },
    model,
  };
}

