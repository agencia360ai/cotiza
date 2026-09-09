// `server-only` es un centinela de Next: importado fuera del servidor de React
// tira error a propósito, y desde Node a secas ni siquiera se resuelve. Los
// módulos que lo importan (pdf.ts, refinar.ts) son justamente los que vale la
// pena probar, así que acá se reemplaza por un módulo vacío. Nada más cambia:
// react, lucide y el resto se resuelven como siempre.
export async function resolve(specifier, context, next) {
  if (specifier === "server-only") {
    return { url: "data:text/javascript,export {}", shortCircuit: true };
  }
  return next(specifier, context);
}
