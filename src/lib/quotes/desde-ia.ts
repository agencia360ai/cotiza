import type { GeneratedQuote } from "@/lib/ai/generate-quote";
import type { LetterData } from "./letter";
import { normalizarPropuesta } from "./propuesta";

// La carta que sale de lo que armó la IA. La usan el cotizador al generar y la
// revisión editable al pasar a la plataforma un PDF hecho a mano: las dos
// tienen que leer igual los renglones, o una revisión perdería lo que la otra
// conserva.
export function cartaDeGenerada(
  g: GeneratedQuote,
  opts: { formato: "carta" | "propuesta"; fecha: string; elaborado: string | null; contacto: string | null; cliente: string },
): LetterData {
  return {
    fecha: opts.fecha,
    ubicacion: g.ubicacion,
    tipo: g.tipo,
    // `aparte` viaja: la IA marca los cargos por evento al generar, y sin esto
    // se perdían acá y todo terminaba dentro del total.
    items: g.items.map((it) => ({
      cant: it.cant,
      desc: it.desc,
      precio: it.precio,
      aparte: it.aparte || undefined,
      ...(opts.formato === "propuesta" && it.titulo ? { titulo: it.titulo } : {}),
    })),
    aplica_itbms: g.aplica_itbms,
    tasa: 7,
    validez: g.validez_dias ?? 30,
    condiciones: g.condiciones,
    elaborado: opts.elaborado,
    formato: opts.formato,
    propuesta:
      opts.formato === "propuesta"
        ? normalizarPropuesta({ ...(g.propuesta ?? {}), contacto: opts.contacto, plano: null }, opts.cliente)
        : null,
  };
}
