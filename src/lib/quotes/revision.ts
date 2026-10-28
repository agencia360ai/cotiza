import "server-only";
import { downloadFile, hasDropboxConfig } from "@/lib/dropbox/client";
import { generateQuote } from "@/lib/ai/generate-quote";
import { parseRev } from "@/lib/pipeline/revisions";
import type { QuoteRow, Rubro } from "@/lib/pipeline/types";
import { cartaDeGenerada } from "./desde-ia";
import type { LetterData } from "./letter";
import { mismoNumero, numeroBase, revisionSiguiente } from "./numeracion";
import { insertQuote, type Db, type SaveQuoteInput } from "./store";
import { usosDelNumero, type Original, type UsoNumero } from "./subir-pdf";

// La revisión de una cotización que ya salió: el mismo número con la REV que
// sigue, el mismo cliente, y el contenido de la original para cambiarlo en el
// cotizador antes de publicarlo.

export type OriginalCompleta = Original & { letter: LetterData | null; dropbox_path: string | null };

export async function cargarOriginal(db: Db, orgId: string, id: string): Promise<OriginalCompleta | null> {
  type Raw = Omit<OriginalCompleta, "client_std_name" | "location_name"> & {
    client: { name: string } | null;
    location: { name: string } | null;
  };
  const { data } = (await db
    .from("sales_quotes")
    .select(
      "id, quote_number, status, client_name, client_id, location_id, contact_name, contact_phone, contact_email, description, amount_usd, rubro, letter, dropbox_path, client:clients(name), location:client_locations(name)",
    )
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle()) as { data: Raw | null };
  if (!data) return null;
  const { client, location, ...q } = data;
  return {
    ...q,
    client_std_name: client?.name ?? null,
    location_name: location?.name ?? null,
    amount_usd: q.amount_usd === null ? null : Number(q.amount_usd),
  };
}

/** Las revisiones que ya tiene el número (plataforma y Dropbox) y la que sigue. */
export async function revisionesDe(
  db: Db,
  orgId: string,
  original: Pick<Original, "quote_number">,
): Promise<{ base: string; siguiente: string; usos: UsoNumero[] } | null> {
  const base = numeroBase(original.quote_number);
  if (!base) return null;
  const usos = await usosDelNumero(db, orgId, base);
  return { base, siguiente: revisionSiguiente(base, [original.quote_number, ...usos.map((u) => u.numero)]), usos };
}

export type FuenteRevision = "carta" | "pdf-original" | "pdf-subido" | "resumen";

/**
 * De dónde sale lo que se edita, de lo más fiel a lo menos. Un PDF subido
 * manda: es la revisión que alguien ya empezó a mano. Después la carta
 * guardada, que es la original exacta. Un PDF hecho fuera de la plataforma lo
 * tiene que leer la IA, y sin nada de eso queda la descripción con el monto.
 */
export function fuenteDeRevision(o: { pdfSubido: boolean; conCarta: boolean; conPdfEnDropbox: boolean }): FuenteRevision {
  if (o.pdfSubido) return "pdf-subido";
  if (o.conCarta) return "carta";
  if (o.conPdfEnDropbox) return "pdf-original";
  return "resumen";
}

export type RevisionEditable = {
  original: { id: string; quote_number: string };
  fuente: FuenteRevision;
  // Lo que salió distinto de lo pedido (p. ej. no se pudo bajar el PDF).
  aviso: string | null;
  quote_number: string;
  client_name: string;
  client_std_name: string | null;
  rubro: Rubro;
  descripcion_corta: string;
  letter: LetterData;
};

// Pasar el PDF a la plataforma es copiarlo, no cotizar de nuevo: sin esto el
// cotizador "mejora" renglones y estima precios, y la revisión deja de ser la
// misma cotización con un cambio.
function pedidoDeTranscripcion(numero: string, cliente: string): string {
  return (
    `Este PDF es la cotización ${numero} que ya se le mandó a ${cliente}. Pásala TAL CUAL para hacerle una revisión: ` +
    "los mismos renglones en el mismo orden, con sus cantidades, descripciones y precios unitarios; el mismo ITBMS, " +
    "la misma validez y las mismas condiciones o notas que tenga escritas. Los precios van sin ITBMS: si el PDF los " +
    "muestra con el ITBMS incluido, sácaselo. No agregues, no quites ni estimes nada — los cambios de la revisión se piden después."
  );
}

export async function armarRevision(
  db: Db,
  orgId: string,
  quoteId: string,
  opts: { pdf?: { nombre: string; bytes: Buffer } } = {},
): Promise<{ error: string } | { ok: true; data: RevisionEditable }> {
  const original = await cargarOriginal(db, orgId, quoteId);
  if (!original) return { error: "No encontré la cotización" };
  const revs = await revisionesDe(db, orgId, original);
  if (!revs) return { error: `${original.quote_number} no tiene la forma "COT DC 26-211": corrige el número antes de hacerle una revisión` };

  const cliente = original.client_std_name ?? original.client_name ?? "Cliente";
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Panama" });
  let fuente = fuenteDeRevision({
    pdfSubido: Boolean(opts.pdf),
    conCarta: Boolean(original.letter),
    conPdfEnDropbox: Boolean(original.dropbox_path) && hasDropboxConfig(),
  });
  let aviso: string | null = null;

  let pdf = opts.pdf ?? null;
  if (fuente === "pdf-original") {
    try {
      pdf = { nombre: original.dropbox_path!.split("/").pop() ?? original.quote_number, bytes: await downloadFile(original.dropbox_path!) };
    } catch (e) {
      fuente = "resumen";
      aviso = `No se pudo bajar el PDF de Dropbox (${e instanceof Error ? e.message.slice(0, 120) : "error"}): arranca con la descripción y el monto.`;
    }
  }

  let letter: LetterData;
  let rubro = original.rubro;
  let descripcion = original.description;
  if (fuente === "carta") {
    letter = { ...original.letter!, fecha: hoy };
  } else if (pdf) {
    const { data: clients } = (await db.from("clients").select("name").eq("org_id", orgId).order("name")) as {
      data: { name: string }[] | null;
    };
    const g = await generateQuote(
      pedidoDeTranscripcion(original.quote_number, cliente),
      (clients ?? []).map((c) => c.name),
      [{ kind: "pdf", name: pdf.nombre, data: pdf.bytes.toString("base64") }],
      "carta",
    );
    letter = cartaDeGenerada(g, { formato: "carta", fecha: hoy, elaborado: null, contacto: null, cliente });
    rubro ??= g.rubro;
    descripcion ??= g.descripcion_corta;
  } else {
    letter = {
      fecha: hoy,
      ubicacion: original.location_name,
      tipo: "realizar",
      items: [{ cant: 1, desc: original.description ?? "", precio: original.amount_usd ?? 0 }],
      // El monto guardado es el total que vio el cliente: sumarle ITBMS lo cambiaría.
      aplica_itbms: false,
      tasa: 7,
      validez: 30,
      condiciones: null,
      elaborado: null,
    };
  }

  return {
    ok: true,
    data: {
      original: { id: original.id, quote_number: original.quote_number },
      fuente,
      aviso,
      quote_number: revs.siguiente,
      client_name: original.client_name ?? cliente,
      client_std_name: original.client_std_name,
      rubro: rubro ?? "DS",
      descripcion_corta: descripcion ?? "",
      letter,
    },
  };
}

/**
 * Guarda la revisión como borrador nuevo, con el cliente de la original.
 * El número tiene que ser una REV de la original y no estar usado: publicarla
 * con un número repetido dejaría dos PDF distintos con el mismo nombre.
 */
export async function guardarRevision(
  db: Db,
  orgId: string,
  originalId: string,
  input: SaveQuoteInput,
): Promise<{ error: string } | { ok: true; row: QuoteRow }> {
  const original = await cargarOriginal(db, orgId, originalId);
  if (!original) return { error: "No encontré la cotización original" };
  const revs = await revisionesDe(db, orgId, original);
  if (!revs) return { error: `${original.quote_number} no tiene la forma "COT DC 26-211"` };
  const numero = input.quote_number.trim().replace(/\s+/g, " ").toUpperCase();
  if (numeroBase(numero) !== revs.base || parseRev(numero).rev === 0) {
    return { error: `Una revisión de ${original.quote_number} se numera ${revs.base} REV … (la que sigue es ${revs.siguiente})` };
  }
  const usada = revs.usos.find((u) => mismoNumero(u.numero, numero));
  if (usada) {
    return { error: `${numero} ya existe ${usada.donde === "dropbox" ? "en Dropbox" : "en la plataforma"} — la que sigue es ${revs.siguiente}` };
  }
  return insertQuote(db, orgId, { ...input, quote_number: numero, client_name: original.client_name ?? input.client_name }, original);
}
