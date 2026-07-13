"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const credentialsSchema = z.object({
  email: z.string().trim().email("Email inválido"),
  password: z.string().min(8, "Mínimo 8 caracteres"),
});

type ActionResult = { error: string } | { success: string };

export async function signIn(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) return { error: error.message };

  redirect("/");
}

// Registro autoservicio SOLO para el equipo: correos @dicecpanama.com.
// Defensa en dos capas: este check (mensaje amable) + trigger en la base
// (migración 0025) que rechaza cualquier otro dominio incluso por API cruda,
// verifica el email por link de confirmación y auto-agrega al org de DICEC.
// Externos: por invitación desde Configuración → Miembros.
const DOMINIO_PERMITIDO = "dicecpanama.com";

export async function signUp(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const email = parsed.data.email.toLowerCase();
  if (!email.endsWith(`@${DOMINIO_PERMITIDO}`)) {
    return { error: `El registro es solo para correos @${DOMINIO_PERMITIDO}. Si eres externo, pide una invitación a un administrador.` };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password: parsed.data.password });

  if (error) {
    if (/signup|sign-?ups?/i.test(error.message) && /disabled|not allowed/i.test(error.message)) {
      return { error: "El registro está desactivado en Supabase — un administrador debe activar \"Allow new users to sign up\" (Authentication → Providers → Email)." };
    }
    return { error: error.message };
  }

  if (!data.session) {
    return { success: "Te enviamos un email para confirmar tu cuenta. Al confirmarla, inicia sesión y entras directo al panel de DICEC." };
  }

  redirect("/");
}
