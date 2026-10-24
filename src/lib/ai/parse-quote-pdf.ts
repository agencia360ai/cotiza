import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { anthropic, pickModel } from "./client";

const schema = z.object({
  quote_number: z
    .string()
    .describe('Número de la cotización con el prefijo COT y su revisión si la tiene, ej. "COT DC 26-108" o "COT DC 26-108 REV 2". Si no aparece en el documento, derivalo del nombre del archivo.'),
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
    .describe(
      "Clasificá por el CONTENIDO del trabajo — el número casi siempre dice 'COT DC' y eso NO es el rubro. " +
        "DM = mantenimiento preventivo/programado. DS = servicio o reparación puntual (reemplazos, reparaciones, diagnósticos; típicamente < B/.5,000). " +
        "DV = venta/suministro de equipos sin instalación mayor. DC = contratos/obras/instalaciones grandes (proyectos, típicamente > B/.5,000).",
    ),
});

export type ParsedQuote = z.infer<typeof schema>;

const SYSTEM = `Sos un asistente que extrae datos de cartas de cotización de DICEC (empresa HVAC en Panamá).
Cada documento es UNA cotización. Extraé los campos pedidos con precisión.
- El número suele estar como "COT DC YY-NNN" (puede tener sufijos: A, B, R1.1, Rev 2). Devolvelo SIEMPRE con el prefijo COT y con su revisión si la tiene: si la carta dice "Cotización DC 26-249", el número es "COT DC 26-249"; si el PDF o el nombre del archivo dicen "Rev 2", va "COT DC 26-249 REV 2". Si no está en el texto, derivalo del nombre del archivo.
- amount_usd: el TOTAL de la propuesta (incluí ITBMS si está incluido en el total mostrado). Solo el número.
- rubro: el prefijo del número ("COT DC ...") es de la serie de DICEC, NO indica el rubro. Clasificá por lo que ES el trabajo: mantenimiento → DM; reparación/servicio puntual → DS; venta/suministro → DV; obra/instalación/contrato grande → DC.
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

  // Haiku: sacar seis campos de una carta no pide más, y se corre por cada
  // archivo de la carpeta — a un tercio del precio de Sonnet.
  const response = await anthropic.messages.parse({
    model: pickModel("micro"),
    max_tokens: 1200,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(schema) },
  });

  if (!response.parsed_output) throw new Error("La IA no pudo leer la cotización");
  return response.parsed_output as ParsedQuote;
}
