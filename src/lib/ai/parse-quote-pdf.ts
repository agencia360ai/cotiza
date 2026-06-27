import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { anthropic, pickModel } from "./client";

const schema = z.object({
  quote_number: z
    .string()
    .describe('Número de la cotización, ej. "COT DC 26-108". Si no aparece en el documento, derivalo del nombre del archivo.'),
  client_name: z.string().nullable().describe("Cliente / empresa a quien va dirigida la cotización."),
  amount_usd: z
    .number()
    .nullable()
    .describe("Monto TOTAL de la cotización en B/. (USD), sin símbolos ni separadores de miles. Si hay varias opciones, el total principal."),
  sent_date: z.string().nullable().describe("Fecha de la cotización en formato YYYY-MM-DD, si aparece."),
  description: z.string().nullable().describe("Resumen corto del alcance/objeto (1-2 oraciones), en español."),
  rubro: z
    .enum(["DC", "DM", "DS", "DV"])
    .nullable()
    .describe("Rubro: DC=Contratos, DM=Mantenimiento, DS=Servicio, DV=Ventas/Suministro. Inferí del contenido o del prefijo del número."),
});

export type ParsedQuote = z.infer<typeof schema>;

const SYSTEM = `Sos un asistente que extrae datos de cartas de cotización de DICEC (empresa HVAC en Panamá).
Cada documento es UNA cotización. Extraé los campos pedidos con precisión.
- El número suele estar como "COT DC YY-NNN" (puede tener sufijos: A, B, R1.1, Rev 2). Respetalo tal cual aparece; si no está en el texto, derivalo del nombre del archivo.
- amount_usd: el TOTAL de la propuesta (incluí ITBMS si está incluido en el total mostrado). Solo el número.
- Sé conservador: si un dato no está, devolvé null. No inventes.`;

export async function parseQuotePdf(input: {
  filename: string;
  data: Buffer;
  isPdf: boolean;
  imageMime?: string;
}): Promise<ParsedQuote> {
  const content: Anthropic.MessageParam["content"] = [];
  if (input.isPdf) {
    content.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: input.data.toString("base64") },
      title: input.filename,
    });
  } else {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: (input.imageMime as "image/png" | "image/jpeg" | "image/webp") || "image/jpeg",
        data: input.data.toString("base64"),
      },
    });
  }
  content.push({
    type: "text",
    text: `Nombre del archivo: ${input.filename}\nExtraé los datos de esta cotización.`,
  });

  const response = await anthropic.messages.parse({
    model: pickModel("default"),
    max_tokens: 1200,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(schema) },
  });

  if (!response.parsed_output) throw new Error("La IA no pudo leer la cotización");
  return response.parsed_output as ParsedQuote;
}
