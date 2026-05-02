"use client";

import { useState, useTransition } from "react";
import { Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addCustomItem, deleteQuoteItem, updateQuoteItem } from "./actions";

type Item = {
  id: string;
  position: number;
  name: string;
  description: string | null;
  quantity: number;
  unit_price_usd: number;
  line_total_usd: number;
  ai_reasoning: string | null;
};

export function QuoteItemsEditor({ quoteId, items }: { quoteId: string; items: Item[] }) {
  const [pending, startTransition] = useTransition();
  const [drafts, setDrafts] = useState<Record<string, Partial<Item>>>({});

  const onChange = (id: string, field: keyof Item, value: string) => {
    setDrafts({ ...drafts, [id]: { ...(drafts[id] ?? {}), [field]: value } });
  };

  const commit = (id: string) => {
    const d = drafts[id];
    if (!d) return;
    const patch: Parameters<typeof updateQuoteItem>[2] = {};
    if (d.name !== undefined) patch.name = d.name as string;
    if (d.quantity !== undefined) patch.quantity = Number(d.quantity);
    if (d.unit_price_usd !== undefined) patch.unit_price_usd = Number(d.unit_price_usd);
    startTransition(async () => {
      await updateQuoteItem(quoteId, id, patch);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    });
  };

  const get = (item: Item, field: keyof Item) =>
    drafts[item.id]?.[field] !== undefined ? (drafts[item.id]?.[field] as string | number) : (item[field] as string | number);

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/30">
            <tr className="text-left">
              <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Equipo</th>
              <th className="px-3 py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground w-24">Cant.</th>
              <th className="px-3 py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground w-32">P. unitario</th>
              <th className="px-3 py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground w-32 text-right">Total</th>
              <th className="px-3 py-3 w-10" />
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <Input
                    value={String(get(it, "name") ?? "")}
                    onChange={(e) => onChange(it.id, "name", e.target.value)}
                    onBlur={() => commit(it.id)}
                    className="border-0 shadow-none px-0 focus-visible:ring-0"
                  />
                  {it.ai_reasoning && (
                    <p className="text-xs text-muted-foreground italic mt-0.5">{it.ai_reasoning}</p>
                  )}
                </td>
                <td className="px-3 py-3">
                  <Input
                    type="number"
                    step="0.5"
                    value={String(get(it, "quantity") ?? "")}
                    onChange={(e) => onChange(it.id, "quantity", e.target.value)}
                    onBlur={() => commit(it.id)}
                    className="text-right tabular-nums"
                  />
                </td>
                <td className="px-3 py-3">
                  <Input
                    type="number"
                    step="0.01"
                    value={String(get(it, "unit_price_usd") ?? "")}
                    onChange={(e) => onChange(it.id, "unit_price_usd", e.target.value)}
                    onBlur={() => commit(it.id)}
                    className="text-right tabular-nums"
                  />
                </td>
                <td className="px-3 py-3 text-right tabular-nums font-medium">
                  USD {Number(it.line_total_usd).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </td>
                <td className="px-3 py-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      startTransition(async () => {
                        await deleteQuoteItem(quoteId, it.id);
                      })
                    }
                  >
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Cotización vacía. Agregá un item.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            startTransition(async () => {
              await addCustomItem(quoteId);
            })
          }
          disabled={pending}
        >
          <Plus className="size-3.5" />
          Agregar item
        </Button>
      </div>
    </div>
  );
}
