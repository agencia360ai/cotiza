// Normalizacion de nombres de cliente para matching y alias.
// Sin acentos, minusculas, solo alfanumerico colapsado. ASCII-only en la fuente.
export function norm(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFD")) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x300 && code <= 0x36f) continue; // marcas diacriticas combinantes
    out += ch;
  }
  return out.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
