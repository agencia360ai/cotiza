/* eslint-disable @typescript-eslint/no-require-imports -- es un preload CommonJS:
   corre antes de que exista cualquier loader ESM, y `require` es la única forma
   de cargarlo. La regla protege al código de la app, no a este archivo. */
// tsx compila los .ts de src/ como CommonJS (el package.json raíz no declara
// "type": "module"), así que `import "server-only"` termina siendo un require —
// y los hooks ESM de hooks.mjs no lo ven. Para CJS el punto de intercepción es
// _resolveFilename. Solo se toca ese specifier; todo lo demás resuelve igual.
const Module = require("node:module");
const path = require("node:path");
const stub = path.join(__dirname, "server-only-stub.cjs");
const original = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return stub;
  return original.call(this, request, ...rest);
};
