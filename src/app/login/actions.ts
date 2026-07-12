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

// Registro público CERRADO: las cuentas se crean solo por invitación desde
// Configuración → Miembros (API admin con service role, no depende de que los
// signups estén habilitados en Supabase). Complemento del lado de Supabase:
// Authentication → Sign In / Providers → desactivar "Allow new users to sign up".
