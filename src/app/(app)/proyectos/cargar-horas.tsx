"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HorasProyecto } from "@/lib/quickbooks/horas-core";
import {
  borrarHoraCargada,
  cargarHoras,
  getEquipoHoras,
  getHorasCargadas,
  type HoraCargada,
  type MiembroEquipo,
} from "./horas-actions";
import { bal, fmtHoras, MESES_CORTOS } from "./formato";

type Linea = { key: number; technicianId: string; fecha: string; horas: string; nota: string };

const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Panama" });
const campo = "w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm focus:border-slate-400 focus:outline-none disabled:bg-slate-50";
let siguiente = 1;
const nueva = (base?: Partial<Linea>): Linea => ({ key: siguiente++, technicianId: "", fecha: hoy(), horas: "", nota: "", ...base });

/**
 * Cargar horas de técnicos al proyecto sin entrar a QuickBooks. Se guardan
 * allá como el mismo registro de tiempo de siempre: los de planilla con su
 * costo por hora, los de servicio profesional sin costo (se les paga por
 * factura). Lo cargado desde acá se puede borrar desde acá.
 */
export function CargarHoras({
  qbJobId,
  nombreProyecto,
  onCambio,
  onCerrar,
}: {
  qbJobId: string;
  nombreProyecto: string;
  onCambio: (h: HorasProyecto | null) => void;
  onCerrar: () => void;
}) {
  const [equipo, setEquipo] = useState<MiembroEquipo[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [errorEquipo, setErrorEquipo] = useState<string | null>(null);
  const [lineas, setLineas] = useState<Linea[]>(() => [nueva()]);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: string | null; problemas: string[] } | null>(null);
  const [cargadas, setCargadas] = useState<HoraCargada[] | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<string | null>(null);

  function recibirEquipo(r: Awaited<ReturnType<typeof getEquipoHoras>>) {
    setBuscando(false);
    if ("error" in r) setErrorEquipo(r.error);
    else {
      setErrorEquipo(null);
      setEquipo(r.data);
    }
  }

  useEffect(() => {
    let vivo = true;
    void getEquipoHoras().then((r) => vivo && recibirEquipo(r));
    void getHorasCargadas(qbJobId).then((r) => vivo && "ok" in r && setCargadas(r.data));
    return () => {
      vivo = false;
    };
  }, [qbJobId]);

  async function revincular() {
    setBuscando(true);
    recibirEquipo(await getEquipoHoras(true));
  }

  const cambiar = (key: number, patch: Partial<Linea>) => setLineas((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const porId = new Map((equipo ?? []).map((m) => [m.id, m]));
  const ordenado = [...(equipo ?? [])].sort((a, b) => a.nombre.localeCompare(b.nombre));
  // Ingenieros aparte de los técnicos: los dos son planilla, pero quien carga
  // busca a uno o a otro, no a "alguien de planilla".
  const ingenieros = ordenado.filter((m) => m.tipo === "Employee" && m.ingeniero);
  const planilla = ordenado.filter((m) => m.tipo === "Employee" && !m.ingeniero);
  const servicio = ordenado.filter((m) => m.tipo === "Vendor");
  const fuera = ordenado.filter((m) => !m.tipo);

  const validas = lineas.filter((l) => l.technicianId && Number(l.horas) > 0);
  const totalHoras = validas.reduce((a, l) => a + Number(l.horas), 0);
  // Estimado: QuickBooks aplica su propia tarifa al guardar.
  const costoEstimado = validas.reduce((a, l) => {
    const m = porId.get(l.technicianId);
    return a + (m?.tipo === "Employee" ? (m.costoHora ?? 0) * Number(l.horas) : 0);
  }, 0);
  const incompletas = lineas.some((l) => (l.technicianId || l.horas) && !(l.technicianId && Number(l.horas) > 0 && Number(l.horas) <= 24));

  async function guardar() {
    setGuardando(true);
    setAviso(null);
    const r = await cargarHoras(
      qbJobId,
      validas.map((l) => ({ technicianId: l.technicianId, fecha: l.fecha, horas: Number(l.horas), nota: l.nota })),
    );
    setGuardando(false);
    if ("error" in r) {
      setAviso({ ok: null, problemas: [r.error] });
      return;
    }
    const { creadas, problemas, horas } = r.data;
    setAviso({
      ok: creadas > 0 ? `${creadas} ${creadas === 1 ? "registro guardado" : "registros guardados"} en QuickBooks.` : null,
      problemas: problemas.map((p) => (p.linea > 0 ? `Línea ${p.linea} (${p.tecnico}): ${p.error}` : p.error)),
    });
    if (creadas > 0) {
      onCambio(horas);
      // Quedan solo las que fallaron, para corregirlas y volver a intentar.
      const fallidas = new Set(problemas.map((p) => p.linea - 1));
      const restantes = validas.filter((_, i) => fallidas.has(i));
      setLineas(restantes.length ? restantes : [nueva({ fecha: lineas[lineas.length - 1]?.fecha })]);
      const c = await getHorasCargadas(qbJobId);
      if ("ok" in c) setCargadas(c.data);
    }
  }

  async function borrar(id: string) {
    setBorrando(id);
    setConfirmar(null);
    const r = await borrarHoraCargada(id);
    setBorrando(null);
    if ("error" in r) {
      setAviso({ ok: null, problemas: [r.error] });
      return;
    }
    onCambio(r.data.horas);
    setCargadas((prev) => (prev ?? []).filter((c) => c.id !== id));
    setAviso({ ok: "Borrado de QuickBooks.", problemas: [] });
  }

  return (
    <section aria-label="Cargar horas de técnicos" className="rounded-lg border border-teal-200 bg-teal-50/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900">Cargar horas a QuickBooks</p>
          <p className="mt-0.5 max-w-3xl text-[11px] text-slate-600">
            Quedan en QuickBooks en este proyecto, igual que si las cargaras allá. Planilla: suman su costo por hora al proyecto (no toca la
            planilla). Servicio profesional: sin costo, porque se paga con su factura.
          </p>
        </div>
        <button type="button" onClick={onCerrar} className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-slate-700" aria-label="Cerrar carga de horas">
          <X className="size-4" />
        </button>
      </div>

      {errorEquipo ? <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{errorEquipo}</p> : null}
      {!equipo && !errorEquipo ? (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
          <Loader2 className="size-3.5 animate-spin" /> Cargando el equipo (la primera vez lo busca en QuickBooks)…
        </p>
      ) : null}

      {equipo ? (
        <>
          <div className="mt-3 space-y-2">
            <div className="hidden grid-cols-[minmax(0,1.4fr)_9.5rem_5.5rem_minmax(0,1fr)_2rem] gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 md:grid">
              <span>Persona</span>
              <span>Fecha</span>
              <span>Horas</span>
              <span>Nota (sale en QuickBooks)</span>
              <span />
            </div>
            {lineas.map((l, i) => {
              const m = porId.get(l.technicianId);
              return (
                <div key={l.key} className="grid grid-cols-2 gap-2 rounded-lg bg-white p-2 ring-1 ring-slate-100 md:grid-cols-[minmax(0,1.4fr)_9.5rem_5.5rem_minmax(0,1fr)_2rem] md:bg-transparent md:p-0 md:ring-0">
                  <select
                    className={cn(campo, "col-span-2 md:col-span-1")}
                    value={l.technicianId}
                    onChange={(e) => cambiar(l.key, { technicianId: e.target.value })}
                    disabled={guardando}
                    aria-label={`Persona, línea ${i + 1}`}
                  >
                    <option value="">Elige a la persona…</option>
                    {ingenieros.length ? (
                      <optgroup label="Ingenieros">
                        {ingenieros.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nombre} · {p.costoHora ? `$${p.costoHora}/h` : "sin tarifa en QuickBooks"}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    {planilla.length ? (
                      <optgroup label="Técnicos de planilla">
                        {planilla.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nombre} · {p.costoHora ? `$${p.costoHora}/h` : "sin tarifa en QuickBooks"}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    {servicio.length ? (
                      <optgroup label="Servicio profesional · sin costo por hora">
                        {servicio.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nombre}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    {fuera.length ? (
                      <optgroup label="No están en QuickBooks">
                        {fuera.map((p) => (
                          <option key={p.id} value={p.id} disabled>
                            {p.nombre}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                  </select>
                  <input
                    type="date"
                    className={campo}
                    value={l.fecha}
                    max={hoy()}
                    onChange={(e) => cambiar(l.key, { fecha: e.target.value })}
                    disabled={guardando}
                    aria-label={`Fecha, línea ${i + 1}`}
                  />
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0.25}
                    max={24}
                    step={0.25}
                    placeholder="8"
                    className={cn(campo, "text-right tabular-nums")}
                    value={l.horas}
                    onChange={(e) => cambiar(l.key, { horas: e.target.value })}
                    disabled={guardando}
                    aria-label={`Horas, línea ${i + 1}`}
                  />
                  <input
                    className={cn(campo, "col-span-2 md:col-span-1")}
                    value={l.nota}
                    placeholder={nombreProyecto}
                    onChange={(e) => cambiar(l.key, { nota: e.target.value })}
                    disabled={guardando}
                    aria-label={`Nota, línea ${i + 1}`}
                  />
                  <button
                    type="button"
                    onClick={() => setLineas((prev) => (prev.length > 1 ? prev.filter((x) => x.key !== l.key) : [nueva({ fecha: l.fecha })]))}
                    disabled={guardando}
                    className="col-span-2 flex items-center justify-center rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 md:col-span-1"
                    aria-label={`Quitar línea ${i + 1}`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                  {m?.tipo === "Employee" && !m.costoHora ? (
                    <p className="col-span-2 text-[11px] text-amber-700 md:col-span-5">
                      {m.nombre} no tiene tarifa de costo en QuickBooks: sus horas quedan registradas pero no suman costo hasta que contabilidad se la ponga.
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setLineas((prev) => [...prev, nueva({ fecha: prev[prev.length - 1]?.fecha, nota: prev[prev.length - 1]?.nota })])}
              disabled={guardando}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-teal-800 hover:bg-white disabled:opacity-50"
            >
              <Plus className="size-3.5" /> Otra línea
            </button>
            {fuera.length || planilla.some((p) => !p.costoHora) ? (
              <button
                type="button"
                onClick={() => void revincular()}
                disabled={buscando || guardando}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-white hover:text-slate-800 disabled:opacity-50"
                title="Si agregaron a alguien o le pusieron tarifa en QuickBooks"
              >
                <RefreshCw className={cn("size-3.5", buscando && "animate-spin")} /> Volver a buscar en QuickBooks
              </button>
            ) : null}
            <span className="ml-auto text-xs text-slate-600">
              {validas.length > 0 ? (
                <>
                  <span className="font-semibold tabular-nums text-slate-900">{fmtHoras(totalHoras)} h</span> · ≈{" "}
                  <span className="font-semibold tabular-nums text-slate-900">{bal(costoEstimado)}</span> de costo
                </>
              ) : (
                "Elige persona y horas"
              )}
            </span>
            <button
              type="button"
              onClick={() => void guardar()}
              disabled={guardando || validas.length === 0 || incompletas}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {guardando ? <Loader2 className="size-4 animate-spin" /> : null}
              {guardando ? "Guardando en QuickBooks…" : "Guardar en QuickBooks"}
            </button>
          </div>
          {incompletas ? <p className="mt-1 text-right text-[11px] text-amber-700">Cada línea necesita persona y horas (hasta 24).</p> : null}
        </>
      ) : null}

      {aviso ? (
        <div className="mt-2 space-y-1 text-xs" role="status">
          {aviso.ok ? (
            <p className="flex items-center gap-1.5 font-semibold text-emerald-700">
              <CheckCircle2 className="size-4" /> {aviso.ok}
            </p>
          ) : null}
          {aviso.problemas.map((p, i) => (
            <p key={i} className="rounded-lg bg-red-50 px-3 py-1.5 text-red-700">
              {p}
            </p>
          ))}
        </div>
      ) : null}

      {cargadas && cargadas.length > 0 ? (
        <div className="mt-3 border-t border-teal-100 pt-2">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Cargadas desde la app</p>
          <ul className="divide-y divide-teal-100/70 text-xs">
            {cargadas.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5">
                <span className="w-14 text-slate-500 tabular-nums">
                  {Number(c.fecha.slice(8, 10))} {MESES_CORTOS[Number(c.fecha.slice(5, 7)) - 1]}
                </span>
                <span className="min-w-0 flex-1 truncate text-slate-800" title={c.nota ?? undefined}>
                  {c.tecnico}
                  {c.nota ? <span className="text-slate-400"> · {c.nota}</span> : null}
                </span>
                <span className="tabular-nums text-slate-700">{fmtHoras(c.horas)} h</span>
                <span className="w-16 text-right tabular-nums text-slate-700">{c.tipo === "Vendor" ? "sin costo" : bal(c.horas * c.costoHora)}</span>
                {confirmar === c.id ? (
                  <span className="flex items-center gap-1">
                    <button type="button" onClick={() => void borrar(c.id)} className="rounded-md bg-red-600 px-2 py-0.5 font-semibold text-white hover:bg-red-700">
                      Borrar de QuickBooks
                    </button>
                    <button type="button" onClick={() => setConfirmar(null)} className="rounded-md px-2 py-0.5 text-slate-500 hover:bg-white">
                      No
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmar(c.id)}
                    disabled={borrando === c.id}
                    className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-red-600 disabled:opacity-50"
                    aria-label={`Borrar ${fmtHoras(c.horas)} h de ${c.tecnico} del ${c.fecha}`}
                  >
                    {borrando === c.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
