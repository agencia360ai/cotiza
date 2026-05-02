"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const newProjectSchema = z.object({
  name: z.string().trim().min(2, "Nombre demasiado corto").max(120),
  client_name: z.string().trim().max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  scope: z.enum(["simple", "complex"]),
});

export async function createProject(_: { error: string } | null, formData: FormData) {
  const parsed = newProjectSchema.safeParse({
    name: formData.get("name"),
    client_name: formData.get("client_name") || undefined,
    description: formData.get("description") || undefined,
    scope: formData.get("scope"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada" };

  const { data: memberships } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", user.id)
    .limit(1);
  const orgId = memberships?.[0]?.org_id;
  if (!orgId) return { error: "No tenés organización" };

  const { data: project, error } = await supabase
    .from("projects")
    .insert({
      org_id: orgId,
      name: parsed.data.name,
      client_name: parsed.data.client_name ?? null,
      description: parsed.data.description ?? null,
      scope: parsed.data.scope,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !project) return { error: error?.message ?? "No se pudo crear el proyecto" };

  revalidatePath("/dashboard");
  redirect(`/projects/${project.id}`);
}
