import "server-only";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { anthropic, pickModel } from "./client";
import { bloquesDeAdjuntos, textoDeAdjuntos, comoLeerLosAdjuntos, type QuoteAdjunto } from "./generate-quote";
import { CAMPOS_TEXTO, type RefinedQuote } from "@/lib/quotes/refinar-core";

// Ajustar una cotización YA generada, hablándole en castellano.
//
// "Poné el mantenimiento mensual y los add-ons de una sola vez en renglones
// separados" es una reestructuración que a mano son quince minutos de mover
// renglones y reescribir condiciones. Acá es una frase.
//
// El formato no se puede romper porque la IA no devuelve un documento: devuelve
// los MISMOS campos que ya tenía la carta. Lo que dibuja el PDF nunca recibe
// algo que no sepa dibujar — como mucho recibe valores distintos.

const schema = z.object({
  client_name: z.string().describe("Cliente. Dejalo IGUAL salvo que pidan cambiarlo."),
  rubro: z.enum(["DC", "DM", "DS", "DV"]).describe("DC=Contratos/obras, DM=Mantenimiento, DS=Servicio, DV=Ventas. Igual salvo que pidan cambiarlo."),
  descripcion_corta: z.string().describe("Resumen de una línea para el dashboard."),
  ubicacion: z.string().nullable().describe("Ubicación/sucursal del encabezado."),
  tipo: z.enum(["realizar", "realizados"]),
  items: z
    .array(
      z.object({
        cant: z.number(),
        desc: z.string().describe("Descripción del renglón, en el mismo estilo formal que las que ya están."),
        precio: z.number().describe("Precio unitario en B/. SIN ITBMS."),
        aparte: z
          .boolean()
          .describe(
            "true = el renglón se cotiza pero NO suma al total (se factura solo cuando el cliente lo pida). false = entra en el total.",
          ),
      }),
    )
    .min(1)
    .describe("La lista COMPLETA de renglones después del ajuste — los que no cambian van tal cual estaban."),
  aplica_itbms: z.boolean(),
  validez_dias: z.number().nullable(),
  condiciones: z.string().nullable().describe("Condiciones al pie, una por línea. null para dejar la carta sin condiciones."),
  textos_cambios: z
    .array(
      z.object({
        campo: z.enum(CAMPOS_TEXTO),
        valor: z.string().describe("El texto nuevo. Cadena vacía para BORRAR esa línea de la carta."),
      }),
    )
    .describe("Rótulos de la carta que hay que cambiar. Vacío si el pedido no habla de rótulos."),
  resumen: z.string().describe("Una línea, en castellano, de qué cambiaste. Para mostrárselo a quien pidió el ajuste."),
});

export type { RefinedQuote };

const SYSTEM = `Sos el cotizador de DICEC, Inc (HVAC/refrigeración, Panamá). Recibís una cotización YA armada y un pedido de ajuste, y devolvés la cotización ajustada.

La regla que manda: CAMBIÁ SOLO LO QUE TE PIDEN.
- Todo lo que el pedido no menciona vuelve EXACTAMENTE igual: mismas descripciones, mismos precios, mismo orden, mismo cliente, mismo rubro.
- No "mejores" redacciones que nadie te pidió tocar. Quien ajusta espera ver un cambio, no una cotización distinta.
- Devolvés SIEMPRE la lista completa de renglones, incluidos los que no cambiaron.

Sobre los renglones:
- CADA renglón tiene "aparte". false = suma al total que aprueba el cliente. true = tiene precio acordado pero NO suma: se factura solo cuando lo pidan, y sale en un bloque debajo de la oferta.
- Un contrato mensual con cargos por evento se arma así: lo recurrente con aparte=false, y el reemplazo de filtros / la recarga de refrigerante / cualquier add-on con aparte=true. Meterlos en el total haría que el cliente lea como cuota fija algo que puede no pasar nunca.
- Si te piden "que X quede fuera del total" o "que se cobre solo cuando se pida", eso es aparte=true — no una condición al pie.
- Conservá el "aparte" que ya tenía cada renglón salvo que el pedido hable de eso.
- Si te piden acortar o "que quepa en una página": el alcance repetido en cada renglón es lo que sobra. Va UNA vez en las condiciones, y cada renglón queda en equipo + capacidad + tarifa. No borres renglones ni cambies precios para acortar.
- Precios en Balboas (B/.), SIN ITBMS.
- Si te dan un precio, respetalo exacto. Si el pedido implica recalcular (ej. "subí todo 10%"), calculá bien.

Sobre los rótulos (textos_cambios): solo si el pedido habla de ellos. "Poné 'Tarifa mensual' donde dice 'Precio'" es un cambio de rótulo; "cambiá el precio del renglón 2" no lo es.

Estilo: español técnico HVAC formal panameño, igual al que ya tienen los renglones existentes.`;

export type ContextoRefinado = {
  numero: string;
  clientNames: string[];
};

export async function refineQuote(
  actual: {
    client_name: string;
    rubro: string;
    descripcion_corta: string;
    ubicacion: string | null;
    tipo: "realizar" | "realizados";
    items: { cant: number; desc: string; precio: number; aparte: boolean }[];
    aplica_itbms: boolean;
    validez: number | null;
    condiciones: string | null;
    textos: Record<string, string | null | undefined> | null;
  },
  instruccion: string,
  ctx: ContextoRefinado,
  adjuntos: QuoteAdjunto[] = [],
): Promise<RefinedQuote> {
  const content = bloquesDeAdjuntos(adjuntos);
  const textosAdjuntos = textoDeAdjuntos(adjuntos);

  content.push({
    type: "text",
    text:
      `COTIZACIÓN ACTUAL (${ctx.numero}):\n${JSON.stringify(actual, null, 1)}\n\n` +
      `CLIENTES CONOCIDOS:\n${ctx.clientNames.slice(0, 250).join("\n")}\n\n` +
      `PEDIDO DE AJUSTE:\n${instruccion || "(sin texto — el ajuste está en los archivos adjuntos)"}\n\n` +
      (textosAdjuntos ? `ARCHIVOS DE TEXTO ADJUNTOS:\n${textosAdjuntos}\n\n` : "") +
      comoLeerLosAdjuntos(adjuntos) +
      "Devolvé la cotización ajustada.",
  });

  const response = await anthropic.messages.parse({
    model: pickModel("default"),
    max_tokens: 16000,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(schema) },
  });
  if (response.stop_reason === "max_tokens") {
    throw new Error("El ajuste salió más largo de lo que entra en una respuesta. Pedí un cambio más acotado.");
  }
  if (!response.parsed_output) throw new Error("La IA no pudo ajustar la cotización");
  return response.parsed_output as RefinedQuote;
}
