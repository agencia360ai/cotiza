import type { LetterData, LetterTextos } from "./letter";
import type { Rubro } from "@/lib/pipeline/types";

// Lo que la IA puede cambiar de una cotización, y cómo se aplica encima del
// borrador que había. Sin red ni SDK: acá vive la garantía de que el formato no
// se rompe, así que tiene que poder probarse sola.

/** Las llaves de LetterTextos que un ajuste puede tocar. */
export const CAMPOS_TEXTO = [
  "saludo",
  "ref_label",
  "ref_texto",
  "intro",
  "th_cant",
  "th_desc",
  "th_precio",
  "th_total",
  "lbl_subtotal",
  "lbl_itbms",
  "lbl_total",
  "oferta",
  "validez_texto",
  "empresa",
] as const;

export type CampoTexto = (typeof CAMPOS_TEXTO)[number];

/** La respuesta de la IA: los mismos campos que ya tenía la carta. */
export type RefinedQuote = {
  client_name: string;
  rubro: string;
  descripcion_corta: string;
  ubicacion: string | null;
  tipo: "realizar" | "realizados";
  items: { cant: number; desc: string; precio: number; aparte?: boolean }[];
  aplica_itbms: boolean;
  validez_dias: number | null;
  condiciones: string | null;
  textos_cambios: { campo: CampoTexto; valor: string }[];
  resumen: string;
};

/** Lo que el ajuste puede cambiar del borrador en pantalla. */
export type BorradorAjustable = {
  numero: string;
  cliente: string;
  rubro: Rubro;
  descripcionCorta: string;
  letter: LetterData;
};

export type AjusteAplicado = BorradorAjustable & { resumen: string };

export function aplicarAjuste(actual: BorradorAjustable, r: RefinedQuote): AjusteAplicado {
  // Los rótulos se MERGEAN, no se reemplazan: la IA devuelve solo los que
  // cambian, así que un ajuste sobre precios no puede borrar un encabezado que
  // alguien reescribió a mano tres ajustes atrás.
  const textos: LetterTextos = { ...(actual.letter.textos ?? {}) };
  for (const c of r.textos_cambios) textos[c.campo] = c.valor;

  return {
    numero: actual.numero, // el correlativo no lo decide la IA
    cliente: r.client_name,
    rubro: r.rubro as Rubro,
    descripcionCorta: r.descripcion_corta,
    letter: {
      ...actual.letter,
      // fecha, tasa, elaborado y firma se preservan a propósito: la fecha es la
      // del documento, la tasa es la ley panameña, el elaborado es quién firma,
      // y la firma es un PNG posicionado a mano sobre la hoja. Ninguna de las
      // cuatro es algo que un ajuste de texto deba poder mover.
      ubicacion: r.ubicacion,
      tipo: r.tipo,
      items: r.items,
      aplica_itbms: r.aplica_itbms,
      validez: r.validez_dias,
      condiciones: r.condiciones,
      textos: Object.keys(textos).length ? textos : null,
    },
    resumen: r.resumen,
  };
}
