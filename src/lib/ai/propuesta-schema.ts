import "server-only";
import { z } from "zod";

// Lo que la IA arma para el formato Propuesta. Lo comparten la generación y el
// ajuste: si el ajuste tuviera otro esquema, cada "cambiá el plazo" devolvería
// una propuesta con campos de menos.
//
// Contacto e imágenes del plano NO están: el contacto es de quien cotiza y las
// imágenes las elige el usuario. La IA no los toca.

export const propuestaSchema = z.object({
  etiqueta: z
    .string()
    .describe("Rótulo chico sobre el título, en MAYÚSCULAS. 'PROPUESTA TÉCNICA Y ECONÓMICA' por defecto; 'PROPUESTA DE MANTENIMIENTO' para contratos de mantenimiento."),
  titulo: z
    .string()
    .describe("Título grande: el nombre del local, la marca o el proyecto del cliente ('NAZ Beauty Shop', 'Hospital Santo Tomás'). Corto, sin 'Cotización'."),
  subtitulo: z
    .string()
    .nullable()
    .describe("Qué se hace y dónde, en una línea con ' · ' de separador: 'Climatización y extracción de baños · Costa del Este'."),
  datos: z
    .array(z.object({ label: z.string(), valor: z.string() }))
    .describe("Hasta 3 datos del encabezado, en este orden si se conocen: 'Cliente' (razón social), 'Ubicación' (dirección/local), 'Base de diseño' (planos o documento de referencia). Solo los que se sepan."),
  cifras: z
    .array(z.object({ valor: z.string(), texto: z.string() }))
    .describe(
      "Hasta 4 cifras técnicas que resumen el trabajo: valor cortísimo ('18 TR', '6,000 CFM', '14 + 4', '3') y texto que lo explica ('Autocontenida 15 TR + 3 splits de 1 TR'). SOLO cifras que salgan del pedido o de los archivos — nunca inventadas. Vacío si no hay.",
    ),
  inversion: z
    .string()
    .describe("Rótulo de la banda del precio: 'Inversión · llave en mano' para suministro e instalación, 'Inversión mensual' para un contrato mensual, 'Inversión' si no aplica otro."),
  plazo: z
    .object({ label: z.string(), valor: z.string(), detalle: z.string().nullable() })
    .nullable()
    .describe("Plazo de ejecución SOLO si se menciona: label 'Instalación' o 'Entrega', valor '12 días hábiles', detalle 'Equipos en sitio: 3–4 semanas'. null si no se sabe."),
  partidas_titulo: z
    .string()
    .describe("Encabezado de la tabla de partidas: 'Partida · suministro e instalación', 'Partida · mantenimiento', 'Partida · reparación'..."),
  plano_titulo: z
    .string()
    .nullable()
    .describe("Si en los adjuntos hay un plano o esquema: su título ('Plano de aire acondicionado'). null si no hay."),
  plano_fuente: z
    .string()
    .nullable()
    .describe("De dónde sale ese plano, si se sabe ('Planos AA · FLT Estudio · oct 2026'). null si no hay."),
  condiciones: z
    .array(z.object({ label: z.string(), texto: z.string() }))
    .describe(
      "Condiciones como pares rótulo/texto, en este orden: 'Vigencia' ('30 días.'), 'Pago', 'Entrega', 'Garantía', 'No incluye'. Vigencia siempre; las demás SOLO si se mencionan o vienen en los archivos.",
    ),
});

export type PropuestaIA = z.infer<typeof propuestaSchema>;

export const REGLAS_PROPUESTA = `Formato PROPUESTA (el diseño de dos páginas con resumen, cifras, tabla de partidas y condiciones):
- Cada renglón lleva "titulo": 3 a 7 palabras que nombran la partida ("Unidad autocontenida 15 TR", "Ducto de retorno"). "desc" va DEBAJO del título como detalle técnico de UNA línea (marca, especificación, alcance), sin repetir el título.
- Agrupa en partidas por sistema o etapa (equipos, ductos, eléctrico, controles), no un renglón por tornillo.
- "propuesta" lleva el resumen del encabezado: solo datos reales del pedido o de los archivos. Cifras inventadas en un documento comercial son peores que no tener cifras.`;
