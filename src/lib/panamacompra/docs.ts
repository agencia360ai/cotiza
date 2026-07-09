import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { anthropic, pickModel } from "@/lib/ai/client";
import { listFolder, downloadFile } from "@/lib/dropbox/client";

// Análisis de los DOCUMENTOS reales del pliego (los PDFs que el equipo pone en
// la carpeta de Dropbox de la licitación). A diferencia del viejo "¿cumplimos?"
// que solo miraba el título, esto lee el pliego completo.

export type GovDocAnalisis = {
  resumen: string;
  requisitos: string[];
  plazo: string | null;
  garantias: string | null;
  criterios: string | null;
  cumplimos: "si" | "parcial" | "no";
  motivo: string;
  banderas: string[];
  docsLeidos: number;
  at: string;
};

const schema = z.object({
  resumen: z.string().describe("2-4 frases: qué pide exactamente la licitación (objeto, alcance, cantidades clave)."),
  requisitos: z.array(z.string()).max(12).describe("Requisitos y entregables clave detectados en los documentos (equipos, capacidades, certificaciones, experiencia)."),
  plazo: z.string().nullable().describe("Plazo de entrega/ejecución si aparece (ej. '45 días calendario')."),
  garantias: z.string().nullable().describe("Fianzas/garantías exigidas (propuesta, cumplimiento, %) si aparecen."),
  criterios: z.string().nullable().describe("Criterios de evaluación/adjudicación (precio, técnico, etc.) si aparecen."),
  cumplimos: z.enum(["si", "parcial", "no"]).describe("¿DICEC (HVAC/refrigeración) puede cumplir el alcance según los documentos?"),
  motivo: z.string().describe("2-3 frases: por qué sí/parcial/no, en base a lo leído."),
  banderas: z.array(z.string()).max(6).describe("Señales de riesgo (obra civil incluida, marca cerrada, plazo corto, requisitos difíciles)."),
});

const SYSTEM = `Sos el analista técnico-comercial de DICEC, Inc (Panamá), empresa de HVAC, climatización y refrigeración.

Te paso los DOCUMENTOS de un pliego de licitación pública (PDFs: pliego de cargos, especificaciones técnicas, renglones, condiciones). Leelos y extraé lo que DICEC necesita para decidir si participar y armar el precio.

Capacidades de DICEC: chillers y agua helada, torres de enfriamiento, cuartos fríos/refrigeración comercial e industrial, unidades manejadoras (UMA/AHU), fan coils, VRF, splits, A/A institucional, ductos de aire (fabricación/instalación/limpieza/aislamiento), controles y gases refrigerantes, bombas de recirculación HVAC.
NO hace por sí sola: obra civil mayor, instalación eléctrica de potencia, plomería sanitaria, suministros ajenos al rubro.

Sé concreto y fiel a los documentos; si un dato no está, devolvé null (no inventes). cumplimos="parcial" cuando parte del alcance requiere subcontratar (obra civil/eléctrica) o mezcla rubros.`;

const MAX_FILES = 6;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024; // límite práctico de Claude por request
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export async function analyzeTenderDocs(input: {
  folderPath: string;
  titulo: string | null;
}): Promise<{ ok: true; data: GovDocAnalisis } | { ok: false; error: string }> {
  let entries;
  try {
    entries = await listFolder(input.folderPath);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo leer la carpeta de Dropbox" };
  }
  const files = entries
    .filter((e) => e.tag === "file")
    .filter((e) => /\.(pdf|png|jpe?g|webp)$/i.test(e.name))
    .sort((a, b) => (/\.pdf$/i.test(b.name) ? 1 : 0) - (/\.pdf$/i.test(a.name) ? 1 : 0)); // PDFs primero
  if (files.length === 0) {
    return { ok: false, error: "La carpeta no tiene PDFs todavía. Sube los documentos del pliego a Dropbox y reintenta." };
  }

  const content: Anthropic.MessageParam["content"] = [];
  let total = 0;
  let leidos = 0;
  for (const f of files) {
    if (leidos >= MAX_FILES || total + f.size > MAX_TOTAL_BYTES) break;
    if (f.size > MAX_FILE_BYTES) continue;
    let buf: Buffer;
    try {
      buf = await downloadFile(f.path);
    } catch {
      continue;
    }
    total += buf.length;
    leidos++;
    if (/\.pdf$/i.test(f.name)) {
      content.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") },
        title: f.name,
      });
    } else {
      const mime = /\.png$/i.test(f.name) ? "image/png" : /\.webp$/i.test(f.name) ? "image/webp" : "image/jpeg";
      content.push({ type: "image", source: { type: "base64", media_type: mime, data: buf.toString("base64") } });
    }
  }
  if (leidos === 0) return { ok: false, error: "No se pudieron descargar los documentos de Dropbox." };

  content.push({
    type: "text",
    text: `Licitación: ${input.titulo ?? "(sin título)"}\nAnalizá los ${leidos} documento(s) adjuntos y devolvé el análisis para DICEC.`,
  });

  try {
    const response = await anthropic.messages.parse({
      model: pickModel("default"), // Sonnet — pliegos densos
      max_tokens: 2500,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
      output_config: { format: zodOutputFormat(schema) },
    });
    const parsed = response.parsed_output;
    if (!parsed) return { ok: false, error: "La IA no devolvió un análisis válido." };
    return { ok: true, data: { ...parsed, docsLeidos: leidos, at: new Date().toISOString() } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo analizar los documentos" };
  }
}
