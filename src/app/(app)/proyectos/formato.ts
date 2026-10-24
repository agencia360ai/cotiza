// Montos y fechas de la pantalla de Proyectos: los usan el tablero y el resumen
// de cada proyecto, que tienen que decir lo mismo.

// Mismo $ que el resto de la app (los "B/." viejos desentonaban con el Inicio).
// El signo va antes del $: "-$4,802.39", no "$-4,802.39".
export function bal(n: number): string {
  return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function balCompact(n: number): string {
  return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
}
export const fmtHoras = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });

export function marginTextColor(m: number): string {
  if (m >= 0.4) return "text-emerald-600";
  if (m >= 0.2) return "text-amber-600";
  return "text-rose-600";
}

export const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export function fmtCorta(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return `${MESES_CORTOS[(m ?? 1) - 1]} ${String(y).slice(2)}`;
}
