import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, hasEmailConfig, esc } from "@/lib/email/send";
import { letterTotals, type LetterData } from "@/lib/quotes/letter";
import { renderQuotePdf } from "@/lib/quotes/pdf";
import { nextContractNumber } from "@/lib/quickbooks/create-project";

// Avisos a administración para REGISTRAR UN PROYECTO EN QUICKBOOKS a mano.
//
// Desde que la app ya no puede crear proyectos en QBO, ese registro es trabajo
// manual, y hay dos momentos en que se dispara: una cotización que queda
// APROBADA y una licitación que recibe ORDEN DE PROCEDER. Los dos correos van a
// los mismos destinatarios y llevan los datos ya formateados para copiar,
// incluido el PRÓXIMO NÚMERO de contrato sugerido (calculado sobre los
// proyectos ya sincronizados, sin llamar a QuickBooks).
//
// Son best-effort: si el correo falla, el cambio de estado queda guardado igual
// — no se pierde el trabajo del usuario por un problema de correo.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

const money = (n: number | null) =>
  n === null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

async function destinatarios(db: Db, orgId: string): Promise<string[]> {
  const { data } = (await db.from("organizations").select("quote_notify_emails").eq("id", orgId).maybeSingle()) as {
    data: { quote_notify_emails: string[] | null } | null;
  };
  return (data?.quote_notify_emails ?? []).map((e) => e.trim()).filter(Boolean);
}

// Próximo correlativo sugerido para el rubro, desde lo ya sincronizado de QBO.
async function numeroSugerido(db: Db, orgId: string, rubro: string | null): Promise<string | null> {
  const r = rubro === "DM" ? "DM" : rubro === "DS" ? "DS" : rubro === "DV" ? "DV" : "DC";
  const { data } = (await db
    .from("qbo_project_state")
    .select("name, full_name")
    .eq("org_id", orgId)
    .limit(2000)) as { data: { name: string | null; full_name: string | null }[] | null };
  const nombres = (data ?? []).map((x) => x.name ?? x.full_name ?? "").filter(Boolean);
  if (nombres.length === 0) return null;
  return nextContractNumber(nombres, r, new Date().getFullYear()).numero;
}

const fila = (k: string, v: string) =>
  `<tr><td style="padding:4px 12px 4px 0;color:#64748b;white-space:nowrap">${esc(k)}</td>` +
  `<td style="padding:4px 0;color:#0f172a;font-weight:600">${esc(v)}</td></tr>`;

// Devuelve el motivo si NO se pudo mandar, para que el caller lo muestre. Un
// correo que falla en silencio hace creer que administración ya fue avisada.
// null = se mandó, o no había nada que mandar (sin config / sin destinatarios).
export async function notificarCotizacionAprobada(
  db: Db,
  orgId: string,
  quoteId: string,
  replyTo?: string | null,
): Promise<string | null> {
  if (!hasEmailConfig()) return null;

  const to = await destinatarios(db, orgId);
  if (to.length === 0) return null; // nadie configurado: no es un error

  type Row = {
    quote_number: string;
    sent_date: string | null;
    client_name: string | null;
    description: string | null;
    amount_usd: number | null;
    rubro: string | null;
    letter: LetterData | null;
    dropbox_shared_url: string | null;
    client: { name: string } | null;
    location: { name: string } | null;
  };
  const { data: q } = (await db
    .from("sales_quotes")
    .select(
      "quote_number, sent_date, client_name, description, amount_usd, rubro, letter, dropbox_shared_url, client:clients(name), location:client_locations(name)",
    )
    .eq("id", quoteId)
    .eq("org_id", orgId)
    .maybeSingle()) as { data: Row | null };
  if (!q) return null;

  const cliente = q.client?.name ?? q.client_name ?? "Cliente";
  const total = q.letter ? letterTotals(q.letter).total : (q.amount_usd ?? 0);
  const sugerido = await numeroSugerido(db, orgId, q.rubro);

  // PDF adjunto: se regenera con la carta guardada para que vaya SIEMPRE la
  // versión vigente (si se editó el texto o la firma, eso es lo que llega).
  let adjunto: { filename: string; content: Uint8Array } | undefined;
  if (q.letter) {
    try {
      const pdf = await renderQuotePdf({ quoteNumber: q.quote_number, cliente, letter: q.letter });
      adjunto = { filename: `${q.quote_number}.pdf`.replace(/[/\\:*?"<>|]+/g, " "), content: pdf };
    } catch {
      /* sin adjunto: el correo igual sale con los datos y el link de Dropbox */
    }
  }

  const html = `
<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;max-width:640px">
  <p style="margin:0 0 4px;font-size:13px;color:#64748b">Cotiza · DICEC</p>
  <h2 style="margin:0 0 4px;font-size:19px">Cotización aprobada</h2>
  <p style="margin:0 0 16px;color:#475569;font-size:14px">
    Hay que registrar el proyecto en QuickBooks. Abajo están los datos listos para copiar.
  </p>

  <table style="border-collapse:collapse;font-size:14px;margin-bottom:18px">
    ${fila("Cotización", q.quote_number)}
    ${fila("Cliente", cliente)}
    ${q.location?.name ? fila("Sucursal", q.location.name) : ""}
    ${fila("Descripción", q.description ?? "—")}
    ${fila("Monto", money(total))}
    ${q.sent_date ? fila("Fecha de envío", q.sent_date) : ""}
    ${q.rubro ? fila("Rubro", q.rubro) : ""}
  </table>

  <div style="border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;background:#f8fafc">
    <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#0f172a">Para crear en QuickBooks</p>
    <table style="border-collapse:collapse;font-size:14px">
      ${sugerido ? fila("Nº sugerido", sugerido) : ""}
      ${fila("Cliente", cliente)}
      ${fila("Nombre del proyecto", `${sugerido ?? ""} ${q.description ?? ""}`.trim())}
      ${fila("Monto del contrato", money(total))}
    </table>
    ${
      sugerido
        ? `<p style="margin:8px 0 0;font-size:12px;color:#64748b">El Nº sugerido sale del último proyecto sincronizado — confírmalo en QuickBooks antes de crearlo.</p>`
        : ""
    }
  </div>

  ${
    q.dropbox_shared_url
      ? `<p style="margin:16px 0 0;font-size:14px"><a href="${esc(q.dropbox_shared_url)}" style="color:#2563eb">Ver la carta en Dropbox</a></p>`
      : ""
  }
  <p style="margin:18px 0 0;font-size:12px;color:#94a3b8">
    Enviado automáticamente por Cotiza al marcarse la cotización como aprobada.
  </p>
</div>`;

  const r = await sendEmail({
    to,
    subject: `Cotización aprobada · ${q.quote_number} — ${cliente} · ${money(total)}`,
    html,
    replyTo: replyTo ?? null,
    attachments: adjunto ? [adjunto] : undefined,
  });
  return r.ok ? null : r.error;
}

// ── Licitación con orden de proceder ─────────────────────────────────────────
// Misma idea que el aviso de cotización aprobada, y a los mismos destinatarios:
// una licitación con orden de proceder es trabajo adjudicado que hay que
// registrar como proyecto en QuickBooks a mano. Lo que cambia son los datos —
// una licitación tiene número de acto y entidad, no número de cotización ni
// carta en PDF, así que este correo no lleva adjunto.
export async function notificarOrdenDeProceder(
  db: Db,
  orgId: string,
  tenderId: string,
  replyTo?: string | null,
): Promise<string | null> {
  if (!hasEmailConfig()) return null;

  const to = await destinatarios(db, orgId);
  if (to.length === 0) return null; // nadie configurado: no es un error

  type Row = {
    acto_number: string | null;
    entity: string | null;
    objeto: string | null;
    amount_ref_usd: number | null;
    delivery_date: string | null;
    rubro: string | null;
    folder_url: string | null;
    notes: string | null;
    client: { name: string } | null;
  };
  const { data: t } = (await db
    .from("tenders")
    .select("acto_number, entity, objeto, amount_ref_usd, delivery_date, rubro, folder_url, notes, client:clients(name)")
    .eq("id", tenderId)
    .eq("org_id", orgId)
    .maybeSingle()) as { data: Row | null };
  if (!t) return null;

  const cliente = t.client?.name ?? t.entity ?? "Entidad";
  const total = t.amount_ref_usd === null ? null : Number(t.amount_ref_usd);
  const titulo = t.objeto?.trim() || t.acto_number || "Licitación";
  const sugerido = await numeroSugerido(db, orgId, t.rubro);

  const html = `
<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;max-width:640px">
  <p style="margin:0 0 4px;font-size:13px;color:#64748b">Cotiza · DICEC</p>
  <h2 style="margin:0 0 4px;font-size:19px">Orden de proceder</h2>
  <p style="margin:0 0 16px;color:#475569;font-size:14px">
    Hay que registrar el proyecto en QuickBooks. Abajo están los datos listos para copiar.
  </p>

  <table style="border-collapse:collapse;font-size:14px;margin-bottom:18px">
    ${fila("Licitación", titulo)}
    ${t.acto_number ? fila("Acto", t.acto_number) : ""}
    ${fila("Entidad", cliente)}
    ${fila("Monto", money(total))}
    ${t.delivery_date ? fila("Fecha de participación", t.delivery_date) : ""}
    ${t.rubro ? fila("Rubro", t.rubro) : ""}
  </table>

  <div style="border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;background:#f8fafc">
    <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#0f172a">Para crear en QuickBooks</p>
    <table style="border-collapse:collapse;font-size:14px">
      ${sugerido ? fila("Nº sugerido", sugerido) : ""}
      ${fila("Cliente", cliente)}
      ${fila("Nombre del proyecto", `${sugerido ?? ""} ${titulo}`.trim())}
      ${fila("Monto del contrato", money(total))}
    </table>
    ${
      sugerido
        ? `<p style="margin:8px 0 0;font-size:12px;color:#64748b">El Nº sugerido sale del último proyecto sincronizado — confírmalo en QuickBooks antes de crearlo.</p>`
        : ""
    }
  </div>

  ${
    t.folder_url
      ? `<p style="margin:16px 0 0;font-size:14px"><a href="${esc(t.folder_url)}" style="color:#2563eb">Ver la carpeta de la licitación</a></p>`
      : ""
  }
  <p style="margin:18px 0 0;font-size:12px;color:#94a3b8">
    Enviado automáticamente por Cotiza al marcarse la licitación con orden de proceder.
  </p>
</div>`;

  const r = await sendEmail({
    to,
    subject: `Orden de proceder · ${t.acto_number ?? titulo} — ${cliente} · ${money(total)}`,
    html,
    replyTo: replyTo ?? null,
  });
  return r.ok ? null : r.error;
}
