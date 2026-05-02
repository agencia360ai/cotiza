"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  name: z.string().trim().min(2, "Nombre demasiado corto").max(80),
});

function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

type ActionResult = { error: string } | null;

export async function createOrganization(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = schema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada" };

  const baseSlug = slugify(parsed.data.name) || "org";
  const slug = `${baseSlug}-${Math.random().toString(36).slice(2, 7)}`;

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .insert({ name: parsed.data.name, slug, created_by: user.id })
    .select("id")
    .single();
  if (orgError || !org) return { error: orgError?.message ?? "No se pudo crear la organización" };

  const { error: memberError } = await supabase
    .from("org_members")
    .insert({ org_id: org.id, user_id: user.id, role: "owner" });
  if (memberError) return { error: memberError.message };

  redirect("/dashboard");
}
