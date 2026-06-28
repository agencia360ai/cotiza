"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2, CheckCircle2, AlertTriangle, X, MapPin, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { analyzeClientNames, applyStandardization, type ConfirmedCluster } from "./actions";

type Member = { name: string; branch: string | null; included: boolean };
type EditCluster = {
  canonical: string;
  category: string | null;
  confidence: "alta" | "media" | "baja";
  note: string | null;
  skip: boolean;
  assignTo: string | null;
  members: Member[];
};

const CONF_STYLE: Record<string, string> = {
  alta: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  media: "bg-amber-50 text-amber-700 ring-amber-600/20",
  baja: "bg-rose-50 text-rose-700 ring-rose-600/20",
};

export function StandardizeReview({
  clients,
  quotesUnlinked,
  tendersUnlinked,
}: {
  clients: { id: string; name: string }[];
  quotesUnlinked: number;
  tendersUnlinked: number;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "analyzing" | "review" | "applying" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [clusters, setClusters] = useState<EditCluster[]>([]);
  const [result, setResult] = useState<Awaited<ReturnType<typeof applyStandardization>> | null>(null);

  async function analyze() {
    setPhase("analyzing");
    setError(null);
    const r = await analyzeClientNames();
    if (!r.ok) {
      setError(r.error);
      setPhase("idle");
      return;
    }
    setCounts(r.counts);
    setClusters(
      r.clusters.map((c) => ({
        canonical: c.canonical,
        category: c.category,
        confidence: c.confidence,
        note: c.note,
        skip: false,
        assignTo: null,
        members: c.members.map((m) => ({ name: m.name, branch: m.branch, included: true })),
      })),
    );
    setPhase("review");
  }

  function patch(i: number, p: Partial<EditCluster>) {
    setClusters((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...p } : c)));
  }
  function toggleMember(ci: number, mi: number) {
    setClusters((prev) =>
      prev.map((c, idx) =>
        idx === ci ? { ...c, members: c.members.map((m, j) => (j === mi ? { ...m, included: !m.included } : m)) } : c,
      ),
    );
  }

  const stats = useMemo(() => {
    let activeClusters = 0;
    let quotes = 0;
    for (const c of clusters) {
      if (c.skip) continue;
      const inc = c.members.filter((m) => m.included);
      if (inc.length === 0) continue;
      activeClusters++;
      for (const m of inc) quotes += counts[m.name] ?? 0;
    }
    return { activeClusters, quotes };
  }, [clusters, counts]);

  async function apply() {
    const payload: ConfirmedCluster[] = clusters
      .filter((c) => !c.skip)
      .map((c) => ({
        canonical: c.canonical,
        category: c.category,
        existingClientId: c.assignTo,
        members: c.members.filter((m) => m.included).map((m) => ({ name: m.name, branch: m.branch })),
      }))
      .filter((c) => c.canonical.trim() && c.members.length > 0);
    if (payload.length === 0) return;
    setPhase("applying");
    setError(null);
    const r = await applyStandardization(payload);
    setResult(r);
    if (!r.ok) {
      setError(r.error);
      setPhase("review");
      return;
    }
    setPhase("done");
    router.refresh();
  }

  if (phase === "done" && result?.ok) {
    const s = result.summary;
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-6">
        <div className="flex items-center gap-2 text-lg font-semibold text-emerald-800">
          <CheckCircle2 className="size-5" /> Estandarización aplicada
        </div>
        <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-slate-700 sm:grid-cols-3">
          <li>Clientes creados: <b className="tabular-nums">{s.clientsCreated}</b></li>
          <li>Clientes reusados: <b className="tabular-nums">{s.clientsReused}</b></li>
          <li>Sucursales: <b className="tabular-nums">{s.locations}</b></li>
          <li>Aliases: <b className="tabular-nums">{s.aliases}</b></li>
          <li>Cotizaciones linkeadas: <b className="tabular-nums">{s.quotesLinked}</b></li>
          <li>Licitaciones linkeadas: <b className="tabular-nums">{s.tendersLinked}</b></li>
        </ul>
        {s.errors.length > 0 ? (
          <ul className="mt-3 space-y-0.5 text-xs text-amber-700">
            {s.errors.map((e, i) => (
              <li key={i}>⚠ {e}</li>
            ))}
          </ul>
        ) : null}
        <a href="/maintenance/clients" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:underline">
          Ver clientes <ChevronRight className="size-4" />
        </a>
      </div>
    );
  }

  if (phase === "idle" || phase === "analyzing") {
    return (
      <div className="rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-50 to-blue-50 p-6">
        <p className="text-sm text-slate-700">
          Hay <b>{quotesUnlinked}</b> cotizaciones y <b>{tendersUnlinked}</b> licitaciones sin cliente asignado. La IA va a
          proponer cómo agruparlas.
        </p>
        {error ? (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-inset ring-red-600/20">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}
        <button
          type="button"
          onClick={analyze}
          disabled={phase === "analyzing"}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {phase === "analyzing" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {phase === "analyzing" ? "Analizando con IA…" : "Analizar con IA"}
        </button>
        {phase === "analyzing" ? (
          <p className="mt-2 text-xs text-slate-500">Agrupando ~167 nombres; puede tardar unos segundos.</p>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <div className="sticky top-0 z-10 -mx-4 mb-4 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur md:mx-0 md:rounded-xl md:border md:px-4">
        <p className="text-sm text-slate-600">
          <b className="text-slate-900">{stats.activeClusters}</b> clientes · <b className="text-slate-900">{stats.quotes}</b> cotizaciones a linkear
        </p>
        <button
          type="button"
          onClick={apply}
          disabled={phase === "applying" || stats.activeClusters === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {phase === "applying" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
          Aplicar
        </button>
      </div>

      {error ? (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-inset ring-red-600/20">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <ul className="space-y-3">
        {clusters.map((c, i) => {
          const included = c.members.filter((m) => m.included);
          return (
            <li
              key={i}
              className={cn(
                "rounded-2xl border bg-card p-4 transition-opacity",
                c.skip ? "border-slate-200 opacity-50" : "border-slate-200",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={c.canonical}
                  onChange={(e) => patch(i, { canonical: e.target.value })}
                  disabled={c.skip}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-900 focus:border-slate-400 focus:outline-none"
                />
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ring-1 ring-inset", CONF_STYLE[c.confidence])}>
                  {c.confidence}
                </span>
                <button
                  type="button"
                  onClick={() => patch(i, { skip: !c.skip })}
                  className={cn(
                    "rounded-lg px-2 py-1 text-xs font-medium",
                    c.skip ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                  )}
                >
                  {c.skip ? "Incluir" : "Omitir"}
                </button>
              </div>

              {!c.skip ? (
                <>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className="text-xs text-slate-500">Cliente:</label>
                    <select
                      value={c.assignTo ?? ""}
                      onChange={(e) => patch(i, { assignTo: e.target.value || null })}
                      className="rounded-lg border border-slate-200 px-2 py-1 text-xs focus:border-slate-400 focus:outline-none"
                    >
                      <option value="">+ Crear nuevo</option>
                      {clients.map((cl) => (
                        <option key={cl.id} value={cl.id}>
                          {cl.name}
                        </option>
                      ))}
                    </select>
                    {c.note ? <span className="text-[11px] text-slate-400">· {c.note}</span> : null}
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {c.members.map((m, mi) => (
                      <button
                        type="button"
                        key={mi}
                        onClick={() => toggleMember(i, mi)}
                        className={cn(
                          "group inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs ring-1 ring-inset",
                          m.included
                            ? "bg-slate-50 text-slate-700 ring-slate-200"
                            : "bg-transparent text-slate-300 line-through ring-slate-100",
                        )}
                        title={m.included ? "Sacar de este cliente" : "Volver a incluir"}
                      >
                        {m.branch ? <MapPin className="size-3 text-slate-400" /> : null}
                        <span>{m.name}</span>
                        {m.branch ? <span className="text-slate-400">· {m.branch}</span> : null}
                        <span className="tabular-nums text-slate-400">{counts[m.name] ?? 0}</span>
                        {m.included ? <X className="size-3 text-slate-300 group-hover:text-slate-500" /> : null}
                      </button>
                    ))}
                  </div>
                  {included.length === 0 ? (
                    <p className="mt-2 text-[11px] text-amber-600">Sin miembros incluidos — este cliente no se creará.</p>
                  ) : null}
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
