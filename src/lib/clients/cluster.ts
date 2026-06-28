import "server-only";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { anthropic, pickModel } from "@/lib/ai/client";

const clusterSchema = z.object({
  clusters: z.array(
    z.object({
      canonical: z
        .string()
        .describe(
          "Nombre canonico limpio del cliente real: nombre comercial con acentos y mayusculas correctas, SIN sucursal y SIN sufijo legal (S.A./Inc.).",
        ),
      category: z
        .enum(["restaurante", "hotel", "retail", "oficina", "industrial", "residencial", "salud", "educacion", "otro"])
        .nullable()
        .describe("Mejor estimacion del tipo de cliente; null si no se puede inferir."),
      confidence: z.enum(["alta", "media", "baja"]).describe("alta = agrupacion obvia; baja = es una conjetura."),
      members: z
        .array(
          z.object({
            name: z.string().describe("El nombre EXACTO tal cual vino en la lista de entrada (no lo edites)."),
            branch: z
              .string()
              .nullable()
              .describe("Si este nombre es una sucursal del cliente, la etiqueta de la sucursal (ej. 'David', 'Costa del Este'); si no, null."),
          }),
        )
        .describe("Todos los nombres de entrada que pertenecen a este cliente."),
      note: z.string().nullable().describe("Nota corta opcional (ej. por que se agruparon, o una duda)."),
    }),
  ),
});

export type NameCluster = z.infer<typeof clusterSchema>["clusters"][number];

const SYSTEM = `Sos un asistente que estandariza nombres de clientes para DICEC (empresa HVAC en Panama).
Recibis una lista de nombres de cliente en texto libre (como aparecieron en cotizaciones), cada uno con su cantidad de cotizaciones.
Tu tarea: agrupar en un mismo cluster los nombres que se refieren al MISMO cliente real.

Reglas:
- Acentos y mayusculas son la misma entidad: "Cerveceria Clandestina" = "Cervecería Clandestina"; "SGS PANAMA" = "SGS Panamá".
- Abreviaturas y nombres comerciales: "EFR" = "Esa Flaca Rica"; "STRI" = "S.T.R.I Panamá" = "Smithsonian Tropical Research Institute".
- Sufijos legales (S.A., Inc., S. de R.L.) y palabras redundantes de pais/ciudad ("Panama", "Ciudad") NO distinguen clientes: ignoralos para agrupar.
- Sucursales: si un nombre es una sucursal de un cliente (ej. "Esa Flaca Rica - David", "Esa Flaca Rica Costa del Este"), ponelo en el cluster del cliente padre y completá "branch" con la etiqueta de la sucursal (ej. "David", "Costa del Este").
- Entidades publicas (CSS, hospitales): agrupá variantes del mismo edificio/entidad. Ej. "Hospital Rafael Estévez, Aguadulce" = "CSS HRRE Aguadulce" = "HRRE Aguadulce CSS".
- canonical: el nombre comercial limpio, SIN sucursal y SIN sufijo legal.
- Cada nombre de entrada debe aparecer en EXACTAMENTE un cluster, con su string EXACTO en members[].name.
- Si un nombre no tiene variantes, igual va en su propio cluster con un solo member.
- IMPORTANTE: sé conservador. No fusiones clientes distintos solo porque se parecen (ej. dos empresas distintas con apellido comun). Ante la duda, dejalos separados y marcá confidence "baja".`;

export async function clusterClientNames(names: { name: string; count: number }[]): Promise<NameCluster[]> {
  if (names.length === 0) return [];
  const list = names.map((n) => `- ${n.name}  (${n.count})`).join("\n");
  const response = await anthropic.messages.parse({
    model: pickModel("deep"),
    max_tokens: 16000,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: `Lista de nombres de cliente (con cantidad de cotizaciones entre parentesis). Agrupá los que sean el mismo cliente real.\n\n${list}`,
      },
    ],
    output_config: { format: zodOutputFormat(clusterSchema) },
  });
  if (!response.parsed_output) throw new Error("La IA no pudo agrupar los nombres");
  return response.parsed_output.clusters;
}
