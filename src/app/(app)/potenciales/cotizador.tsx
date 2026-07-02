"use client";

import { useMemo, useState } from "react";
import {
  X,
  Loader2,
  Sparkles,
  Plus,
  Trash2,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  CloudUpload,
  MessageCircle,
  Mail,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { letterTotals, fmtBal, type LetterData, type LetterItem } from "@/lib/quotes/letter";
import { generateQuoteDraft, saveGeneratedQuote, publishQuote, type CotizadorDraft, type SaveCotizacionInput } from "./cotizador-actions";
import type { PublishOut } from "@/lib/quotes/store";
import type { QuoteRow } from "@/lib/pipeline/types";
import { RUBROS, type Rubro } from "@/lib/pipeline/types";

type ApiResult<T> = { error: string } | { ok: true; data: T };
export type CotizadorApi = {
  generate: (brief: string) => Promise<ApiResult<CotizadorDraft>>;
  save: (input: SaveCotizacionInput) => Promise<ApiResult<QuoteRow>>;
  publish: (quoteId: string) => Promise<ApiResult<PublishOut>>;
};

const APP_API: CotizadorApi = { generate: generateQuoteDraft, save: saveGeneratedQuote, publish: publishQuote };

const inputCls =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none disabled:bg-slate-50";

const EXAMPLE =
  "Ej: Reemplazo de compresor Copeland 5HP para el cuarto frío de Esa Flaca Rica – David, incluye mano de obra y materiales, 2,850 más ITBMS, validez 15 días. Elaborado por J. Guerra.";

type Phase = "brief" | "generating" | "review" | "saving" | "done";

export function CotizadorDialog({
  onClose,
  onCreated,
  onUpdated,
  api = APP_API,
  embedded = false,
}: {
  onClose: () => void;
  onCreated: (row: QuoteRow) => void;
  onUpdated?: (row: QuoteRow) => void;
  api?: CotizadorApi;
  embedded?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("brief");
  const [brief, setBrief] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Campos editables del review
  const [numero, setNumero] = useState("");
  const [cliente, setCliente] = useState("");
  const [clienteExistente, setClienteExistente] = useState<string | null>(null);
  const [rubro, setRubro] = useState<Rubro>("DS");
  const [descCorta, setDescCorta] = useState("");
  const [letter, setLetter] = useState<LetterData>({
    fecha: new Date().toISOString().slice(0, 10),
    ubicacion: null,
    tipo: "realizar",
    items: [],
    aplica_itbms: true,
    tasa: 7,
    validez: 30,
    condiciones: null,
    elaborado: null,
  });
  const [savedRow, setSavedRow] = useState<QuoteRow | null>(null);
  const [pub, setPub] = useState<{ state: "idle" | "working" | "ok"; result: PublishOut | null; error: string | null }>({
    state: "idle",
    result: null,
    error: null,
  });

  const totals = useMemo(() => letterTotals(letter), [letter]);

  function setL<K extends keyof LetterData>(k: K, v: LetterData[K]) {
    setLetter((prev) => ({ ...prev, [k]: v }));
  }
  function setItem(i: number, patch: Partial<LetterItem>) {
    setLetter((prev) => ({ ...prev, items: prev.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));
  }

  async function generar() {
    setPhase("generating");
    setError(null);
    const r = await api.generate(brief);
    if ("error" in r) {
      setError(r.error);
      setPhase("brief");
      return;
    }
    const g = r.data.generated;
    setNumero(r.data.suggestedNumber);
    setCliente(r.data.matchedClientName ?? g.client_name);
    setClienteExistente(r.data.matchedClientName);
    setRubro(g.rubro);
    setDescCorta(g.descripcion_corta);
    setLetter({
      fecha: new Date().toISOString().slice(0, 10),
      ubicacion: g.ubicacion,
      tipo: g.tipo,
      items: g.items.map((it) => ({ cant: it.cant, desc: it.desc, precio: it.precio })),
      aplica_itbms: g.aplica_itbms,
      tasa: 7,
      validez: g.validez_dias ?? 30,
      condiciones: g.condiciones,
      elaborado: letter.elaborado,
    });
    setPhase("review");
  }

  async function guardar() {
    setPhase("saving");
    setError(null);
    const r = await api.save({
      quote_number: numero,
      client_name: cliente,
      rubro,
      descripcion_corta: descCorta,
      letter,
    });
    if ("error" in r) {
      setError(r.error);
      setPhase("review");
      return;
    }
    onCreated(r.data);
    setSavedRow(r.data);
    setPhase("done");
  }

  async function publicar() {
    if (!savedRow) return;
    setPub({ state: "working", result: null, error: null });
    const r = await api.publish(savedRow.id);
    if ("error" in r) {
      setPub({ state: "idle", result: null, error: r.error });
      return;
    }
    setPub({ state: "ok", result: r.data, error: null });
    const updated: QuoteRow = { ...savedRow, status: "enviada", dropbox_shared_url: r.data.url };
    setSavedRow(updated);
    onUpdated?.(updated);
  }

  const card = (
      <div
        className={cn(
          "flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white",
          embedded ? "border border-slate-200 shadow-sm" : "max-h-[90vh] shadow-2xl",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-blue-600 text-white">
              <Sparkles className="size-4" />
            </div>
            <h3 className="text-base font-semibold text-slate-900">Cotizador IA</h3>
          </div>
          {!embedded ? (
            <button
              type="button"
              onClick={onClose}
              className="flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
              aria-label="Cerrar"
            >
              <X className="size-5" />
            </button>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {phase === "brief" || phase === "generating" ? (
            <div>
              <p className="text-sm text-slate-600">
                Describí el trabajo en una línea — la IA arma la cotización completa en el formato de DICEC: cliente,
                renglones, precios, ITBMS y condiciones. Después la revisás y ajustás antes de guardar.
              </p>
              <textarea
                rows={4}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder={EXAMPLE}
                className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:border-violet-400 focus:outline-none"
                disabled={phase === "generating"}
              />
              {error ? <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
              <button
                type="button"
                onClick={generar}
                disabled={phase === "generating" || !brief.trim()}
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {phase === "generating" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {phase === "generating" ? "Generando…" : "Generar con IA"}
              </button>
            </div>
          ) : phase === "done" ? (
            <div className="py-6 text-center">
              <CheckCircle2 className="mx-auto size-10 text-emerald-500" />
              <p className="mt-3 text-sm font-semibold text-slate-900">
                Cotización {numero} guardada {savedRow?.status === "borrador" ? "como borrador" : ""}
              </p>

              {pub.state === "ok" && pub.result ? (
                <div className="mx-auto mt-4 max-w-md">
                  <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                    PDF subido a Dropbox: <b>{pub.result.fileName}</b>
                  </p>
                  {pub.result.linkWarning ? (
                    <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-left text-xs text-amber-700 ring-1 ring-inset ring-amber-600/20">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      {pub.result.linkWarning}
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                    {pub.result.url ? (
                      <>
                        <a
                          href={`https://wa.me/?text=${encodeURIComponent(pub.result.waText)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                        >
                          <MessageCircle className="size-4" /> WhatsApp
                        </a>
                        <a
                          href={`mailto:?subject=${encodeURIComponent(`Cotización ${numero} - ${cliente}`)}&body=${encodeURIComponent(pub.result.waText)}`}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                        >
                          <Mail className="size-4" /> Email
                        </a>
                        <a
                          href={pub.result.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          <ExternalLink className="size-4" /> Ver PDF
                        </a>
                      </>
                    ) : null}
                    <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">
                      Listo
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mx-auto mt-2 max-w-md">
                  <p className="text-xs text-slate-500">
                    Publicá para generar el PDF con membrete y subirlo a la carpeta de cartas en Dropbox.
                  </p>
                  {pub.error ? <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{pub.error}</p> : null}
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={publicar}
                      disabled={pub.state === "working"}
                      className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      {pub.state === "working" ? <Loader2 className="size-4 animate-spin" /> : <CloudUpload className="size-4" />}
                      {pub.state === "working" ? "Generando PDF y subiendo…" : "Publicar PDF a Dropbox"}
                    </button>
                    {!embedded && savedRow ? (
                      <a
                        href={`/carta/${savedRow.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <ExternalLink className="size-4" /> Ver carta
                      </a>
                    ) : null}
                    <button
                      type="button"
                      onClick={onClose}
                      disabled={pub.state === "working"}
                      className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                    >
                      Dejar como borrador
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <label className="col-span-1 block">
                  <span className="text-xs font-semibold text-slate-500">Número</span>
                  <input className={inputCls} value={numero} onChange={(e) => setNumero(e.target.value)} />
                </label>
                <label className="col-span-1 block">
                  <span className="text-xs font-semibold text-slate-500">Fecha</span>
                  <input type="date" className={inputCls} value={letter.fecha} onChange={(e) => setL("fecha", e.target.value)} />
                </label>
                <label className="col-span-1 block">
                  <span className="text-xs font-semibold text-slate-500">Rubro</span>
                  <select className={inputCls} value={rubro} onChange={(e) => setRubro(e.target.value as Rubro)}>
                    {(Object.keys(RUBROS) as Rubro[]).map((r) => (
                      <option key={r} value={r}>
                        {r} — {RUBROS[r].label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="col-span-1 block">
                  <span className="text-xs font-semibold text-slate-500">Tipo</span>
                  <select
                    className={inputCls}
                    value={letter.tipo}
                    onChange={(e) => setL("tipo", e.target.value as LetterData["tipo"])}
                  >
                    <option value="realizar">Trabajos a realizar</option>
                    <option value="realizados">Trabajos realizados</option>
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-semibold text-slate-500">
                    Cliente{" "}
                    {clienteExistente ? (
                      <span className="font-medium text-emerald-600">· existente ✓</span>
                    ) : (
                      <span className="font-medium text-amber-600">· nuevo (texto libre)</span>
                    )}
                  </span>
                  <input className={inputCls} value={cliente} onChange={(e) => setCliente(e.target.value)} />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-500">Ubicación (encabezado)</span>
                  <input
                    className={inputCls}
                    value={letter.ubicacion ?? ""}
                    onChange={(e) => setL("ubicacion", e.target.value || null)}
                  />
                </label>
              </div>

              {/* Renglones */}
              <div className="rounded-xl border border-slate-200">
                <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Renglones</span>
                  <button
                    type="button"
                    onClick={() => setLetter((p) => ({ ...p, items: [...p.items, { cant: 1, desc: "", precio: 0 }] }))}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-50"
                  >
                    <Plus className="size-3.5" /> Agregar
                  </button>
                </div>
                <div className="divide-y divide-slate-50">
                  {letter.items.map((it, i) => (
                    <div key={i} className="flex items-start gap-2 px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        className={cn(inputCls, "w-16 shrink-0 text-center")}
                        value={it.cant}
                        onChange={(e) => setItem(i, { cant: Number(e.target.value) })}
                        title="Cantidad"
                      />
                      <textarea
                        rows={2}
                        className={cn(inputCls, "flex-1 resize-y")}
                        value={it.desc}
                        onChange={(e) => setItem(i, { desc: e.target.value })}
                        placeholder="Descripción del renglón"
                      />
                      <div className="w-28 shrink-0">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className={cn(inputCls, "text-right")}
                          value={it.precio}
                          onChange={(e) => setItem(i, { precio: Number(e.target.value) })}
                          title="Precio unitario (sin ITBMS)"
                        />
                        <p className="mt-0.5 text-right text-[10px] tabular-nums text-slate-400">
                          = B/. {fmtBal((Number(it.cant) || 0) * (Number(it.precio) || 0))}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setLetter((p) => ({ ...p, items: p.items.filter((_, j) => j !== i) }))}
                        className="mt-1 shrink-0 rounded-md p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500"
                        title="Quitar renglón"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  ))}
                  {letter.items.length === 0 ? (
                    <p className="px-3 py-4 text-center text-xs text-slate-400">Sin renglones — agregá al menos uno.</p>
                  ) : null}
                </div>
                <div className="border-t border-slate-100 px-3 py-2 text-right text-sm">
                  <span className="mr-4 text-xs text-slate-500">
                    Subtotal <b className="tabular-nums text-slate-800">B/. {fmtBal(totals.subtotal)}</b>
                  </span>
                  {letter.aplica_itbms ? (
                    <span className="mr-4 text-xs text-slate-500">
                      ITBMS {letter.tasa}% <b className="tabular-nums text-slate-800">B/. {fmtBal(totals.itbms)}</b>
                    </span>
                  ) : null}
                  <span className="text-sm font-semibold text-slate-900">
                    Total <span className="tabular-nums">B/. {fmtBal(totals.total)}</span>
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <label className="flex items-center gap-2 pt-4 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={letter.aplica_itbms}
                    onChange={(e) => setL("aplica_itbms", e.target.checked)}
                  />
                  ITBMS {letter.tasa}%
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-500">Validez (días)</span>
                  <input
                    type="number"
                    min={0}
                    className={inputCls}
                    value={letter.validez ?? ""}
                    onChange={(e) => setL("validez", e.target.value === "" ? null : Number(e.target.value))}
                  />
                </label>
                <label className="col-span-2 block">
                  <span className="text-xs font-semibold text-slate-500">Elaborado por (firma)</span>
                  <input
                    className={inputCls}
                    value={letter.elaborado ?? ""}
                    onChange={(e) => setL("elaborado", e.target.value || null)}
                    placeholder="Nombre que firma la carta"
                  />
                </label>
              </div>

              <label className="block">
                <span className="text-xs font-semibold text-slate-500">Condiciones (una por línea)</span>
                <textarea
                  rows={2}
                  className={inputCls}
                  value={letter.condiciones ?? ""}
                  onChange={(e) => setL("condiciones", e.target.value || null)}
                  placeholder="Anticipo del 50% para iniciar.&#10;Tiempo de entrega: 15 días hábiles."
                />
              </label>

              <label className="block">
                <span className="text-xs font-semibold text-slate-500">Descripción corta (para el dashboard)</span>
                <input className={inputCls} value={descCorta} onChange={(e) => setDescCorta(e.target.value)} />
              </label>

              {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
            </div>
          )}
        </div>

        {phase === "review" || phase === "saving" ? (
          <footer className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
            <button
              type="button"
              onClick={() => setPhase("brief")}
              disabled={phase === "saving"}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            >
              <ArrowLeft className="size-4" /> Volver
            </button>
            <button
              type="button"
              onClick={guardar}
              disabled={phase === "saving" || letter.items.length === 0 || !numero.trim() || !cliente.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {phase === "saving" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              Guardar cotización
            </button>
          </footer>
        ) : null}
      </div>
  );

  if (embedded) return card;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      {card}
    </div>
  );
}
