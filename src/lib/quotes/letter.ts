// Carta de cotización DICEC — tipos y helpers compartidos entre el cotizador
// (preview editable) y la vista imprimible. Formato tomado del generador HTML
// de DICEC (fecha larga, Referencia, tabla de renglones, ITBMS, oferta, firma).

export type LetterItem = { cant: number; desc: string; precio: number };

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
};

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
