import type { HorasProyecto } from "./horas-core";
import type { MonthPnl } from "./parse";

// El desglose del proyecto como lo muestra QuickBooks en su pantalla: los
// ingresos y los costos por cuenta, más cuánto se gastó cada mes. Sin red ni
// SDK: lo usan el sync (al guardarlo) y la pantalla (al dibujarlo).

export type TipoSeccion = "ingreso" | "costo_venta" | "gasto" | "otro_ingreso" | "otro_gasto";

/** Una cuenta del P&L: el total y lo que movió cada mes ("2026-08-01" → monto). */
export type CuentaDesglose = { nombre: string; total: number; meses: Record<string, number> };
export type SeccionDesglose = { tipo: TipoSeccion; total: number; cuentas: CuentaDesglose[] };
export type DesgloseProyecto = {
  desde: string; // inicio de la ventana del reporte: lo anterior no está
  actualizado: string; // ISO de cuándo se trajo de QuickBooks
  secciones: SeccionDesglose[];
};

export const TITULO_SECCION: Record<TipoSeccion, string> = {
  ingreso: "Ingresos",
  costo_venta: "Costo de venta",
  gasto: "Gastos",
  otro_ingreso: "Otros ingresos",
  otro_gasto: "Otros gastos",
};

export const esCosto = (t: TipoSeccion) => t === "costo_venta" || t === "gasto" || t === "otro_gasto";

/** "4101 Ventas de Equipos" → "Ventas de Equipos": el número de cuenta es del contador, no de quien lee. */
export function nombreDeCuenta(nombre: string): string {
  return nombre.replace(/^\s*\d{3,6}(?:[.-]\d+)*\s+/, "").trim() || nombre;
}

export function totalDe(d: DesgloseProyecto, cual: (t: TipoSeccion) => boolean): number {
  return d.secciones.filter((s) => cual(s.tipo)).reduce((a, s) => a + s.total, 0);
}

/**
 * Lo guardado en la base, si tiene la forma de un desglose. Es jsonb: no se
 * confía en que nadie lo haya tocado a mano.
 */
export function normalizarDesglose(v: unknown): DesgloseProyecto | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.desde !== "string" || !Array.isArray(o.secciones)) return null;
  const tipos = Object.keys(TITULO_SECCION);
  const secciones: SeccionDesglose[] = [];
  for (const s of o.secciones as Record<string, unknown>[]) {
    if (!s || typeof s.tipo !== "string" || !tipos.includes(s.tipo) || typeof s.total !== "number" || !Array.isArray(s.cuentas)) continue;
    const cuentas = (s.cuentas as Record<string, unknown>[])
      .filter((c) => c && typeof c.nombre === "string" && typeof c.total === "number")
      .map((c) => ({
        nombre: c.nombre as string,
        total: c.total as number,
        meses:
          c.meses && typeof c.meses === "object"
            ? Object.fromEntries(Object.entries(c.meses as Record<string, unknown>).filter(([, x]) => typeof x === "number")) as Record<string, number>
            : {},
      }));
    secciones.push({ tipo: s.tipo as TipoSeccion, total: s.total, cuentas });
  }
  return { desde: o.desde, actualizado: typeof o.actualizado === "string" ? o.actualizado : o.desde, secciones };
}

/**
 * Las series de "cómo se fue el gasto". Con el desglose por mes se separa en
 * costo de venta y gastos; si QuickBooks no lo dio por mes queda el gasto
 * contable de cada mes, sin separar. Las horas de técnicos van aparte porque
 * no son un asiento contable (ver horas-core).
 */
export type SerieGasto = "costo_venta" | "gasto" | "contable" | "horas";
export type MesGasto = { month: string } & Record<SerieGasto, number>;

export function gastoPorMes(d: DesgloseProyecto | null, horas: HorasProyecto | null, mesesContables: MonthPnl[]): MesGasto[] {
  const acc = new Map<string, MesGasto>();
  const mes = (m: string) => {
    let b = acc.get(m);
    if (!b) acc.set(m, (b = { month: m, costo_venta: 0, gasto: 0, contable: 0, horas: 0 }));
    return b;
  };
  const conMeses = (d?.secciones ?? []).some((s) => esCosto(s.tipo) && s.cuentas.some((c) => Object.keys(c.meses).length > 0));
  if (conMeses) {
    for (const s of d!.secciones) {
      if (!esCosto(s.tipo)) continue;
      for (const c of s.cuentas) {
        for (const [m, v] of Object.entries(c.meses)) mes(m)[s.tipo === "costo_venta" ? "costo_venta" : "gasto"] += v;
      }
    }
  } else {
    for (const m of mesesContables) if (m.cost !== 0) mes(m.month).contable += m.cost;
  }
  for (const h of horas?.meses ?? []) mes(h.month).horas += h.costo;
  const redondo = (n: number) => Math.round(n * 100) / 100;
  return [...acc.values()]
    .map((b) => ({ ...b, costo_venta: redondo(b.costo_venta), gasto: redondo(b.gasto), contable: redondo(b.contable), horas: redondo(b.horas) }))
    .filter((b) => b.costo_venta !== 0 || b.gasto !== 0 || b.contable !== 0 || b.horas !== 0)
    .sort((a, b) => a.month.localeCompare(b.month));
}
