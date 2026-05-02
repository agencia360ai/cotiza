"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseProjectDocuments } from "@/lib/ai/parse-document";
import { recommendEquipment } from "@/lib/ai/recommend";
import type { ProjectExtraction } from "@/lib/ai/types";

const TAX_RATE = 0.07; // ITBMS Panamá

async function loadProject(projectId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sesión expirada");

  const { data: project, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();
  if (error || !project) throw new Error("Proyecto no encontrado");
  return { supabase, user, project };
}

export async function createDocumentRows(
  projectId: string,
  rows: { fileName: string; storagePath: string; mimeType: string; sizeBytes: number }[],
) {
  const { supabase, user, project } = await loadProject(projectId);
  const inserts = rows.map((r) => ({
    project_id: projectId,
    org_id: project.org_id,
    file_name: r.fileName,
    storage_path: r.storagePath,
    mime_type: r.mimeType,
    size_bytes: r.sizeBytes,
    uploaded_by: user.id,
  }));
  const { error } = await supabase.from("documents").insert(inserts);
  if (error) return { error: error.message };
  revalidatePath(`/projects/${projectId}`);
  return { ok: true as const };
}

export async function deleteDocument(projectId: string, documentId: string, storagePath: string) {
  const { supabase } = await loadProject(projectId);
  await supabase.storage.from("cotiza-documents").remove([storagePath]);
  await supabase.from("documents").delete().eq("id", documentId);
  revalidatePath(`/projects/${projectId}`);
  return { ok: true as const };
}

export async function runExtraction(projectId: string) {
  const { supabase, project } = await loadProject(projectId);

  await supabase.from("projects").update({ status: "parsing" }).eq("id", projectId);

  const { data: docs } = await supabase
    .from("documents")
    .select("id, file_name, storage_path, mime_type")
    .eq("project_id", projectId);
  if (!docs || docs.length === 0) {
    await supabase.from("projects").update({ status: "draft" }).eq("id", projectId);
    return { error: "Subí al menos un archivo antes de extraer." };
  }

  const documentInputs = await Promise.all(
    docs.map(async (d) => {
      const { data, error } = await supabase.storage.from("cotiza-documents").download(d.storage_path);
      if (error || !data) throw new Error(`No se pudo leer ${d.file_name}: ${error?.message ?? "?"}`);
      const buf = Buffer.from(await data.arrayBuffer());
      const mime = d.mime_type ?? "application/pdf";
      if (mime === "application/pdf") {
        return { kind: "pdf" as const, data: buf, filename: d.file_name };
      }
      const imageMime = mime as "image/png" | "image/jpeg" | "image/webp";
      return { kind: "image" as const, data: buf, mediaType: imageMime, filename: d.file_name };
    }),
  );

  let result;
  try {
    result = await parseProjectDocuments(documentInputs, {
      name: project.name,
      description: project.description,
      scope: project.scope,
    });
  } catch (e) {
    await supabase.from("projects").update({ status: "draft" }).eq("id", projectId);
    return { error: e instanceof Error ? e.message : "Falló la extracción" };
  }

  await supabase.from("project_extractions").insert({
    project_id: projectId,
    org_id: project.org_id,
    extracted: result.extraction,
    confidence_notes: result.extraction.source_summary,
    model_used: result.model,
    input_tokens: result.usage.input,
    output_tokens: result.usage.output,
    cache_read_tokens: result.usage.cacheRead,
  });

  await supabase
    .from("projects")
    .update({ extracted_data: result.extraction, status: "clarifying" })
    .eq("id", projectId);

  revalidatePath(`/projects/${projectId}`);
  return { ok: true as const };
}

export async function updateExtractedData(projectId: string, patch: Partial<ProjectExtraction>) {
  const { supabase, project } = await loadProject(projectId);
  const merged = { ...(project.extracted_data ?? {}), ...patch };
  await supabase.from("projects").update({ extracted_data: merged }).eq("id", projectId);
  revalidatePath(`/projects/${projectId}`);
  return { ok: true as const };
}

export async function generateQuote(projectId: string) {
  const { supabase, user, project } = await loadProject(projectId);

  if (!project.extracted_data || Object.keys(project.extracted_data).length === 0) {
    return { error: "No hay datos del proyecto para cotizar todavía." };
  }

  await supabase.from("projects").update({ status: "quoting" }).eq("id", projectId);

  const { data: catalog } = await supabase
    .from("equipment_catalog")
    .select("id, sku, name, brand, category, capacity_btu, voltage, unit_price_usd, notes")
    .eq("active", true);
  if (!catalog || catalog.length === 0) {
    return { error: "No hay catálogo de equipos disponible." };
  }

  let result;
  try {
    result = await recommendEquipment({
      extraction: project.extracted_data as ProjectExtraction,
      catalog,
    });
  } catch (e) {
    await supabase.from("projects").update({ status: "clarifying" }).eq("id", projectId);
    return { error: e instanceof Error ? e.message : "Falló la generación de cotización" };
  }

  const skuToCatalog = new Map(catalog.map((c) => [c.sku, c]));

  const itemsToInsert: Array<{
    quote_id: string;
    equipment_id: string | null;
    position: number;
    name: string;
    description: string | null;
    quantity: number;
    unit_price_usd: number;
    ai_reasoning: string;
  }> = [];

  let subtotal = 0;
  result.recommendation.items.forEach((item, idx) => {
    const cat = item.sku ? skuToCatalog.get(item.sku) : undefined;
    const name = cat?.name ?? item.custom_name ?? `Item ${idx + 1}`;
    const unitPrice = cat?.unit_price_usd ?? 0; // Custom items default to 0; user edits in UI.
    subtotal += Number(unitPrice) * item.quantity;
    itemsToInsert.push({
      quote_id: "", // filled after quote insert
      equipment_id: cat?.id ?? null,
      position: idx,
      name,
      description: cat?.notes ?? null,
      quantity: item.quantity,
      unit_price_usd: Number(unitPrice),
      ai_reasoning: item.reasoning,
    });
  });

  const tax = +(subtotal * TAX_RATE).toFixed(2);
  const total = +(subtotal + tax).toFixed(2);

  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .insert({
      project_id: projectId,
      org_id: project.org_id,
      quote_number: `COT-${Date.now().toString(36).toUpperCase()}`,
      status: "draft",
      subtotal_usd: +subtotal.toFixed(2),
      tax_rate: TAX_RATE,
      tax_usd: tax,
      total_usd: total,
      notes: result.recommendation.notes ?? null,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (quoteError || !quote) return { error: quoteError?.message ?? "No se pudo crear la cotización" };

  if (itemsToInsert.length > 0) {
    const itemsWithQuoteId = itemsToInsert.map((it) => ({ ...it, quote_id: quote.id }));
    await supabase.from("quote_items").insert(itemsWithQuoteId);
  }

  await supabase.from("projects").update({ status: "completed" }).eq("id", projectId);

  revalidatePath(`/projects/${projectId}`);
  redirect(`/quotes/${quote.id}`);
}
