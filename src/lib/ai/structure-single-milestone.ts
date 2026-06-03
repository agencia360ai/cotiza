import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { anthropic, pickModel } from "./client";

const outputSchema = z.object({
  title: z
    .string()
    .describe("Título corto del hito (3-6 palabras), claro y específico."),
  description: z
    .string()
    .describe("Descripción del hito en 1-3 oraciones, en español neutro y tono profesional."),
  status: z
    .enum(["pendiente", "en_progreso", "completado"])
    .describe("Estado del hito. Default seguro: en_progreso."),
});

export type SingleMilestoneProposal = z.infer<typeof outputSchema>;

const SYSTEM_PROMPT = `Sos un asistente que ayuda a estructurar UN único hito de un proyecto de obra/instalación HVAC en Panamá.

Tu tarea: a partir de lo que el usuario escribió y/o las fotos que adjuntó, devolver UN hito con title, description, status.

Reglas:
- TITLE: corto y descriptivo (3-6 palabras). Reflejá lo que se ve y/o el texto del usuario.
- DESCRIPTION: 1-3 oraciones en español neutro, tono profesional. Si hay fotos sin texto, describí lo que se ve de manera honesta y conservadora.
- STATUS: si claramente terminó algo → completado. Si está empezando → en_progreso. Default: en_progreso.
- NUNCA inventes detalles que no estén en las imágenes ni en el texto. Si dudás, sé conservador.`;

export async function structureSingleMilestone(input: {
  project: { name: string; project_type: string; description_es: string | null };
  client_name: string;
  location_name: string | null;
  text: string | null;
  photos: { path: string; data: Buffer; mimeType: string }[];
}): Promise<SingleMilestoneProposal> {
  const userBlocks: Anthropic.MessageParam["content"] = [];

  userBlocks.push({
    type: "text",
    text: `PROYECTO: ${input.project.name} (${input.project.project_type})
CLIENTE: ${input.client_name}${input.location_name ? ` · ${input.location_name}` : ""}
${input.project.description_es ? `Descripción del proyecto: ${input.project.description_es}\n` : ""}
${
  input.text && input.text.trim()
    ? `LO QUE ESCRIBIÓ EL USUARIO:\n"${input.text.trim()}"\n`
    : "(sin texto del usuario — basate en las imágenes adjuntas)\n"
}
${input.photos.length > 0 ? `${input.photos.length} foto(s) a continuación:` : "(sin fotos)"}`,
  });

  for (const p of input.photos) {
    userBlocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type:
          (p.mimeType as "image/png" | "image/jpeg" | "image/webp") || "image/jpeg",
        data: p.data.toString("base64"),
      },
    });
  }

  userBlocks.push({
    type: "text",
    text: "Devolveme el hito estructurado.",
  });

  const response = await anthropic.messages.parse({
    model: pickModel("default"),
    max_tokens: 800,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userBlocks }],
    output_config: { format: zodOutputFormat(outputSchema) },
  });

  if (!response.parsed_output) {
    throw new Error("La IA no devolvió una propuesta válida");
  }
  return response.parsed_output as SingleMilestoneProposal;
}
