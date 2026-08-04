"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgContext } from "@/lib/org-context";
import { sendEmail, hasEmailConfig } from "@/lib/email/send";

type Result = { error: string } | { ok: true };

async function userOrg() {
  const ctx = await getActiveOrgContext();
  if (!ctx) throw new Error("Sin organización");
  const supabase = await createClient();
  return { supabase, orgId: ctx.orgId, role: ctx.role };
}

export async function updateOrgName(name: string): Promise<Result> {
  if (!name.trim()) return { error: "El nombre no puede estar vacío" };
  const { supabase, orgId } = await userOrg();
  const { error } = await supabase
    .from("organizations")
    .update({ name: name.trim() })
    .eq("id", orgId);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function uploadOrgLogo(formData: FormData): Promise<Result> {
  const file = formData.get("file") as File | null;
  if (!file) return { error: "Archivo faltante" };
  const { supabase, orgId } = await userOrg();
  const ext = (file.name.split(".").pop() ?? "png").toLowerCase();
  const path = `orgs/${orgId}/logo-${randomUUID()}.${ext}`;
  const buf = await file.arrayBuffer();
  const { error: upErr } = await supabase.storage
    .from("cotiza-maintenance")
    .upload(path, buf, { contentType: file.type || "image/png" });
  if (upErr) return { error: upErr.message };

  const { data: prev } = await supabase
    .from("organizations")
    .select("logo_path")
    .eq("id", orgId)
    .single();
  const { error } = await supabase
    .from("organizations")
    .update({ logo_path: path })
    .eq("id", orgId);
  if (error) return { error: error.message };
  if (prev?.logo_path) {
    await supabase.storage.from("cotiza-maintenance").remove([prev.logo_path]).catch(() => {});
  }
  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeOrgLogo(): Promise<Result> {
  const { supabase, orgId } = await userOrg();
  const { data: prev } = await supabase
    .from("organizations")
    .select("logo_path")
    .eq("id", orgId)
    .single();
  const { error } = await supabase
    .from("organizations")
    .update({ logo_path: null })
    .eq("id", orgId);
  if (error) return { error: error.message };
  if (prev?.logo_path) {
    await supabase.storage.from("cotiza-maintenance").remove([prev.logo_path]).catch(() => {});
  }
  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateOrgFocus(focus: "maintenance" | "projects" | "mixed"): Promise<Result> {
  if (!["maintenance", "projects", "mixed"].includes(focus)) {
    return { error: "Foco inválido" };
  }
  const { supabase, orgId, role } = await userOrg();
  if (role !== "owner" && role !== "admin") {
    return { error: "Solo owner/admin pueden cambiar el foco" };
  }
  const { error } = await supabase
    .from("organizations")
    .update({ focus })
    .eq("id", orgId);
  if (error) return { error: error.message };
  revalidatePath("/inicio");
  revalidatePath("/settings");
  return { ok: true };
}

// Correos que reciben el aviso cuando una cotización queda aprobada (0041).
// Ese correo dispara el registro manual del proyecto en QuickBooks.
export async function saveQuoteNotifyEmails(emails: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getActiveOrgContext();
  if (!ctx) return { ok: false, error: "Sin organización" };
  const supabase = await createClient();
  const orgId = ctx.orgId;

  const clean = Array.from(
    new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))),
  );
  const { error } = await supabase.from("organizations").update({ quote_notify_emails: clean }).eq("id", orgId);
  if (error) {
    return {
      ok: false,
      error: /quote_notify_emails/.test(error.message)
        ? "Falta la migración 0041 — corre el SQL en Supabase y reintenta."
        : error.message,
    };
  }
  revalidatePath("/settings");
  return { ok: true };
}

// Prueba de envío: verifica remitente, dominio y destinatarios SIN tener que
// aprobar una cotización de verdad. Devuelve el error crudo de Resend, que es
// donde se ve si falta verificar el dominio.
export async function enviarCorreoDePrueba(): Promise<{ ok: true; to: string[] } | { ok: false; error: string }> {
  const ctx = await getActiveOrgContext();
  if (!ctx) return { ok: false, error: "Sin organización" };
  if (!hasEmailConfig()) return { ok: false, error: "Falta RESEND_API_KEY en Vercel." };

  const supabase = await createClient();
  const { data: org } = (await supabase
    .from("organizations")
    .select("quote_notify_emails")
    .eq("id", ctx.orgId)
    .maybeSingle()) as { data: { quote_notify_emails: string[] | null } | null };
  const to = (org?.quote_notify_emails ?? []).filter(Boolean);
  if (to.length === 0) return { ok: false, error: "Primero guarda al menos un correo en esta sección." };

  const r = await sendEmail({
    to,
    replyTo: ctx.user.email ?? null,
    subject: "Prueba de envío · Cotiza DICEC",
    html:
      `<div style="font-family:system-ui,sans-serif;color:#0f172a">` +
      `<h2 style="margin:0 0 8px;font-size:18px">Prueba de envío</h2>` +
      `<p style="margin:0;color:#475569;font-size:14px">Si estás leyendo esto, los avisos de cotización aprobada van a llegar bien.</p>` +
      `</div>`,
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, to };
}
