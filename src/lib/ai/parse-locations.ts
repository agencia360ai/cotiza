import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { anthropic, pickModel } from "./client";

const equipmentSchema = z.object({
  custom_name: z.string().describe("Nombre descriptivo del equipo (marca + modelo si solo eso hay)"),
  brand: z.string().nullable(),
  model: z.string().nullable(),
  category: z
    .enum([
      "nevera",
      "congelador",
      "cuarto_frio",
      "mesa_fria",
      "vitrina_refrigerada",
      "ice_maker",
      "botellero",
      "mini_split_cassette",
      "central_ac",
      "paquete_rooftop",
      "chiller",
      "manejadora",
      "piso_techo",
      "fan_coil",
      "evaporadora",
      "campana_extractora",
      "otro",
    ])
    .nullable()
    .describe(
      "Refrigeración: nevera, congelador, cuarto_frio, mesa_fria, vitrina_refrigerada, ice_maker, botellero. Aire: mini_split_cassette (lo más común), central_ac (ductos), paquete_rooftop, chiller, manejadora, piso_techo, fan_coil. Otros: evaporadora, campana_extractora, otro. AC genérico → mini_split_cassette. Null si no se infiere.",
    ),
  location_label: z
    .string()
    .nullable()
    .describe("Ubicación específica dentro de la sucursal (cocina, bar, área norte, etc.)"),
  voltage: z.string().nullable(),
  capacity_btu: z.number().nullable().describe("BTU/h sólo para A/C, no para refrigeración"),
});

const scheduleSchema = z.object({
  report_type: z.enum(["preventivo", "inspeccion", "instalacion"]),
  frequency: z
    .enum(["mensual", "bimestral", "trimestral", "semestral", "anual", "custom"])
    .describe("Default 'bimestral' si menciona 'preventivo' sin especificar (estándar HVAC en Panamá)."),
  frequency_days: z.number().nullable().describe("Sólo si frequency = 'custom', días. Null en otros casos."),
});

const locationSchema = z.object({
  name: z.string().describe("Nombre de la sucursal (ej: Sucursal Centro, Bodega Este, Local 2)"),
  address: z.string().nullable(),
  notes: z.string().nullable().describe("Notas relevantes de la sucursal (tamaño, particularidades)"),
  equipment: z.array(equipmentSchema).describe("Equipos detectados en esta sucursal."),
  schedules: z
    .array(scheduleSchema)
    .describe("Mantenimientos programados para esta sucursal. Vacío si no se mencionó."),
});

const outputSchema = z.object({
  locations: z
    .array(locationSchema)
    .describe(
      "Lista de sucursales detectadas. Si la entrada describe UNA sola sucursal, devolvé un array de 1.",
    ),
});

export type ParsedLocation = z.infer<typeof locationSchema>;
export type ParsedLocationBatch = z.infer<typeof outputSchema>;

const SYSTEM_PROMPT = `Sos un asistente que estructura sucursales y sus equipos para un cliente ya existente en una plataforma de mantenimiento HVAC en Panamá.

Tu trabajo: a partir de voz transcripta, texto, fotos o PDFs, devolver una o varias sucursales con sus equipos y mantenimientos programados.

Pautas:
- El CLIENTE ya existe — no devuelvas datos del cliente, sólo locations.
- Si la entrada describe UNA sola sucursal, devolvé locations: [una].
- Si menciona varias (ej: "agregale Sucursal A y Sucursal B"), devolvé una por cada una.
- NO inventes información. Si un campo no está claro, dejalo en null.
- Si el usuario menciona equipos sin agruparlos por sucursal, asumí una única sucursal "Sede principal" o el nombre que mejor encaje del contexto.
- Si la entrada menciona "preventivo" sin frecuencia, asumí 'bimestral' (estándar HVAC Panamá).
- Categorías de equipo válidas:
  · Refrigeración: nevera, congelador, cuarto_frio, mesa_fria, vitrina_refrigerada, ice_maker, botellero
  · Aire acondicionado: mini_split_cassette, central_ac, paquete_rooftop, chiller, manejadora, piso_techo, fan_coil
  · Otros: evaporadora, campana_extractora, otro
- Para "AC", "A/C" o "aire acondicionado" sin más detalle → usá mini_split_cassette (lo más común en Panamá).
- BTU típicos: A/C residencial 9000-36000, A/C comercial hasta 60000. NO BTU para refrigeración.
- Voltajes en Panamá: 110V (chico) y 220V (mayor).
- Si en una imagen ves placa de equipo (marca/modelo/voltaje/BTU), usá esos datos exactos.`;

export async function parseLocationsFromInput(input: {
  client_name: string;
  text: string;
  attachments?: { mimeType: string; data: Buffer; filename: string }[];
}): Promise<{ data: ParsedLocationBatch; usage: { input: number; output: number } }> {
  const userBlocks: Anthropic.MessageParam["content"] = [];

  for (const att of input.attachments ?? []) {
    if (att.mimeType === "application/pdf") {
      userBlocks.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: att.data.toString("base64") },
        title: att.filename,
      });
    } else if (att.mimeType.startsWith("image/")) {
      userBlocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: att.mimeType as "image/png" | "image/jpeg" | "image/webp",
          data: att.data.toString("base64"),
        },
      });
    }
  }

  userBlocks.push({
    type: "text",
    text: `CLIENTE: ${input.client_name}\n\n${input.text || "Estructurá la sucursal y sus equipos a partir de los archivos adjuntos."}`,
  });

  const model = pickModel("default");
  const response = await anthropic.messages.parse({
    model,
    max_tokens: 8000,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userBlocks }],
    output_config: { format: zodOutputFormat(outputSchema) },
  });

  if (!response.parsed_output) {
    throw new Error("La IA no devolvió sucursales estructuradas");
  }

  return {
    data: response.parsed_output as ParsedLocationBatch,
    usage: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
    },
  };
}
