// Formato "Propuesta" de la cotización: el diseño limpio de dos páginas sobre
// el membrete (resumen con cifras y plano, después partidas, totales y
// condiciones). Convive con la carta clásica: lo que cambia es cómo se dibuja,
// no los renglones ni los totales, que siguen siendo los de LetterData.
//
// Compartido entre el navegador (wizard) y el servidor (PDF): sin imports de
// servidor.

export type PropuestaDato = { label: string; valor: string };
export type PropuestaCifra = { valor: string; texto: string };
export type PropuestaCondicion = { label: string; texto: string };
export type PropuestaImagen = { path: string; mime: "image/png" | "image/jpeg"; nota: string | null };

export type Propuesta = {
  etiqueta: string; // "PROPUESTA TÉCNICA Y ECONÓMICA"
  titulo: string; // el proyecto o la marca: "NAZ Beauty Shop"
  subtitulo: string | null; // "Climatización y extracción de baños · Costa del Este"
  datos: PropuestaDato[]; // cliente, ubicación, base de diseño
  cifras: PropuestaCifra[]; // "18 TR" · "Autocontenida 15 TR + 3 splits de 1 TR"
  inversion: string; // etiqueta de la banda del precio: "INVERSIÓN · LLAVE EN MANO"
  plazo: { label: string; valor: string; detalle: string | null } | null;
  partidas_titulo: string; // encabezado de la tabla: "PARTIDA · SUMINISTRO E INSTALACIÓN"
  condiciones: PropuestaCondicion[];
  contacto: string | null;
  plano: { titulo: string; fuente: string | null; imagenes: PropuestaImagen[] } | null;
};

// Lo que entra en el diseño sin que se rompa: más que esto no cabe en la
// primera página, y la IA a veces propone de más.
export const LIMITES = { datos: 3, cifras: 4, imagenes: 2, condiciones: 8 } as const;

export function propuestaVacia(titulo = ""): Propuesta {
  return {
    etiqueta: "PROPUESTA TÉCNICA Y ECONÓMICA",
    titulo,
    subtitulo: null,
    datos: [],
    cifras: [],
    inversion: "INVERSIÓN",
    plazo: null,
    partidas_titulo: "PARTIDA",
    condiciones: [],
    contacto: null,
    plano: null,
  };
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const strONull = (v: unknown): string | null => str(v) || null;
const lista = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];

/**
 * Lo que viene de la base o de la IA, validado. Se descarta lo vacío y se
 * recorta a lo que entra en el diseño, así ningún dato raro llega al PDF.
 */
export function normalizarPropuesta(v: unknown, tituloPorDefecto = ""): Propuesta {
  const base = propuestaVacia(tituloPorDefecto);
  if (!v || typeof v !== "object") return base;
  const o = v as Record<string, unknown>;
  const plazo = o.plazo && typeof o.plazo === "object" ? (o.plazo as Record<string, unknown>) : null;
  const plano = o.plano && typeof o.plano === "object" ? (o.plano as Record<string, unknown>) : null;
  const imagenes = lista(plano?.imagenes)
    .filter((i) => str(i.path) && (i.mime === "image/png" || i.mime === "image/jpeg"))
    .slice(0, LIMITES.imagenes)
    .map((i) => ({ path: str(i.path), mime: i.mime as PropuestaImagen["mime"], nota: strONull(i.nota) }));
  return {
    etiqueta: str(o.etiqueta) || base.etiqueta,
    titulo: str(o.titulo) || base.titulo,
    subtitulo: strONull(o.subtitulo),
    datos: lista(o.datos)
      .map((d) => ({ label: str(d.label), valor: str(d.valor) }))
      .filter((d) => d.label && d.valor)
      .slice(0, LIMITES.datos),
    cifras: lista(o.cifras)
      .map((c) => ({ valor: str(c.valor), texto: str(c.texto) }))
      .filter((c) => c.valor)
      .slice(0, LIMITES.cifras),
    inversion: str(o.inversion) || base.inversion,
    plazo: plazo && str(plazo.valor) ? { label: str(plazo.label) || "PLAZO", valor: str(plazo.valor), detalle: strONull(plazo.detalle) } : null,
    partidas_titulo: str(o.partidas_titulo) || base.partidas_titulo,
    condiciones: lista(o.condiciones)
      .map((c) => ({ label: str(c.label), texto: str(c.texto) }))
      .filter((c) => c.texto)
      .slice(0, LIMITES.condiciones),
    contacto: strONull(o.contacto),
    plano: imagenes.length > 0 ? { titulo: str(plano?.titulo) || "Plano", fuente: strONull(plano?.fuente), imagenes } : null,
  };
}

/**
 * Condiciones que se imprimen. La vigencia sale de la validez de la cotización
 * si la propuesta no la trae: es el único dato que toda cotización tiene, y
 * escribirlo dos veces (campo de validez y texto) es la forma de que digan
 * cosas distintas.
 */
export function condicionesDe(p: Propuesta, validez: number | null): PropuestaCondicion[] {
  const tieneVigencia = p.condiciones.some((c) => /vigencia|validez/i.test(c.label));
  if (tieneVigencia || !validez || validez <= 0) return p.condiciones;
  return [{ label: "VIGENCIA", texto: `${validez} días.` }, ...p.condiciones];
}
