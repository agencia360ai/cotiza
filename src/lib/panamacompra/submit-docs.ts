import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { anthropic, pickModel } from "@/lib/ai/client";
import { listFolder, downloadFile } from "@/lib/dropbox/client";

// Ensamblador de "documentos a someter": lee los PDFs del pliego (los que ya se
// bajaron a la carpeta de Dropbox) y saca la LISTA de documentos que DICEC tiene
// que presentar para participar (aviso de operación, idoneidad, paz y salvo,
// fianzas, cartas, etc.), clasificando cada uno para poder buscarlo/copiarlo de
// licitaciones pasadas o marcarlo en el checklist.

export type SubmissionDocEstado = "pendiente" | "copiado" | "falta" | "por_renovar" | "por_hacer";

export type SubmissionDoc = {
  nombre: string;
  categoria: "empresa" | "legal" | "financiero" | "tecnico" | "fianza" | "otro";
  reutilizable: boolean; // doc de empresa que se reusa entre licitaciones (aviso, idoneidad, pacto)
  renovable: boolean; // caduca / hay que verificar vigencia o hacerlo a la medida de esta licitación
  keywords: string[]; // términos para buscar el archivo en carpetas pasadas
  notas: string | null;
  // se completa en la fase de búsqueda/copia:
  estado: SubmissionDocEstado;
  copiadoDe: string | null; // carpeta de origen de donde se copió
  archivoPath: string | null; // ruta final en DOCUMENTOS A SOMETER
};

export type SubmissionPlan = {
  resumen: string;
  someterPath: string;
  documentos: SubmissionDoc[];
  at: string;
};

const schema = z.object({
  resumen: z.string().describe("2-3 frases: qué exige el pliego presentar para participar (visión general de los requisitos documentales)."),
  documentos: z
    .array(
      z.object({
        nombre: z.string().describe("Nombre del documento tal como lo pide el pliego (ej. 'Aviso de Operación', 'Certificado de Idoneidad', 'Fianza de Propuesta')."),
        categoria: z.enum(["empresa", "legal", "financiero", "tecnico", "fianza", "otro"]).describe("empresa=permisos/registros de la empresa; legal=poderes/pactos/declaraciones; financiero=estados/paz y salvo/referencias; tecnico=catálogos/experiencia/personal; fianza=garantías; otro."),
        reutilizable: z.boolean().describe("true si es un documento de la EMPRESA que se reutiliza entre licitaciones (aviso de operación, idoneidad, pacto social, registro público, referencias bancarias). false si es específico de ESTA licitación (fianza, carta de propuesta, formulario económico, declaración con el número de acto)."),
        renovable: z.boolean().describe("true si CADUCA o hay que verificar vigencia / hacerlo a la medida de esta licitación (paz y salvo CSS/DGI/Municipal, certificados con fecha de vencimiento, fianzas por monto específico)."),
        keywords: z.array(z.string()).max(6).describe("2-5 términos en minúsculas para buscar el archivo por nombre en carpetas pasadas (ej. ['aviso','operacion'], ['paz','salvo'], ['idoneidad'])."),
        notas: z.string().nullable().describe("Detalle relevante: vigencia exigida, monto/%'de fianza, formato, a quién va dirigido. null si no hay."),
      }),
    )
    .max(30)
    .describe("Todos los documentos que el pliego exige presentar para participar. No inventes: solo lo que los documentos piden."),
});

const SYSTEM = `Eres el especialista de licitaciones de DICEC, Inc (Panamá), empresa de HVAC y refrigeración. Conoces la contratación pública panameña (PanamaCompra, Ley de Contrataciones Públicas).

Te paso los DOCUMENTOS de un pliego (pliego de cargos, condiciones, especificaciones). Tu tarea: listar TODOS los documentos que el proponente debe PRESENTAR/SOMETER para participar, y clasificar cada uno.

Documentos típicos y cómo clasificarlos:
- Reutilizables (reutilizable=true): Aviso de Operación, Certificado de Idoneidad, Pacto Social/Escritura, Certificado del Registro Público, Referencias bancarias/comerciales, Poder del representante legal. Son de la empresa y se reusan entre licitaciones.
- Que caducan/verificar vigencia (renovable=true): Paz y Salvo (CSS, DGI/Nacional, Municipal), certificados con fecha de vencimiento, idoneidad si vence. Aunque se reusen, hay que confirmar que estén vigentes.
- Específicos de esta licitación (reutilizable=false): Fianza de Propuesta, Carta de Presentación/Propuesta, Formulario de Propuesta Económica, Declaraciones juradas con el número de acto, Cronograma. Se hacen a la medida de cada licitación.

Sé fiel a los documentos; si algo no se pide, no lo listes. Si un documento aplica pero no estás seguro de la vigencia, márcalo renovable=true.`;

const MAX_FILES = 6;
// Base64 infla ×4/3: 20MB crudos ≈ 26.7MB de request (tope API: 32MB).
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_FILE_BYTES = 15 * 1024 * 1024;

export async function extractRequiredDocs(input: {
  folderPath: string;
  titulo: string | null;
}): Promise<{ ok: true; data: { resumen: string; documentos: SubmissionDoc[] } } | { ok: false; error: string }> {
  let entries;
  try {
    entries = await listFolder(input.folderPath);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo leer la carpeta de Dropbox" };
  }
  const files = entries
    .filter((e) => e.tag === "file")
    .filter((e) => /\.(pdf|png|jpe?g|webp)$/i.test(e.name))
    .sort((a, b) => (/\.pdf$/i.test(b.name) ? 1 : 0) - (/\.pdf$/i.test(a.name) ? 1 : 0));
  if (files.length === 0) {
    return { ok: false, error: "La carpeta no tiene documentos todavía. Baja primero los documentos del pliego." };
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
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") }, title: f.name });
    } else {
      const mime = /\.png$/i.test(f.name) ? "image/png" : /\.webp$/i.test(f.name) ? "image/webp" : "image/jpeg";
      content.push({ type: "image", source: { type: "base64", media_type: mime, data: buf.toString("base64") } });
    }
  }
  if (leidos === 0) return { ok: false, error: "No se pudieron descargar los documentos de Dropbox." };

  content.push({
    type: "text",
    text: `Licitación: ${input.titulo ?? "(sin título)"}\nLista los documentos que DICEC debe presentar para participar, según los ${leidos} documento(s) adjuntos.`,
  });

  try {
    const response = await anthropic.messages.parse({
      model: pickModel("default"),
      max_tokens: 3000,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
      output_config: { format: zodOutputFormat(schema) },
    });
    const parsed = response.parsed_output;
    if (!parsed) return { ok: false, error: "La IA no devolvió la lista de documentos." };
    const documentos: SubmissionDoc[] = parsed.documentos.map((d) => ({
      ...d,
      notas: d.notas ?? null,
      estado: "pendiente" as const,
      copiadoDe: null,
      archivoPath: null,
    }));
    return { ok: true, data: { resumen: parsed.resumen, documentos } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo extraer la lista de documentos" };
  }
}
