// Tamiz DICEC de licitaciones — implementación del documento interno
// "Tamiz de licitaciones de refrigeración · Panamá":
//   score final = 0.7 × técnico + 0.3 × económico  (redondeado)
// El técnico sale de keywords en el título (tiers 100→65, penalización −30 si
// hay obra civil/eléctrica). El económico usa el sweet spot parametrizable de
// la página como banda 100 y escala las demás. Bandas de prioridad:
//   P1 élite 95–100 · P2 85–94 · P3 75–84 · Filler 60–74 · Descartable <60

import { norm } from "@/lib/clients/normalize";

export type TamizBanda = "p1" | "p2" | "p3" | "filler" | "desc";

export type TamizResult = {
  tecnico: number;
  economico: number;
  score: number;
  banda: TamizBanda;
  matches: string[];
  penalizado: boolean;
  economicoLabel: string;
};

// Evaluación IA persistida en gov_tenders.eval (migración 0013).
export type GovTenderEval = {
  cumplimos: "si" | "parcial" | "no";
  resumen: string;
  requisitos: string[];
  riesgos: string[];
  at: string;
};

function toRegex(kw: string): RegExp {
  const escaped = norm(kw).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:s|es)?(?:$|[^a-z0-9])`);
}
const tier = (puntos: number, kws: string[]) => ({ puntos, kws: kws.map((k) => ({ k, re: toRegex(k) })) });

const TIERS = [
  tier(100, ["agua helada", "chiller", "enfriador de agua", "enfriadora de agua", "enfriadores de agua"]),
  tier(95, ["refrigeracion industrial", "nh3", "amoniaco", "co2", "rack de frio", "racks de frio"]),
  tier(90, [
    "cuarto frio", "camara fria", "camara frigorifica", "evaporador", "evaporadora", "condensador", "condensadora",
    "aire acondicionado de precision", "data center",
  ]),
  tier(85, [
    "hvac", "vrf", "split", "mini split", "minisplit", "manejadora", "unidad manejadora", "uma",
    "climatizacion", "fan coil", "agua fria",
  ]),
  tier(75, ["cuarto de maquinas", "sistema central", "sistemas centrales", "ahu", "blower", "unidad paquete"]),
  tier(70, ["manta termica", "aislamiento termico", "aislamiento"]),
  tier(65, ["aire acondicionado", "acondicionador de aire", "aire central", "refrigeracion", "clima"]),
];

// Combo del documento: "MANTENIMIENTO A/A" puntúa 85 aunque "aire acondicionado"
// solo valga 65.
const MANTENIMIENTO = ["mantenimiento", "preventivo", "correctivo"].map(toRegex);
// Sin "a a" (matcheaba frases como "compra a a granel"); los términos reales cubren el caso.
const AA_CONTEXT = ["aire acondicionado", "acondicionador", "clima", "climatizacion"].map(toRegex);

// Penalización −30 si predomina obra civil o eléctrica. Sin "techo" (las
// unidades tipo techo/rooftop son HVAC) ni "electrico" suelto (una acometida
// eléctrica de un A/A es legítima); nos quedamos con lo inequívocamente civil.
const CIVIL = [
  "obra civil", "construccion", "pintura", "impermeabilizacion",
  "plomeria", "viaducto", "pluvial", "alcantarillado", "sistema electrico", "red electrica", "subestacion",
].map((k) => ({ k, re: toRegex(k) }));

export function tamizScore(
  titulo: string | null,
  precioRef: number | null,
  sweet: { min: number; max: number },
): TamizResult {
  const t = norm(titulo ?? "");
  let tecnico = 0;
  const matches: string[] = [];
  for (const tr of TIERS) {
    const hit = tr.kws.filter(({ re }) => re.test(t));
    if (hit.length > 0) {
      if (tr.puntos > tecnico) tecnico = tr.puntos;
      for (const { k } of hit) if (matches.length < 4 && !matches.includes(k)) matches.push(k);
    }
  }
  if (tecnico > 0 && tecnico < 85 && MANTENIMIENTO.some((re) => re.test(t)) && AA_CONTEXT.some((re) => re.test(t))) {
    tecnico = 85;
  }
  const penalizado = CIVIL.some(({ re }) => re.test(t));
  if (penalizado) tecnico = Math.max(0, tecnico - 30);

  let economico: number;
  let economicoLabel: string;
  const { min, max } = sweet.max > sweet.min ? sweet : { min: 20000, max: 250000 };
  if (precioRef === null) {
    economico = 60;
    economicoLabel = "sin monto declarado";
  } else if (precioRef >= min && precioRef <= max) {
    economico = 100;
    economicoLabel = "sweet spot";
  } else if (precioRef > max && precioRef <= max * 2) {
    economico = 70;
    economicoLabel = "arriba del sweet spot";
  } else if (precioRef > max * 2 && precioRef <= max * 4) {
    economico = 50;
    economicoLabel = "grande";
  } else {
    economico = 30;
    economicoLabel = precioRef < min ? "chico" : "muy grande";
  }

  const score = Math.round(0.7 * tecnico + 0.3 * economico);
  const banda: TamizBanda = score >= 95 ? "p1" : score >= 85 ? "p2" : score >= 75 ? "p3" : score >= 60 ? "filler" : "desc";
  return { tecnico, economico, score, banda, matches, penalizado, economicoLabel };
}

export const BANDA_META: Record<TamizBanda, { label: string; corto: string; chip: string; texto: string; barra: string }> = {
  p1: {
    label: "Prioridad 1 · élite",
    corto: "P1 élite",
    chip: "bg-violet-600 text-white",
    texto: "text-violet-700",
    barra: "bg-violet-600",
  },
  p2: {
    label: "Prioridad 2",
    corto: "P2",
    chip: "bg-emerald-600 text-white",
    texto: "text-emerald-700",
    barra: "bg-emerald-500",
  },
  p3: {
    label: "Prioridad 3",
    corto: "P3",
    chip: "bg-sky-600 text-white",
    texto: "text-sky-700",
    barra: "bg-sky-500",
  },
  filler: {
    label: "Filler · si hay capacidad",
    corto: "Filler",
    chip: "bg-slate-200 text-slate-700",
    texto: "text-slate-500",
    barra: "bg-slate-400",
  },
  desc: {
    label: "Descartable",
    corto: "Desc.",
    chip: "bg-slate-100 text-slate-400",
    texto: "text-slate-400",
    barra: "bg-slate-200",
  },
};

export const BANDAS_ORDEN: TamizBanda[] = ["p1", "p2", "p3", "filler", "desc"];
