// Registra el hook de resolución para los tests. Va por --import, antes de que
// Node cargue el primer archivo de prueba.
import { register } from "node:module";
register("./hooks.mjs", import.meta.url);
