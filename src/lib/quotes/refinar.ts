import "server-only";
import { refineQuote } from "@/lib/ai/refine-quote";
import type { QuoteAdjunto } from "@/lib/ai/generate-quote";
import type { Db } from "./store";
import { aplicarAjuste, type BorradorAjustable, type AjusteAplicado } from "./refinar-core";

export { aplicarAjuste } from "./refinar-core";
export type { BorradorAjustable, AjusteAplicado, RefinedQuote } from "./refinar-core";

export async function refinarBorrador(
  db: Db,
  orgId: string,
  actual: BorradorAjustable,
  instruccion: string,
  adjuntos: QuoteAdjunto[] = [],
): Promise<AjusteAplicado> {
  const { data: clients } = (await db.from("clients").select("name").eq("org_id", orgId).order("name")) as {
    data: { name: string }[] | null;
  };

  const r = await refineQuote(
    {
      client_name: actual.cliente,
      rubro: actual.rubro,
      descripcion_corta: actual.descripcionCorta,
      ubicacion: actual.letter.ubicacion,
      tipo: actual.letter.tipo,
      items: actual.letter.items,
      aplica_itbms: actual.letter.aplica_itbms,
      validez: actual.letter.validez,
      condiciones: actual.letter.condiciones,
      textos: (actual.letter.textos ?? null) as Record<string, string | null | undefined> | null,
    },
    instruccion,
    { numero: actual.numero, clientNames: (clients ?? []).map((c) => c.name) },
    adjuntos,
  );

  return aplicarAjuste(actual, r);
}
