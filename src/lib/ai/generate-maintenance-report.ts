import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { anthropic, pickModel } from "./client";
import type { CaptureItem, ReportType, ReportSeverity } from "@/lib/maintenance/types";

const equipmentStatusEnum = z.enum([
  "operativo",
  "atencion",
  "critico",
  "fuera_de_servicio",
  "sin_inspeccion",
]);
const priorityEnum = z.enum(["alta", "media", "baja"]);

const reportItemSchema = z.object({
  equipment_id: z
    .string()
    .nullable()
    .describe(
      "UUID exacto del equipo existente de la lista provista. SOLO devolvé null si el equipo NO estaba en la lista (caso: el técnico instaló o detectó un equipo nuevo).",
    ),
  new_equipment: z
    .object({
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
        .nullable(),
      location_label: z.string().nullable().describe("Ubicación dentro de la sucursal"),
      voltage: z.string().nullable(),
      capacity_btu: z.number().nullable(),
    })
    .nullable()
    .describe(
      "Si equipment_id es null porque el equipo NO estaba en la lista, completá acá los datos detectados desde la captura. Se va a agregar automáticamente a la sucursal como equipo nuevo.",
    ),
  status: equipmentStatusEnum.describe("Estado del equipo según la inspección"),
  observations_es: z
    .string()
    .describe("Observaciones del estado actual en español, 1-3 oraciones concretas"),
  recommendations: z
    .array(
      z.object({
        priority: priorityEnum,
        description: z.string(),
      }),
    )
    .describe("Recomendaciones técnicas a tomar — vacío si está todo bien"),
  parts_replaced: z
    .array(
      z.object({
        name: z.string(),
        quantity: z.number().optional(),
      }),
    )
    .describe("Partes que se reemplazaron en esta visita — vacío si no se reemplazó nada"),
  checklist_items: z
    .array(z.string())
    .describe("Elementos verificados durante la inspección (Tomacorrientes, Empaques, Filtros, etc)"),
  photo_paths: z
    .array(z.string())
    .describe("Lista de paths de fotos en el bucket cotiza-maintenance que corresponden a este equipo"),
});

const reportOutputSchema = z.object({
  items: z.array(reportItemSchema).describe("Una entrada por cada equipo de la lista. INCLUIR TODOS los equipos."),
  summary_es: z.string().describe("Resumen general del reporte en español, 2-4 oraciones — qué se encontró, qué requiere acción"),
});

export type GeneratedReport = z.infer<typeof reportOutputSchema>;

const SYSTEM_PROMPT = `Sos un asistente experto en sistemas HVAC para Panamá que ayuda a técnicos en campo a redactar reportes de mantenimiento.

Tu trabajo: a partir de fotos, transcripciones de voz y notas de texto que el técnico capturó durante una visita, redactar un reporte estructurado en español neutro, conciso y profesional.

Pautas:
- Una entrada por cada equipo de la lista provista. Si no hay evidencia clara de un equipo en la captura, asignale status "operativo" y dejá observations_es como "Inspección visual sin novedades, funcionamiento normal." (no inventes problemas)
- EQUIPOS NUEVOS: Si el técnico menciona en su captura (foto/voz/texto) un equipo que NO está en la lista provista (ej: "se instaló una nevera nueva marca X", "encontré un aire que no estaba en el inventario"), devolvé un item adicional con equipment_id=null y completá new_equipment con los datos detectados (marca, modelo, categoría, voltaje, ubicación). Va a agregarse a la sucursal automáticamente.
- Status:
  - "operativo" → funcionamiento normal, sin observaciones
  - "atencion" → problemas menores que NO impiden operación pero requieren mantenimiento (empaques, controles remotos faltantes, cables expuestos, falta de protectores)
  - "critico" → problemas que afectan operación o son riesgo eléctrico/mecánico (cortocircuitos, equipos que no enfrían, fugas)
  - "fuera_de_servicio" → equipo apagado/no funcional
- Asociá cada foto a un equipo via photo_paths usando el path EXACTO que aparece junto a la foto en el contexto. Si una foto no corresponde a ningún equipo claro, no la incluyas.
- Recomendaciones: priorizá "alta" sólo para acciones críticas/seguridad, "media" para mantenimiento que no es urgente, "baja" para sugerencias preventivas.
- Checklist típico HVAC en Panamá: Tomacorrientes, Enchufe de alimentación, Empaques de puertas, Funcionamiento normal, Cordón de alimentación, Protector de voltaje, Filtros, Cables de señal, Drenaje de condensado.
- NO inventes lecturas (temperaturas, presiones) si no hay evidencia.
- Resumen general: qué se encontró, qué necesita acción. Mencioná críticos primero. Si hay equipos nuevos, mencionalos.`;

export async function generateReportFromCapture(input: {
  client_name: string;
  location_name: string;
  report_type: ReportType;
  severity: ReportSeverity | null;
  trigger_event: string | null;
  equipment: {
    id: string;
    custom_name: string;
    brand: string | null;
    model: string | null;
    category: string | null;
    location_label: string | null;
  }[];
  captures: CaptureItem[];
  photos: { path: string; data: Buffer; mimeType: string }[];
}): Promise<GeneratedReport> {
  const userBlocks: Anthropic.MessageParam["content"] = [];

  // Context block
  const equipmentList = input.equipment
    .map(
      (e, i) =>
        `${i + 1}. ID: ${e.id}\n   Marca/Modelo: ${e.brand ?? "—"} ${e.model ?? ""}\n   Nombre: ${e.custom_name}\n   Categoría: ${e.category ?? "—"}\n   Ubicación: ${e.location_label ?? "—"}`,
    )
    .join("\n\n");

  const captureContext = input.captures
    .map((c, i) => {
      if (c.kind === "photo") return `[Captura ${i + 1}] FOTO — path: ${c.photo_path}${c.equipment_id ? ` — asociada al equipo ${c.equipment_id}` : ""}`;
      if (c.kind === "voice")
        return `[Captura ${i + 1}] VOZ TRANSCRIPTA — "${c.text}"${c.equipment_id ? ` — asociada al equipo ${c.equipment_id}` : ""}`;
      return `[Captura ${i + 1}] NOTA DE TEXTO — "${c.text}"${c.equipment_id ? ` — asociada al equipo ${c.equipment_id}` : ""}`;
    })
    .join("\n");

  userBlocks.push({
    type: "text",
    text: `CLIENTE: ${input.client_name}
SUCURSAL: ${input.location_name}
TIPO DE REPORTE: ${input.report_type}${input.severity ? ` (severidad ${input.severity})` : ""}
${input.trigger_event ? `EVENTO QUE LO ORIGINÓ: ${input.trigger_event}\n` : ""}
EQUIPOS INSTALADOS EN ESTA SUCURSAL (debes generar una entrada por cada uno):

${equipmentList}

CAPTURAS DEL TÉCNICO (en orden cronológico):

${captureContext}

A continuación van las fotos en el mismo orden listado arriba. Asociá cada foto al equipo correspondiente usando el path indicado.`,
  });

  // Photo blocks
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
      text: `(la foto anterior corresponde al path: ${photo.path})`,
    });
  }

  userBlocks.push({
    type: "text",
    text: `Generá ahora el reporte estructurado. Recordá: una entrada por cada equipo de la lista, status conservador (no inventes problemas que no se ven), recomendaciones priorizadas, photo_paths con los paths EXACTOS que te di.`,
  });

  const model = pickModel("default");
  const response = await anthropic.messages.parse({
    model,
    max_tokens: 16000,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userBlocks }],
    output_config: {
      format: zodOutputFormat(reportOutputSchema),
    },
  });

  if (!response.parsed_output) {
    throw new Error("La IA no devolvió un reporte estructurado");
  }

  return response.parsed_output as GeneratedReport;
}
