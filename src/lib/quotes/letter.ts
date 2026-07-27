// Carta de cotización DICEC — tipos y helpers compartidos entre el cotizador
// (preview editable) y la vista imprimible. Formato tomado del generador HTML
// de DICEC (fecha larga, Referencia, tabla de renglones, ITBMS, oferta, firma).

export type LetterItem = { cant: number; desc: string; precio: number };

// Textos de la carta que el usuario puede reescribir a mano. TODOS opcionales:
// null/undefined = usar el texto por defecto de DICEC. Así las cartas viejas
// (sin overrides) se siguen viendo exactamente igual.
export type LetterTextos = {
  saludo?: string | null; // "Presente"
  ref_label?: string | null; // "Referencia"
  ref_texto?: string | null; // "Cotización DC 26-108."
  intro?: string | null; // "Por este medio nos complace presentarles…"
  th_cant?: string | null;
  th_desc?: string | null;
  th_precio?: string | null;
  th_total?: string | null;
  lbl_subtotal?: string | null;
  lbl_itbms?: string | null; // "ITBMS (7%)"
  lbl_total?: string | null;
  oferta?: string | null; // "Nuestra oferta es por:"
  validez_texto?: string | null; // "Esta cotización tiene una validez de 30 días."
  empresa?: string | null; // "DICEC, INC"
};

// Firma PNG posicionada libremente. Coordenadas en FRACCIONES de la página
// (0..1) para que el preview HTML (8.5in × 11in) y el PDF (612 × 792 pt)
// coincidan exactamente sin convertir unidades. x/y = esquina superior izquierda.
export type LetterFirma = {
  id: string; // fila de cotiza.quote_signatures
  x: number;
  y: number;
  w: number; // ancho; el alto sale del aspect ratio de la imagen
};

export type LetterData = {
  fecha: string; // YYYY-MM-DD
  ubicacion: string | null;
  tipo: "realizar" | "realizados";
  items: LetterItem[];
  aplica_itbms: boolean;
  tasa: number; // % (7 en Panamá)
  validez: number | null; // días
  condiciones: string | null;
  elaborado: string | null;
  textos?: LetterTextos | null;
  firma?: LetterFirma | null;
};

// Textos por defecto + los que el usuario haya reescrito. Fuente ÚNICA de la
// verdad: la usan el preview HTML, el editor y el PDF, así los tres dicen lo
// mismo. Un override vacío ("") cuenta como texto propio: permite BORRAR una
// línea de la carta, no solo cambiarla.
export function resolveTextos(
  letter: Pick<LetterData, "tipo" | "tasa" | "validez" | "textos">,
  ctx: { quoteNumber: string },
): Required<{ [K in keyof LetterTextos]: string }> {
  const t = letter.textos ?? {};
  const pick = (v: string | null | undefined, def: string) => (v === null || v === undefined ? def : v);
  return {
    saludo: pick(t.saludo, "Presente"),
    ref_label: pick(t.ref_label, "Referencia"),
    ref_texto: pick(t.ref_texto, `Cotización ${numeroCarta(ctx.quoteNumber)}.`),
    intro: pick(
      t.intro,
      `Por este medio nos complace presentarles la cotización correspondiente a los ${
        letter.tipo === "realizados" ? "trabajos realizados" : "trabajos a realizar"
      }:`,
    ),
    th_cant: pick(t.th_cant, "Cant."),
    th_desc: pick(t.th_desc, "Descripción"),
    th_precio: pick(t.th_precio, "Precio"),
    th_total: pick(t.th_total, "Total"),
    lbl_subtotal: pick(t.lbl_subtotal, "Subtotal"),
    lbl_itbms: pick(t.lbl_itbms, `ITBMS (${letter.tasa}%)`),
    lbl_total: pick(t.lbl_total, "Total"),
    oferta: pick(t.oferta, "Nuestra oferta es por:"),
    validez_texto: pick(
      t.validez_texto,
      letter.validez && letter.validez > 0 ? `Esta cotización tiene una validez de ${letter.validez} días.` : "",
    ),
    empresa: pick(t.empresa, "DICEC, INC"),
  };
}

export function letterTotals(d: Pick<LetterData, "items" | "aplica_itbms" | "tasa">): {
  subtotal: number;
  itbms: number;
  total: number;
} {
  const subtotal = d.items.reduce((a, it) => a + (Number(it.cant) || 0) * (Number(it.precio) || 0), 0);
  const itbms = d.aplica_itbms ? subtotal * ((Number(d.tasa) || 0) / 100) : 0;
  return { subtotal, itbms, total: subtotal + itbms };
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export function fechaLarga(iso: string | null): string {
  if (!iso) return "";
  const p = iso.split("-");
  if (p.length !== 3) return iso;
  const y = +p[0], mo = +p[1] - 1, da = +p[2];
  if (Number.isNaN(da) || mo < 0 || mo > 11) return iso;
  return `${da} de ${MESES[mo]} de ${y}`;
}

export function fmtBal(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// "COT DC 26-108" → "DC 26-108" (la carta dice "Cotización DC 26-108.")
export function numeroCarta(quoteNumber: string): string {
  return quoteNumber.replace(/^COT\s+/i, "").trim();
}
