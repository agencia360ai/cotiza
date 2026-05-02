"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const TAX_RATE = 0.07;

async function recalc(quoteId: string) {
  const supabase = await createClient();
  const { data: items } = await supabase
    .from("quote_items")
    .select("quantity, unit_price_usd")
    .eq("quote_id", quoteId);
  const subtotal = (items ?? []).reduce(
    (acc, it) => acc + Number(it.quantity) * Number(it.unit_price_usd),
    0,
  );
  const tax = +(subtotal * TAX_RATE).toFixed(2);
  const total = +(subtotal + tax).toFixed(2);
  await supabase
    .from("quotes")
    .update({ subtotal_usd: +subtotal.toFixed(2), tax_usd: tax, total_usd: total })
    .eq("id", quoteId);
}

export async function updateQuoteItem(
  quoteId: string,
  itemId: string,
  patch: { name?: string; quantity?: number; unit_price_usd?: number; description?: string | null },
) {
  const supabase = await createClient();
  await supabase.from("quote_items").update(patch).eq("id", itemId);
  await recalc(quoteId);
  revalidatePath(`/quotes/${quoteId}`);
  return { ok: true as const };
}

export async function deleteQuoteItem(quoteId: string, itemId: string) {
  const supabase = await createClient();
  await supabase.from("quote_items").delete().eq("id", itemId);
  await recalc(quoteId);
  revalidatePath(`/quotes/${quoteId}`);
  return { ok: true as const };
}

export async function addCustomItem(quoteId: string) {
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("quote_items")
    .select("position")
    .eq("quote_id", quoteId)
    .order("position", { ascending: false })
    .limit(1);
  const nextPos = (existing?.[0]?.position ?? -1) + 1;

  await supabase.from("quote_items").insert({
    quote_id: quoteId,
    position: nextPos,
    name: "Item personalizado",
    quantity: 1,
    unit_price_usd: 0,
  });
  revalidatePath(`/quotes/${quoteId}`);
  return { ok: true as const };
}

export async function updateQuoteNotes(quoteId: string, notes: string) {
  const supabase = await createClient();
  await supabase.from("quotes").update({ notes }).eq("id", quoteId);
  revalidatePath(`/quotes/${quoteId}`);
  return { ok: true as const };
}
