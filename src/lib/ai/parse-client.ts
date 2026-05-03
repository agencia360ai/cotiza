import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { anthropic, pickModel } from "./client";

const equipmentSchema = z.object({
  custom_name: z.string().describe("Nombre descriptivo del equipo (puede ser la marca + modelo si es lo único disponible)"),
  brand: z.string().nullable().describe("Marca (TRUE, HISENSE, RCA, etc) — null si desconocida"),
  model: z.string().nullable().describe("Modelo del equipo — null si desconocido"),
  category: z
    .enum(["nevera", "congelador", "aire_acondicionado", "evaporadora", "otro"])
    .nullable()
    .describe("Categoría del equipo. Null si no se puede inferir."),
  location_label: z
    .string()
    .nullable()
    .describe("Ubicación específica dentro de la sucursal (ej: cocina, área norte, baño principal)"),
  voltage: z.string().nullable().describe("Voltaje (110V / 220V / etc) — null si no aparece"),
  capacity_btu: z
    .number()
    .nullable()
    .describe("Capacidad BTU/h — null si no aparece. Solo para A/C, no para refrigeración."),
});

const scheduleSchema = z.object({
  location_name: z.string().describe("Nombre exacto de la sucursal (debe coincidir con una de las locations)"),
  report_type: z.enum(["preventivo", "inspeccion", "instalacion"]).describe("Tipo de mantenimiento programado"),
  frequency: z
    .enum(["mensual", "bimestral", "trimestral", "semestral", "anual", "custom"])
    .describe("Frecuencia. Default 'bimestral' si el usuario menciona 'preventivo' sin especificar."),
  frequency_days: z
    .number()
    .nullable()
    .describe("Solo si frequency = 'custom', cantidad de días. Null en otros casos."),
});

const locationSchema = z.object({
  name: z.string().describe("Nombre de la sucursal"),
  address: z.string().nullable(),
  equipment: z.array(equipmentSchema),
});

const importedClientSchema = z.object({
  client: z.object({
    name: z.string().describe("Nombre del cliente o empresa"),
    contact_email: z.string().nullable(),
    contact_phone: z.string().nullable(),
    notes: z
      .string()
      .nullable()
      .describe("Notas internas relevantes (ej: tipo de negocio, tamaño, particularidades)"),
  }),
  locations: z
    .array(locationSchema)
    .describe("Lista de sucursales/sedes/ubicaciones. Si el cliente tiene una sola, devolvé un array de 1 elemento."),
  schedules: z
    .array(scheduleSchema)
    .describe("Mantenimientos programados, uno por sucursal cuando aplica. Vacío si no se mencionó frecuencia."),
});

export type ImportedClient = z.infer<typeof importedClientSchema>;

const SYSTEM_PROMPT = `Sos un asistente que estructura datos de clientes para una plataforma de mantenimiento HVAC en Panamá.

Tu trabajo: a partir de descripción libre, listas pegadas, o documentos/fotos adjuntas, devolver un JSON estructurado con:
- Cliente (nombre, contacto, notas internas)
- Sucursales (con dirección si está disponible)
- Equipos por sucursal (marca, modelo, categoría, ubicación específica, voltaje, BTU si aplica)
- Mantenimientos programados con su frecuencia

Pautas:
- NO inventes información. Si algo no está claro, dejá el campo en null.
- Si la entrada menciona "mantenimiento preventivo" sin especificar frecuencia, asumí 'bimestral' (es lo más común en Panamá para HVAC).
- Categorías válidas: nevera, congelador, aire_acondicionado, evaporadora, otro.
- BTU típicos: A/C residencial 9000-36000, A/C comercial hasta 60000. NO uses BTU para refrigeración.
- Voltajes en Panamá: 110V (residencial / equipos chicos) y 220V (cargas mayores / A/C grandes).
- Si el usuario menciona equipos sin agruparlos por sucursal, asumí una única sucursal "Sede principal".
- location_name en schedules debe ser EXACTAMENTE igual al name de la location correspondiente.`;

export async function parseClientFromText(input: {
  text: string;
  attachments?: { mimeType: string; data: Buffer; filename: string }[];
}): Promise<{ data: ImportedClient; usage: { input: number; output: number } }> {
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
    text: input.text || "Estructurá la información del cliente a partir de los archivos adjuntos.",
  });

  const model = pickModel("default");
  const response = await anthropic.messages.parse({
    model,
    max_tokens: 4000,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userBlocks }],
    output_config: { format: zodOutputFormat(importedClientSchema) },
  });

  if (!response.parsed_output) {
    throw new Error("La IA no devolvió un cliente estructurado");
  }

  return {
    data: response.parsed_output as ImportedClient,
    usage: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
    },
  };
}
