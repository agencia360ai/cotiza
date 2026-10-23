import "server-only";
import { hasDropboxConfig, listFolder, uploadFile, getSharedLink } from "@/lib/dropbox/client";
import { quotesFolder } from "@/lib/dropbox/folders";
import { matchClientByName } from "@/lib/clients/match";
import type { QuoteRow, Rubro } from "@/lib/pipeline/types";
import { anioDeNumero, mismoNumero, numeroBase, numeroEnTexto, reemplazarNumero } from "./numeracion";
import type { Db } from "./store";

// Cotizaciones hechas a mano (Word, Excel, otro programa) que entran a la
// plataforma como PDF: el archivo va a la carpeta de cartas de Dropbox TAL
// CUAL —no se regenera ni se le pone membrete— y se crea la cotización.

export type UsoNumero = { donde: "plataforma" | "dropbox"; numero: string; detalle: string };

export type DatosPdf = {
  quote_number: string;
  client_name: string | null;
  amount_usd: number | null;
  sent_date: string | null;
  description: string | null;
  rubro: Rubro | null;
};

const fmt = (n: number | null) => (n === null ? "sin monto" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/**
 * Dónde está usado ya este número. Una revisión ("Rev 2", "A") cuenta como el
 * mismo número: si alguien sube la 211 y ya existe la 211 Rev 1, tiene que
 * enterarse. Es un aviso, no un bloqueo — una revisión nueva es legítima.
 */
export async function usosDelNumero(db: Db, orgId: string, numero: string): Promise<UsoNumero[]> {
  const base = numeroBase(numero);
  if (!base) return [];
  const usos: UsoNumero[] = [];

  const { data } = (await db
    .from("sales_quotes")
    .select("quote_number, client_name, amount_usd, status")
    .eq("org_id", orgId)
    .ilike("quote_number", `${base}%`)
    .limit(20)) as { data: { quote_number: string; client_name: string | null; amount_usd: number | null; status: string }[] | null };
  for (const q of data ?? []) {
    if (numeroBase(q.quote_number) !== base) continue;
    usos.push({
      donde: "plataforma",
      numero: q.quote_number,
      detalle: `${q.client_name ?? "sin cliente"} · ${fmt(q.amount_usd === null ? null : Number(q.amount_usd))} · ${q.status}`,
    });
  }

  if (hasDropboxConfig()) {
    try {
      const anio = anioDeNumero(base) ?? new Date().getFullYear();
      for (const e of await listFolder(quotesFolder(anio))) {
        if (e.tag !== "file") continue;
        const n = numeroEnTexto(e.name);
        if (n && numeroBase(n) === base) usos.push({ donde: "dropbox", numero: n, detalle: e.name });
      }
    } catch {
      /* sin Dropbox: queda el chequeo de la plataforma */
    }
  }
  return usos;
}

/**
 * Nombre en Dropbox: el original si ya trae el número (así lo nombra el equipo),
 * o el número adelante si no. Sin el número en el nombre, la carpeta deja de
 * servir para sacar el correlativo.
 *
 * Una revisión pide la revisión exacta en el nombre: subir la REV 2 con el
 * archivo "COT DC 26-211 - Cliente.pdf" la dejaría en Dropbox como si fuera la
 * original, y la próxima revisión se calcularía mal.
 */
export function nombreEnDropbox(original: string, numero: string, revision = false): string {
  const limpio = original.replace(/[/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  const conPdf = /\.pdf$/i.test(limpio) ? limpio : `${limpio}.pdf`;
  const delNombre = numeroEnTexto(conPdf);
  if (delNombre && numeroBase(delNombre) === numeroBase(numero)) {
    if (!revision || mismoNumero(delNombre, numero)) return conPdf;
    return reemplazarNumero(conPdf, numero) ?? `${numero} - ${conPdf}`;
  }
  return `${numero} - ${conPdf}`;
}

/** La cotización de la que se sube una revisión: cliente y contacto se heredan. */
export type Original = Pick<
  QuoteRow,
  | "id"
  | "quote_number"
  | "status"
  | "client_name"
  | "client_id"
  | "client_std_name"
  | "location_id"
  | "location_name"
  | "contact_name"
  | "contact_phone"
  | "contact_email"
  | "description"
  | "amount_usd"
  | "rubro"
>;

/** El cliente de la original, como si lo hubiera encontrado el matcher. */
export function clienteDe(o: Original): { id: string; name: string; location_id: string | null; location_name: string | null } | null {
  return o.client_id ? { id: o.client_id, name: o.client_std_name ?? "", location_id: o.location_id, location_name: o.location_name } : null;
}

const MAX_PDF = 5_500_000; // el server action acepta 8 MB, y base64 infla ~33%

/** Los bytes del PDF que mandó el navegador, o qué tiene de malo. */
export function bytesDePdf(base64: string): Buffer | string {
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0) return "Archivo vacío";
  if (bytes.length > MAX_PDF) return "El PDF pesa más de 5.5 MB";
  if (bytes.subarray(0, 4).toString() !== "%PDF") return "El archivo no es un PDF";
  return bytes;
}

export async function subirPdfManual(
  db: Db,
  orgId: string,
  input: { nombre: string; bytes: Buffer; datos: DatosPdf; revisionDe?: Original },
): Promise<{ error: string } | { ok: true; row: QuoteRow; aviso: string | null }> {
  if (!hasDropboxConfig()) return { error: "Dropbox no está configurado (faltan las env vars)." };
  if (input.bytes.subarray(0, 4).toString() !== "%PDF") return { error: "El archivo no es un PDF" };
  const numero = input.datos.quote_number.trim().replace(/\s+/g, " ").toUpperCase();
  if (!numeroBase(numero)) return { error: 'El número tiene que tener la forma "COT DC 26-243"' };
  const original = input.revisionDe;
  if (original && numeroBase(numero) !== numeroBase(original.quote_number)) {
    return { error: `Una revisión de ${original.quote_number} tiene que llevar su mismo número (${numeroBase(original.quote_number)} REV …)` };
  }

  const year =
    anioDeNumero(numero) ?? (input.datos.sent_date ? Number(input.datos.sent_date.slice(0, 4)) : null) ?? new Date().getFullYear();
  // mode "add" con autorename: si ya hay un archivo con ese nombre, Dropbox le
  // agrega " (1)". Nunca se pisa una carta que ya estaba.
  const subido = await uploadFile(`${quotesFolder(year)}/${nombreEnDropbox(input.nombre, numero, Boolean(original))}`, input.bytes);

  let url: string | null = null;
  let aviso: string | null = null;
  try {
    url = await getSharedLink(subido.path);
  } catch (e) {
    aviso =
      "El PDF quedó en Dropbox pero no se pudo crear el link compartido" +
      (e instanceof Error && /scope|permission/i.test(e.message) ? " (falta el scope sharing.write en la app de Dropbox)." : ".");
  }

  const matched = original
    ? clienteDe(original)
    : await matchClientByName(db as unknown as Parameters<typeof matchClientByName>[0], orgId, input.datos.client_name);
  const contacto = {
    contact_name: original?.contact_name ?? null,
    contact_phone: original?.contact_phone ?? null,
    contact_email: original?.contact_email ?? null,
  };
  const notes = original ? `Revisión de ${original.quote_number} — subida manual (PDF): ${input.nombre}` : `Subida manual (PDF): ${input.nombre}`;
  const base = {
    org_id: orgId,
    quote_number: numero,
    year,
    sent_date: input.datos.sent_date,
    amount_usd: input.datos.amount_usd,
    status: "enviada" as const,
    client_name: input.datos.client_name,
    client_id: matched?.id ?? null,
    location_id: matched?.location_id ?? null,
    description: input.datos.description,
    rubro: input.datos.rubro,
    notes,
    source: "dropbox" as const,
    ...(original ? contacto : {}),
  };
  type Ins = { data: { id: string } | null; error: { message: string; code?: string } | null };
  const insertar = (row: Record<string, unknown>) => db.from("sales_quotes").insert(row).select("id").single() as unknown as Promise<Ins>;
  let ins = await insertar({ ...base, dropbox_file_id: subido.id, dropbox_path: subido.path, dropbox_shared_url: url });
  // Solo por columna faltante (migraciones viejas): ante un error real, el PDF
  // ya está en Dropbox y se dice, en vez de crear una fila a medias.
  if (ins.error && (ins.error.code === "42703" || /does not exist|could not find|schema cache/i.test(ins.error.message))) {
    const { location_id: _sinSucursal, ...sinColumnasNuevas } = base;
    void _sinSucursal;
    ins = await insertar(sinColumnasNuevas);
  }
  if (ins.error || !ins.data) {
    return { error: `El PDF se subió a Dropbox (${subido.name}) pero no se pudo crear la cotización: ${ins.error?.message ?? "sin respuesta"}` };
  }

  return {
    ok: true,
    aviso,
    row: {
      id: ins.data.id,
      quote_number: numero,
      year,
      sent_date: input.datos.sent_date,
      amount_usd: input.datos.amount_usd,
      status: "enviada",
      payment_status: null,
      invoice_status: null,
      client_name: input.datos.client_name,
      client_id: matched?.id ?? null,
      client_std_name: matched?.name || null,
      location_id: matched?.location_id ?? null,
      location_name: matched?.location_name ?? null,
      dropbox_shared_url: url,
      dropbox_path: subido.path,
      ...contacto,
      description: input.datos.description,
      notes,
      rubro: input.datos.rubro,
      progress: 0,
      follow_up_date: null,
      rejection_reason: null,
      converted_project_id: null,
      qbo_job_id: null,
      qbo_sent_at: null,
      qbo_project_no: null,
      seguimiento_descartado_at: null,
      seguimiento_descartado_motivo: null,
    },
  };
}
