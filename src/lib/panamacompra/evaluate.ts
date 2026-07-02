import "server-only";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { anthropic, pickModel } from "@/lib/ai/client";
import { hasPanamaCompraConfig, pcLogin, pcPliegoRaw, extractItems, type PliegoItem } from "./client";
import { TIPO_TO_ID } from "./sync";
import type { GovTenderEval } from "./tamiz";

// Evaluación "¿cumplimos?" para una licitación puntual (bajo demanda, botón en
// el detalle). Lee los renglones del pliego cuando puede; si no, evalúa con el
// título. El resultado se persiste en gov_tenders.eval (migración 0013).

const schema = z.object({
  cumplimos: z
    .enum(["si", "parcial", "no"])
    .describe("si = alcance dentro del rubro DICEC; parcial = parte del rubro / requiere subcontratar; no = fuera del rubro."),
  resumen: z.string().describe("2-3 frases en español: qué piden exactamente y si DICEC puede ejecutarlo."),
  requisitos: z.array(z.string()).max(6).describe("Los 3-6 requisitos/entregables clave detectados (equipos, capacidades, alcance)."),
  riesgos: z.array(z.string()).max(4).describe("Señales de riesgo comercial/técnico (0-4): obra civil incluida, plazo, marca cerrada, etc."),
});

const SYSTEM = `Sos el evaluador técnico-comercial de DICEC, Inc (Panamá), empresa de HVAC y refrigeración.

Capacidades reales de DICEC:
- Chillers y sistemas de agua helada (suministro, instalación, mantenimiento, reparación, repuestos)
- Torres de enfriamiento, bombas de recirculación HVAC, cuartos de máquinas
- Cuartos fríos, cámaras frigoríficas, refrigeración comercial/industrial
- Unidades manejadoras (UMA/AHU), fan coils, VRF, splits y A/A institucional
- Ductos de aire: fabricación, instalación, limpieza, aislamiento; rejillas y difusores
- Controles, termostatos, deshumidificación, gases refrigerantes

DICEC NO hace por sí sola: obra civil mayor, instalaciones eléctricas de potencia, plomería sanitaria,
suministros ajenos al rubro (mobiliario, informática, vehículos).

Evaluá con criterio comercial la licitación que te paso (título + renglones del pliego si hay).
Regla: si el grueso del alcance es del rubro → "si" aunque haya renglones menores ajenos (tornillería, misceláneos).
"parcial" cuando una parte significativa requiere subcontrato (obra civil/eléctrica) o el pliego mezcla rubros.
"no" cuando el objeto contratado no es del rubro.`;

function itemsToText(items: PliegoItem[]): string {
  return items
    .slice(0, 30)
    .map((i) => {
      const cant = i.cantidad !== null ? ` (${i.cantidad}${i.unidad ? ` ${i.unidad}` : ""})` : "";
      const precio = i.precioRef !== null ? ` — B/. ${i.precioRef.toFixed(2)}` : "";
      return `- ${i.descripcion}${cant}${precio}`;
    })
    .join("\n");
}

export async function evaluateTender(input: {
  titulo: string | null;
  entidad: string | null;
  tipo: string | null;
  precioRef: number | null;
  raw: unknown;
}): Promise<GovTenderEval> {
  // Renglones del pliego — mejor señal que el título. Best effort.
  let items: PliegoItem[] = extractItems(input.raw);
  if (items.length === 0 && hasPanamaCompraConfig()) {
    try {
      const rw = input.raw as { idProcesosContratacionFlujos?: string | number } | null;
      const idFlujos = rw?.idProcesosContratacionFlujos;
      const idTipo = input.tipo ? TIPO_TO_ID[input.tipo] : undefined;
      if (idFlujos && idTipo) {
        const session = await pcLogin();
        const pliego = await pcPliegoRaw(session, idTipo, String(idFlujos));
        if (pliego) items = extractItems(pliego);
      }
    } catch {
      /* sin pliego: se evalúa con el título */
    }
  }

  const partes = [
    `Título: ${input.titulo ?? "—"}`,
    `Entidad: ${input.entidad ?? "—"}`,
    `Tipo de proceso: ${input.tipo ?? "—"}`,
    `Precio de referencia: ${input.precioRef !== null ? `B/. ${input.precioRef.toFixed(2)}` : "no declarado"}`,
    items.length > 0 ? `Renglones del pliego:\n${itemsToText(items)}` : "Renglones del pliego: no disponibles (evaluá por el título).",
  ];

  const response = await anthropic.messages.parse({
    model: pickModel(),
    max_tokens: 1200,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: partes.join("\n") }],
    output_config: { format: zodOutputFormat(schema) },
  });
  const parsed = response.parsed_output;
  if (!parsed) throw new Error("La IA no devolvió una evaluación válida");
  return { ...parsed, at: new Date().toISOString() };
}
