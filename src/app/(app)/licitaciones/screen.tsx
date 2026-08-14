"use client";

import { useMemo, useState } from "react";
import { Landmark } from "lucide-react";
import { LicitacionesTab } from "../potenciales/screen";
import { formatMoney, type TenderRow, type TenderStatus } from "@/lib/pipeline/types";
import { cn } from "@/lib/utils";

type ClientOpt = { id: string; name: string; locations: { id: string; name: string }[] };

// Adjudicado = ganadas + orden de proceder. Es lo mismo que muestra Inicio, y
// tiene que dar igual acá: si los dos números difieren, el equipo deja de
// creerle a los dos.
const ADJUDICADO: TenderStatus[] = ["ganada", "orden_proceder"];
// Presentado incluye todo lo que ya se entregó, ganado o no: mide cuánto se
// compitió, no cuánto se ganó.
const PRESENTADO: TenderStatus[] = ["presentada", "por_partir", "en_revision", "ganada", "orden_proceder", "por_cobrar", "cobrado", "no_ganada"];
const EN_EVALUACION: TenderStatus[] = ["presentada", "por_partir", "en_revision"];

export function LicitacionesScreen({ tenders, clients }: { tenders: TenderRow[]; clients: ClientOpt[] }) {
  const [rows, setRows] = useState<TenderRow[]>(tenders);

  const kpis = useMemo(() => {
    // Las archivadas se excluyen: el equipo las ocultó a propósito. Contarlas
    // inflaba "Adjudicado" en $83,000 y hacía que este número no cuadrara con
    // las tarjetas de abajo, que sí las filtran.
    const vivas = rows.filter((t) => !t.archived_at);
    const suma = (sts: TenderStatus[]) =>
      vivas.filter((t) => sts.includes(t.status)).reduce((a, t) => a + (t.amount_ref_usd ?? 0), 0);
    const cuenta = (sts: TenderStatus[]) => vivas.filter((t) => sts.includes(t.status)).length;

    // Tasa de éxito sobre lo DECIDIDO: las que siguen en evaluación todavía no
    // ganaron ni perdieron, y meterlas en el denominador hunde el número.
    const ganadas = cuenta(ADJUDICADO) + cuenta(["por_cobrar", "cobrado"]);
    const perdidas = cuenta(["no_ganada"]);
    const decididas = ganadas + perdidas;

    return {
      presentado: suma(PRESENTADO),
      nPresentado: cuenta(PRESENTADO),
      adjudicado: suma(ADJUDICADO),
      nAdjudicado: cuenta(ADJUDICADO),
      evaluacion: suma(EN_EVALUACION),
      nEvaluacion: cuenta(EN_EVALUACION),
      porParticipar: suma(["por_participar"]),
      nPorParticipar: cuenta(["por_participar"]),
      tasa: decididas > 0 ? ganadas / decididas : null,
      decididas,
    };
  }, [rows]);

  return (
    <div className="min-h-full bg-canvas">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/90 px-4 py-4 backdrop-blur md:px-8">
        <div className="flex items-center gap-2.5">
          <span className="flex size-[30px] shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-700">
            <Landmark className="size-4" />
          </span>
          <div>
            <h1 className="text-[21px] font-bold tracking-[-0.03em] text-slate-900">Licitaciones</h1>
            <p className="text-xs text-slate-500">
              Lo que se presentó al Estado y lo que todavía se puede presentar
            </p>
          </div>
        </div>
      </header>

      <div className="max-w-[1400px] px-4 py-6 md:px-8">
        <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
          <Kpi label="Presentado" value={formatMoney(kpis.presentado)} sub={`${kpis.nPresentado} procesos`} />
          <Kpi
            label="Adjudicado"
            value={formatMoney(kpis.adjudicado)}
            sub={`${kpis.nAdjudicado} ganadas + orden`}
            color="#047857"
            tint="bg-[#F8FDFB]"
          />
          <Kpi label="En evaluación" value={formatMoney(kpis.evaluacion)} sub={`${kpis.nEvaluacion} sin resolver`} color="#1D4ED8" />
          <Kpi label="Por participar" value={formatMoney(kpis.porParticipar)} sub={`${kpis.nPorParticipar} en la mira`} color="#6D28D9" />
          <Kpi
            label="Tasa de éxito"
            value={kpis.tasa !== null ? `${Math.round(kpis.tasa * 100)}%` : "s/d"}
            sub={kpis.decididas > 0 ? `sobre ${kpis.decididas} decididas` : "nada decidido aún"}
            color={kpis.tasa !== null && kpis.tasa >= 0.3 ? "#047857" : "#B45309"}
          />
        </div>

        <LicitacionesTab tenders={rows} setTenders={setRows} clients={clients} />
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  color,
  tint,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  tint?: string;
}) {
  return (
    <div className={cn("rounded-card border border-line bg-surface px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,.04)]", tint)}>
      <p className="text-[10px] font-bold uppercase tracking-[0.09em] text-slate-500">{label}</p>
      <p
        className="mt-0.5 whitespace-nowrap font-bold tracking-[-0.03em] tabular-nums text-slate-900"
        style={{ fontSize: "clamp(18px, 1.6vw, 24px)", ...(color ? { color } : {}) }}
      >
        {value}
      </p>
      {sub ? <p className="text-[11px] text-slate-500">{sub}</p> : null}
    </div>
  );
}
