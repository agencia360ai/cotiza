import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { anthropic, pickModel } from "./client";

const milestoneStatusEnum = z.enum(["pendiente", "en_progreso", "completado"]);

const structuredEntrySchema = z.object({
  occurred_on: z
    .string()
    .nullable()
    .describe("Fecha del evento en formato YYYY-MM-DD. Si no hay info clara, usá la fecha de captura del primer ítem agrupado."),
  text_es: z
    .string()
    .describe("Resumen narrativo en español (1-3 oraciones) de qué pasó en este punto del tiempo. Tono profesional pero claro."),
  capture_ids: z
    .array(z.string())
    .describe("IDs (uuid) de las capturas que componen esta sub-entrada. Sirve para asociar las fotos/videos a este punto."),
});

const structuredMilestoneSchema = z.object({
  milestone_id: z
    .string()
    .nullable()
    .describe("UUID del hito existente al que se agregan estas sub-entradas. null si es un hito NUEVO que la IA decide crear."),
  title: z
    .string()
    .describe("Título corto del hito. Si milestone_id está seteado, repetí el título existente."),
  description_es: z
    .string()
    .nullable()
    .describe("Descripción del hito en general (1-2 oraciones). Solo si es un hito nuevo; null si reusás uno existente."),
  status: milestoneStatusEnum.describe(
    "Estado del hito. Si todas las sub-entradas indican que terminó, marcá completado. Si está claramente avanzando, en_progreso. Default: en_progreso.",
  ),
  entries: z
    .array(structuredEntrySchema)
    .describe("Sub-entradas (días/eventos chicos) que se van a agregar a este hito en orden cronológico."),
});

const outputSchema = z.object({
  milestones: z
    .array(structuredMilestoneSchema)
    .describe("Lista de hitos a crear o actualizar a partir de las nuevas capturas."),
  processed_capture_ids: z
    .array(z.string())
    .describe("IDs de TODAS las capturas que se incluyeron en alguna sub-entrada. Las que no se procesaron quedan pendientes."),
});

export type StructuredProject = z.infer<typeof outputSchema>;

const SYSTEM_PROMPT = `Sos un asistente experto que ayuda a estructurar el avance de un proyecto de obra/instalación HVAC en Panamá a partir de capturas crudas (fotos, videos, transcripciones de voz, notas) que el técnico fue tomando en el campo.

Tu trabajo: agrupar las capturas nuevas en hitos lógicos, y dentro de cada hito, en sub-entradas cronológicas (una por día/evento chico).

Reglas:
- HITOS EXISTENTES: si una captura claramente continúa un hito que ya existe (ej. el técnico ya creó "Instalación de paneles" y ahora está cargando fotos del armado), NO crees un hito nuevo: usá milestone_id del existente y agregá una sub-entrada con la fecha/contenido nuevo.
- HITOS NUEVOS: solo creá milestone_id=null cuando las capturas tratan de algo realmente distinto a los hitos existentes (ej. recién llegan los materiales y todavía no había hito de "Recepción de materiales").
- SUB-ENTRADAS: agrupá capturas que sucedieron el mismo día o muy cercanas en el mismo evento. Cada sub-entrada tiene un texto narrativo de 1-3 oraciones describiendo qué pasó (basado en el texto/voz de las capturas y lo que se ve en las fotos).
- FECHA: si no hay fecha explícita, usá la fecha de captured_at de la primera captura del grupo. Formato YYYY-MM-DD.
- CAPTURE_IDS: cada sub-entrada debe listar los IDs de TODAS las capturas (texto, voz, foto, video) que la componen. Las fotos/videos se van a mostrar en la sub-entrada.
- TONO: profesional, en español neutro. No inventes detalles que no se ven o no se mencionan. Si la captura es vaga, escribí algo conservador ("Avance de obra" + lo poco que se sepa).
- STATUS DEL HITO: si las capturas indican explícitamente que se completó algo, marcá completado. Si recién arranca, en_progreso. Si todavía no se tocó, pendiente. Default seguro: en_progreso.
- EFICIENCIA: NO repitas información en description_es del hito si es un hito nuevo — la descripción es un resumen muy corto (ej. "Trabajo de instalación de paneles térmicos en cuarto frío"). El detalle va en las entries.
- OMITIR: si una captura es duplicada, irrelevante o un error obvio (foto borrosa sin contexto), no la incluyas en ninguna sub-entrada y dejala fuera de processed_capture_ids para que el técnico decida.`;

export async function structureProjectFromCaptures(input: {
  project: {
    id: string;
    name: string;
    project_type: string;
    description_es: string | null;
    expected_completion_date: string | null;
  };
  client_name: string;
  location_name: string | null;
  existing_milestones: {
    id: string;
    title: string;
    status: string;
    description_es: string | null;
    entry_count: number;
  }[];
  captures: {
    id: string;
    kind: "photo" | "video" | "voice" | "text";
    text: string | null;
    media_path: string | null;
    captured_at: string;
  }[];
  photos: { id: string; path: string; data: Buffer; mimeType: string }[];
}): Promise<StructuredProject> {
  if (input.captures.length === 0) {
    return { milestones: [], processed_capture_ids: [] };
  }

  const userBlocks: Anthropic.MessageParam["content"] = [];

  const milestonesContext =
    input.existing_milestones.length === 0
      ? "(no hay hitos cargados todavía — todos los nuevos hitos arrancan con milestone_id=null)"
      : input.existing_milestones
          .map(
            (m, i) =>
              `${i + 1}. milestone_id=${m.id} — "${m.title}" (${m.status})${
                m.description_es ? ` — ${m.description_es}` : ""
              } — ${m.entry_count} sub-entradas`,
          )
          .join("\n");

  const capturesContext = input.captures
    .map((c, i) => {
      const date = new Date(c.captured_at).toISOString().slice(0, 10);
      const base = `[Captura ${i + 1}] id=${c.id} fecha=${date} tipo=${c.kind.toUpperCase()}`;
      if (c.kind === "photo") return `${base} — path=${c.media_path}`;
      if (c.kind === "video") return `${base} — video path=${c.media_path}`;
      return `${base} — texto: "${(c.text ?? "").slice(0, 600)}"`;
    })
    .join("\n");

  userBlocks.push({
    type: "text",
    text: `PROYECTO: ${input.project.name} (${input.project.project_type})
CLIENTE: ${input.client_name}${input.location_name ? ` · ${input.location_name}` : ""}
${input.project.description_es ? `Descripción: ${input.project.description_es}\n` : ""}${
      input.project.expected_completion_date
        ? `Entrega prevista: ${input.project.expected_completion_date}\n`
        : ""
    }
HITOS YA CARGADOS (a usar via milestone_id si una captura los continúa):
${milestonesContext}

CAPTURAS NUEVAS A PROCESAR (en orden cronológico):
${capturesContext}

A continuación van las fotos referenciadas, en el mismo orden listado arriba (cuando aplique).`,
  });

  for (const photo of input.photos) {
    userBlocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: (photo.mimeType as "image/png" | "image/jpeg" | "image/webp") || "image/jpeg",
        data: photo.data.toString("base64"),
      },
    });
    userBlocks.push({
      type: "text",
      text: `(la foto anterior corresponde a captura id=${photo.id} path=${photo.path})`,
    });
  }

  userBlocks.push({
    type: "text",
    text: `Estructurá las capturas. Cumplí: usá milestone_id existentes cuando aplique, agrupá por día en sub-entradas, completá processed_capture_ids con TODOS los IDs que metiste en alguna sub-entrada.`,
  });

  const model = pickModel("default");
  const response = await anthropic.messages.parse({
    model,
    max_tokens: 16000,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userBlocks }],
    output_config: {
      format: zodOutputFormat(outputSchema),
    },
  });

  if (!response.parsed_output) {
    throw new Error("La IA no devolvió una estructura válida");
  }
  return response.parsed_output as StructuredProject;
}
