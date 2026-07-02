import "server-only";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { anthropic, pickModel } from "./client";

const schema = z.object({
  client_name: z
    .string()
    .describe("Cliente destinatario. Si coincide con uno de la LISTA DE CLIENTES provista, usá EXACTAMENTE ese nombre."),
  ubicacion: z.string().nullable().describe("Ubicación/sucursal del trabajo para el encabezado (ej. 'Sucursal David, Chiriquí')."),
  tipo: z.enum(["realizar", "realizados"]).describe("'realizar' = trabajos a realizar (default); 'realizados' si ya se hicieron."),
  rubro: z.enum(["DC", "DM", "DS", "DV"]).describe("DC=Contratos/obras, DM=Mantenimiento, DS=Servicio/reparaciones, DV=Ventas/Suministro."),
  items: z
    .array(
      z.object({
        cant: z.number().describe("Cantidad."),
        desc: z.string().describe("Descripción formal del renglón en español técnico HVAC (equipo, capacidad, alcance)."),
        precio: z.number().describe("Precio unitario en B/. SIN ITBMS."),
      }),
    )
    .min(1)
    .describe("Renglones de la cotización. Si el usuario dio un precio total, respetalo (un renglón o distribuido)."),
  aplica_itbms: z.boolean().describe("true por defecto (se suma 7%). false solo si piden explícitamente sin ITBMS/exento."),
  validez_dias: z.number().nullable().describe("Días de validez si se mencionan; si no, 30."),
  condiciones: z
    .string()
    .nullable()
    .describe("Condiciones extra SOLO si el usuario las menciona (anticipo, tiempo de entrega, garantía...). Una por línea."),
  descripcion_corta: z.string().describe("Resumen de una línea para el dashboard (ej. 'Reemplazo de compresor 5HP cuarto frío')."),
});

export type GeneratedQuote = z.infer<typeof schema>;

const SYSTEM = `Sos el cotizador de DICEC, Inc (Design Installation Consulting Engineering Company), empresa HVAC/refrigeración en Panamá.
Convertís una descripción breve (una línea) en una cotización formal completa.

Reglas:
- Redactá los renglones como en una carta formal panameña de HVAC: equipo con marca/capacidad si se da, alcance del trabajo (suministro, instalación, mano de obra, materiales).
- Precios en Balboas (B/.), SIN ITBMS (el 7% se suma aparte salvo que digan lo contrario).
- Si el usuario da precio(s), respetalos EXACTAMENTE. Si dice "X más ITBMS", X es el precio sin ITBMS. Si dice "ITBMS incluido", calculá el precio base = X / 1.07.
- Si NO da precio, estimá un precio razonable de mercado panameño para ese trabajo y dejalo evidente en la descripción corta que es estimado.
- Rubro por el CONTENIDO del trabajo (no por el número): mantenimiento preventivo/programado → DM; reparación/servicio puntual (reemplazos, diagnósticos; típicamente < B/.5,000) → DS; venta/suministro de equipos → DV; obra/instalación grande o contrato (típicamente > B/.5,000) → DC.
- Si menciona un cliente de la LISTA DE CLIENTES, usá ese nombre exacto.
- No inventes condiciones que el usuario no dio (validez default 30 días).`;

export async function generateQuote(brief: string, clientNames: string[]): Promise<GeneratedQuote> {
  const list = clientNames.slice(0, 250).join("\n");
  const response = await anthropic.messages.parse({
    model: pickModel("default"),
    max_tokens: 2000,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: `LISTA DE CLIENTES:\n${list}\n\nPEDIDO:\n${brief}\n\nGenerá la cotización.`,
      },
    ],
    output_config: { format: zodOutputFormat(schema) },
  });
  if (!response.parsed_output) throw new Error("La IA no pudo generar la cotización");
  return response.parsed_output as GeneratedQuote;
}
