// Revisiones de cotizaciones: "COT DC 26-020 REV. 2" → base "COT DC 26-020" + rev 2.
// Única fuente de verdad para Inicio y la página de Cotizaciones: la última
// revisión es la vigente (cuenta en KPIs y charts); las anteriores son historial
// colapsado. Misma base + misma rev = posible duplicado real (solo una cuenta).

export type RevisableQuote = { quote_number: string; sent_date: string | null };
export type RevisionGroup<T extends RevisableQuote> = { main: T; older: T[]; dupCount: number };

export function parseRev(qn: string): { base: string; rev: number } {
  const s = qn.replace(/\s+/g, " ").trim();
  let m = s.match(/^(.*?)[\s.-]*(?:rev\.?\s*|r)(\d+(?:\.\d+)?)$/i);
  if (m && m[1].trim().length >= 4) return { base: m[1].trim().toUpperCase(), rev: parseFloat(m[2]) };
  // "R" / "REV" suelto al final (sin dígitos) = primera revisión. Requiere
  // separador antes para no comerse palabras que terminan en R (COMPRESOR).
  m = s.match(/^(.*?)[\s.-]+(?:rev\.?|r)$/i);
  if (m && m[1].trim().length >= 4) return { base: m[1].trim().toUpperCase(), rev: 1 };
  return { base: s.toUpperCase(), rev: 0 };
}

export function groupRevisions<T extends RevisableQuote>(rows: T[]): RevisionGroup<T>[] {
  const byBase = new Map<string, T[]>();
  for (const r of rows) {
    const { base } = parseRev(r.quote_number);
    const arr = byBase.get(base) ?? [];
    arr.push(r);
    byBase.set(base, arr);
  }
  const out: RevisionGroup<T>[] = [];
  for (const arr of byBase.values()) {
    const sortedArr = [...arr].sort((a, b) => {
      const ra = parseRev(a.quote_number).rev;
      const rb = parseRev(b.quote_number).rev;
      if (ra !== rb) return rb - ra;
      return (b.sent_date ?? "").localeCompare(a.sent_date ?? "");
    });
    const main = sortedArr[0];
    const maxRev = parseRev(main.quote_number).rev;
    const dupCount = sortedArr.filter((r) => parseRev(r.quote_number).rev === maxRev).length - 1;
    out.push({ main, older: sortedArr.slice(1), dupCount });
  }
  return out;
}
