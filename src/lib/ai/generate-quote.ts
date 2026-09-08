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
        aparte: z
          .boolean()
          .describe(
            "true SOLO si el renglón tiene precio acordado pero no debe sumar al total (cargo por evento, add-on a pedido). Casi siempre false.",
          ),
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
- Cada renglón lleva "aparte": false suma al total, true se cotiza pero se factura solo cuando el cliente lo pida (y sale debajo de la oferta). Usá true cuando el pedido diga "por evento", "cuando se solicite", "aparte del total" o similar; en la duda, false.
- No inventes condiciones que el usuario no dio (validez default 30 días).`;

export type QuoteImage = { data: string; mime: "image/jpeg" | "image/png" | "image/webp" };

/**
 * Lo que el ingeniero adjunta al cotizar.
 *
 * Tres formas porque la API las trata distinto: una imagen va como bloque
 * `image`, un PDF como bloque `document` (Claude lo lee entero, texto y
 * páginas escaneadas), y un archivo de texto se pega en el prompt — mandarlo
 * como documento no aporta nada y gasta tokens de más.
 */
export type QuoteAdjunto =
  | { kind: "image"; name: string; data: string; mime: QuoteImage["mime"] }
  | { kind: "pdf"; name: string; data: string }
  | { kind: "text"; name: string; text: string };

export type Bloque =
  | { type: "image"; source: { type: "base64"; media_type: QuoteImage["mime"]; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string }; title?: string }
  | { type: "text"; text: string };

/** Imágenes y PDF como bloques de contenido. El texto va aparte, en el prompt. */
export function bloquesDeAdjuntos(adjuntos: QuoteAdjunto[]): Bloque[] {
  const out: Bloque[] = [];
  for (const a of adjuntos) {
    if (a.kind === "image") {
      out.push({ type: "image", source: { type: "base64", media_type: a.mime, data: a.data } });
    } else if (a.kind === "pdf") {
      out.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: a.data }, title: a.name });
    }
  }
  return out;
}

/** Los adjuntos de texto, delimitados por nombre para saber qué vino de dónde. */
export function textoDeAdjuntos(adjuntos: QuoteAdjunto[]): string {
  return adjuntos
    .filter((a): a is Extract<QuoteAdjunto, { kind: "text" }> => a.kind === "text")
    .map((a) => `--- ${a.name} ---\n${a.text}`)
    .join("\n\n");
}

// Qué se le dice a la IA que tiene delante. Sin esto, un PDF de especificación
// y una foto de notas manuscritas se leen igual, y no son lo mismo: del primero
// hay que sacar alcance y cantidades, del segundo también los precios a mano.
export function comoLeerLosAdjuntos(adjuntos: QuoteAdjunto[]): string {
  if (adjuntos.length === 0) return "";
  const tipos = new Set(adjuntos.map((a) => a.kind));
  const partes = [
    `Hay ${adjuntos.length} archivo(s) adjunto(s): ${adjuntos.map((a) => a.name).join(", ")}.`,
    "Extraé de ahí equipo, alcance, cantidades y precios que aparezcan.",
  ];
  if (tipos.has("image")) {
    partes.push("Las fotos pueden ser notas manuscritas, placas de equipo o una cotización previa en papel.");
  }
  if (tipos.has("pdf")) {
    partes.push("Los PDF pueden ser especificaciones, pliegos o cotizaciones anteriores; respetá sus cantidades y descripciones técnicas.");
  }
  partes.push("El texto del pedido complementa o CORRIGE lo que digan los archivos: si se contradicen, gana el texto.");
  return partes.join(" ") + "\n\n";
}

export async function generateQuote(
  brief: string,
  clientNames: string[],
  adjuntos: QuoteAdjunto[] = [],
): Promise<GeneratedQuote> {
  const list = clientNames.slice(0, 250).join("\n");
  const content = bloquesDeAdjuntos(adjuntos);
  const textos = textoDeAdjuntos(adjuntos);

  content.push({
    type: "text",
    text:
      `LISTA DE CLIENTES:\n${list}\n\nPEDIDO:\n${brief || "(sin texto — usá los archivos adjuntos)"}\n\n` +
      (textos ? `ARCHIVOS DE TEXTO ADJUNTOS:\n${textos}\n\n` : "") +
      comoLeerLosAdjuntos(adjuntos) +
      "Generá la cotización.",
  });

  const response = await anthropic.messages.parse({
    model: pickModel("default"),
    // 2000 alcanzaba para un pedido de una línea, pero no para lo que la gente
    // pega de verdad: un pliego con veinte renglones y una lista larga de
    // exclusiones. Al cortarse a mitad del JSON el error que salía era
    // "Unterminated string in JSON at position 5968", que no le dice a nadie
    // que el problema fue el largo. El resto de los generadores del proyecto
    // usan 16000 por lo mismo.
    max_tokens: 16000,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(schema) },
  });
  // Si aun así se corta, decirlo en castellano: el error crudo del parser
  // manda a buscar un bug de formato donde lo que hubo fue un texto muy largo.
  if (response.stop_reason === "max_tokens") {
    throw new Error(
      "La cotización salió más larga de lo que entra en una respuesta. Acortá el pedido (o partilo en dos cotizaciones) y volvé a intentar.",
    );
  }
  if (!response.parsed_output) throw new Error("La IA no pudo generar la cotización");
  return response.parsed_output as GeneratedQuote;
}
