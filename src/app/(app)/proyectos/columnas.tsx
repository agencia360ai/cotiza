"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown, GripVertical, Columns3, RotateCcw, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SortState } from "@/components/ui/sortable";

// Las columnas del board de Proyectos: qué hay, en qué orden y cuáles se ven.
//
// El orden y la visibilidad los decide cada persona, no el diseño: quien mira
// cobros todo el día quiere Cobrado pegado a Total, y quien persigue fechas las
// quiere primero. Se guarda en el navegador —es una preferencia de cómo mirar,
// no un dato de la empresa— así que no vale la pena una tabla ni sincronizarla
// entre dispositivos.

export type ColKey = "nombre" | "cliente" | "cotizacion" | "total" | "cobrado" | "gasto" | "margen" | "inicio" | "fin" | "estado";

type ColMeta = {
  label: string;
  /** Ancho mínimo en px. Se suman para el min-width de la tabla. */
  min: number;
  align: "left" | "right";
  /** Qué es, cuando el nombre solo no alcanza. */
  ayuda?: string;
};

export const COL_META: Record<ColKey, ColMeta> = {
  nombre: { label: "Proyecto", min: 210, align: "left" },
  cliente: { label: "Cliente", min: 140, align: "left" },
  cotizacion: { label: "Cotización", min: 150, align: "left", ayuda: "Vincular cotizaciones al proyecto" },
  total: { label: "Total", min: 118, align: "right", ayuda: "Lo facturado, con el margen debajo" },
  cobrado: { label: "Cobrado", min: 106, align: "right", ayuda: "Lo que ya entró de ese total" },
  gasto: { label: "Gasto", min: 100, align: "right" },
  margen: { label: "Margen", min: 110, align: "right", ayuda: "Como columna propia; si no, va debajo del Total" },
  inicio: { label: "Inicio", min: 104, align: "left" },
  fin: { label: "Fin", min: 108, align: "left" },
  estado: { label: "Estado", min: 138, align: "left" },
};

/** Por qué campo ordena cada columna. */
export const SORT_DE_COL: Record<ColKey, string> = {
  nombre: "nombre",
  cliente: "cliente",
  cotizacion: "cotizacion",
  total: "cobro",
  cobrado: "cobrado",
  gasto: "gasto",
  margen: "margen",
  inicio: "inicio",
  fin: "fin",
  estado: "estado",
};

export const ORDEN_DEFECTO: ColKey[] = [
  "nombre",
  "cliente",
  "total",
  "cobrado",
  "gasto",
  "inicio",
  "fin",
  "estado",
  "margen",
  "cotizacion",
];
// Las dos arrancan fuera de la vista. Cotización ocupaba el ancho que les hace
// falta a los nombres, y el margen pasó a leerse debajo del Total —que es de
// donde sale—. Ninguna se borra: se prenden desde el menú, y el margen vuelve a
// ser columna propia (con su barra) cuando alguien la quiere ordenar.
const OCULTAS_DEFECTO: ColKey[] = ["cotizacion", "margen"];

// Ancho de las celdas que no son columnas de datos (ícono de rubro y el botón
// de editar). Entran en el min-width para que la cuenta cierre.
const ANCHO_FIJO = 100;

const LLAVE = "cotiza.proyectos.columnas.v1";

type Guardado = { orden?: unknown; ocultas?: unknown };

// Se sanea lo leído contra las columnas que existen HOY: si una se renombra o
// se agrega, una preferencia vieja no puede dejar la tabla sin esa columna ni
// meter una llave que ya no se renderiza.
function sanear(orden: unknown, ocultas: unknown): { orden: ColKey[]; ocultas: ColKey[] } {
  const validas = new Set(ORDEN_DEFECTO);
  const pedido = Array.isArray(orden) ? orden.filter((k): k is ColKey => validas.has(k as ColKey)) : [];
  const sinDuplicar = [...new Set(pedido)];
  const faltantes = ORDEN_DEFECTO.filter((k) => !sinDuplicar.includes(k));
  const oc = Array.isArray(ocultas) ? ocultas.filter((k): k is ColKey => validas.has(k as ColKey)) : OCULTAS_DEFECTO;
  return { orden: [...sinDuplicar, ...faltantes], ocultas: [...new Set(oc)] };
}

function mover(orden: ColKey[], from: ColKey, to: ColKey): ColKey[] {
  if (from === to) return orden;
  const iFrom = orden.indexOf(from);
  const iTo = orden.indexOf(to);
  if (iFrom < 0 || iTo < 0) return orden;
  const sinEl = orden.filter((k) => k !== from);
  const destino = sinEl.indexOf(to);
  // Arrastrar hacia la derecha deja la columna DESPUÉS de la que se soltó;
  // hacia la izquierda, antes. Es lo que hace el cursor, y cualquier otra
  // regla hace sentir que la columna "saltó" a otro lado.
  sinEl.splice(iFrom < iTo ? destino + 1 : destino, 0, from);
  return sinEl;
}

export type Columnas = {
  /** Visibles, en el orden elegido. Es lo que se renderiza. */
  visibles: ColKey[];
  orden: ColKey[];
  ocultas: Set<ColKey>;
  /** min-width de la tabla según lo que hay a la vista. */
  minWidth: number;
  reordenar: (from: ColKey, to: ColKey) => void;
  alternar: (k: ColKey) => void;
  restablecer: () => void;
  /** true = hay una preferencia guardada (habilita "volver al original"). */
  personalizado: boolean;
};

// La preferencia vive en localStorage, que para React es un sistema externo:
// useSyncExternalStore es la forma de leerlo sin romper la hidratación (en el
// servidor devuelve los valores por defecto) y sin un efecto que setee estado
// en el primer render.
type Pref = { orden: ColKey[]; ocultas: ColKey[]; propio: boolean };

const PREF_DEFECTO: Pref = { orden: ORDEN_DEFECTO, ocultas: OCULTAS_DEFECTO, propio: false };

// La instantánea tiene que ser la MISMA referencia mientras no cambie lo
// guardado, o React re-renderiza sin parar. Por eso se cachea contra el texto
// crudo y solo se reconstruye cuando ese texto cambió.
let cache: Pref = PREF_DEFECTO;
let cacheRaw: string | null | undefined;
const oyentes = new Set<() => void>();

function leer(): Pref {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LLAVE);
  } catch {
    raw = null; // modo privado o storage bloqueado
  }
  if (raw === cacheRaw) return cache;
  cacheRaw = raw;
  if (!raw) {
    cache = PREF_DEFECTO;
    return cache;
  }
  try {
    const g = JSON.parse(raw) as Guardado;
    cache = { ...sanear(g.orden, g.ocultas), propio: true };
  } catch {
    cache = PREF_DEFECTO; // preferencia ilegible: se sigue con la vista normal
  }
  return cache;
}

const enElServidor = () => PREF_DEFECTO;

function suscribir(avisar: () => void): () => void {
  oyentes.add(avisar);
  // Otra pestaña también puede cambiarla.
  window.addEventListener("storage", avisar);
  return () => {
    oyentes.delete(avisar);
    window.removeEventListener("storage", avisar);
  };
}

function escribir(p: { orden: ColKey[]; ocultas: ColKey[] } | null) {
  try {
    if (p) localStorage.setItem(LLAVE, JSON.stringify(p));
    else localStorage.removeItem(LLAVE);
  } catch {
    /* sin espacio o modo privado: no se puede recordar, pero nada se rompe */
  }
  cacheRaw = undefined; // fuerza releer en la próxima instantánea
  oyentes.forEach((f) => f());
}

export function useColumnas(): Columnas {
  const pref = useSyncExternalStore(suscribir, leer, enElServidor);
  const { orden, ocultas } = pref;

  const reordenar = useCallback(
    (from: ColKey, to: ColKey) => {
      const next = mover(orden, from, to);
      if (next !== orden) escribir({ orden: next, ocultas });
    },
    [orden, ocultas],
  );

  const alternar = useCallback(
    (k: ColKey) => {
      const set = new Set(ocultas);
      if (set.has(k)) set.delete(k);
      else set.add(k);
      // Dejar la tabla sin ninguna columna la vuelve ilegible y sin forma de
      // volver: la última visible no se puede apagar.
      if (set.size >= ORDEN_DEFECTO.length) return;
      escribir({ orden, ocultas: [...set] });
    },
    [ocultas, orden],
  );

  const restablecer = useCallback(() => escribir(null), []);

  const ocultasSet = new Set(ocultas);
  const visibles = orden.filter((k) => !ocultasSet.has(k));
  const minWidth = visibles.reduce((a, k) => a + COL_META[k].min, ANCHO_FIJO);

  return {
    visibles,
    orden,
    ocultas: ocultasSet,
    minWidth,
    reordenar,
    alternar,
    restablecer,
    personalizado: pref.propio,
  };
}

/**
 * Encabezado que ordena al hacer clic y se arrastra para mover la columna.
 *
 * El `<th>` entero es el asa: el drag nativo no dispara click, así que las dos
 * interacciones conviven sin un modo aparte ni un handle de 8px que hay que
 * cazar con el mouse. El grip aparece al pasar por encima para que se note que
 * la columna se puede mover — sin él, nadie descubre la función.
 */
export function ColumnaTh<K extends string>({
  col,
  sortKey,
  sort,
  onSort,
  arrastrando,
  onArrastrar,
  className,
}: {
  col: ColKey;
  sortKey: K;
  sort: SortState<K>;
  onSort: (k: K) => void;
  arrastrando: ColKey | null;
  onArrastrar: (from: ColKey, to: ColKey) => void;
  className?: string;
}) {
  const meta = COL_META[col];
  const [encima, setEncima] = useState(false);
  const activo = sort.key === sortKey;
  const esOrigen = arrastrando === col;
  const derecha = meta.align === "right";

  return (
    <th
      draggable
      onDragStart={(ev) => {
        ev.dataTransfer.effectAllowed = "move";
        ev.dataTransfer.setData("text/plain", col);
        onArrastrar(col, col); // marca el origen; el reorden ocurre en el drop
      }}
      onDragEnd={() => setEncima(false)}
      onDragOver={(ev) => {
        if (!arrastrando || arrastrando === col) return;
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "move";
        setEncima(true);
      }}
      onDragLeave={() => setEncima(false)}
      onDrop={(ev) => {
        ev.preventDefault();
        setEncima(false);
        const from = (ev.dataTransfer.getData("text/plain") || arrastrando) as ColKey | null;
        if (from && from !== col) onArrastrar(from, col);
      }}
      onClick={() => onSort(sortKey)}
      aria-sort={activo ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      title={meta.ayuda ? `${meta.ayuda} · arrastrá para mover la columna` : "Clic para ordenar · arrastrá para mover la columna"}
      className={cn(
        "group relative cursor-pointer select-none px-2.5 py-2.5 font-semibold transition-colors hover:text-slate-700",
        derecha && "text-right",
        esOrigen && "opacity-40",
        encima && (derecha ? "shadow-[inset_2px_0_0_0_#6366F1]" : "shadow-[inset_-2px_0_0_0_#6366F1]"),
        className,
      )}
    >
      {/* Absoluto a propósito: en el flujo, el grip le sumaba ~16px a CADA
          columna y entre las ocho empujaban la tabla fuera de la pantalla. */}
      <GripVertical
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1/2 size-3 -translate-y-1/2 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100",
          derecha ? "right-0" : "left-0",
        )}
      />
      <span className={cn("inline-flex items-center gap-1", derecha && "flex-row-reverse")}>
        {meta.label}
        {activo ? (
          sort.dir === "asc" ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />
        ) : (
          <ChevronsUpDown className="size-3.5 opacity-30" />
        )}
      </span>
    </th>
  );
}

/** Menú de columnas: qué se ve y volver al orden original. */
export function ColumnasMenu({ cols }: { cols: Columnas }) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (ev: MouseEvent) => {
      if (caja.current && !caja.current.contains(ev.target as Node)) setAbierto(false);
    };
    const esc = (ev: KeyboardEvent) => ev.key === "Escape" && setAbierto(false);
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", esc);
    };
  }, [abierto]);

  return (
    <div ref={caja} className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        title="Elegir qué columnas se ven"
        className={cn(
          "inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50",
          abierto && "bg-slate-50 text-slate-900",
        )}
      >
        <Columns3 className="size-3.5" />
        Columnas
        {cols.ocultas.size > 0 ? (
          <span className="rounded-full bg-slate-100 px-1.5 text-[10px] tabular-nums text-slate-500">
            {cols.visibles.length}
          </span>
        ) : null}
      </button>

      {abierto ? (
        <div className="absolute right-0 z-30 mt-1.5 w-64 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
          <p className="px-2 py-1.5 text-[11px] text-slate-500">
            Arrastrá los encabezados de la tabla para cambiarlas de lugar.
          </p>
          <ul className="max-h-[26rem] overflow-y-auto">
            {cols.orden.map((k) => {
              const visible = !cols.ocultas.has(k);
              return (
                <li key={k}>
                  <button
                    type="button"
                    onClick={() => cols.alternar(k)}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-slate-50"
                  >
                    <span
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded border",
                        visible ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300",
                      )}
                    >
                      {visible ? <Check className="size-3" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block font-medium", visible ? "text-slate-900" : "text-slate-400")}>
                        {COL_META[k].label}
                      </span>
                      {COL_META[k].ayuda ? (
                        <span className="block truncate text-[10px] text-slate-400">{COL_META[k].ayuda}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {cols.personalizado ? (
            <button
              type="button"
              onClick={() => {
                cols.restablecer();
                setAbierto(false);
              }}
              className="mt-1 flex w-full cursor-pointer items-center gap-1.5 rounded-lg border-t border-slate-100 px-2 py-2 text-[11px] font-semibold text-slate-500 hover:bg-slate-50 hover:text-slate-700"
            >
              <RotateCcw className="size-3" />
              Volver al orden original
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
