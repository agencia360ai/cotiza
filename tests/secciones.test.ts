import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ORDEN_SECCIONES,
  SECCIONES,
  normalizarSecciones,
  perfilDe,
  primeraRuta,
  puedeVer,
  resumenAcceso,
  seccionDeRuta,
  seccionesVisibles,
  verConfiguracion,
} from "../src/lib/secciones";

test("owner y admin ven todo, tengan lo que tengan guardado", () => {
  assert.deepEqual(seccionesVisibles("owner", ["licitaciones"]), ORDEN_SECCIONES);
  assert.deepEqual(seccionesVisibles("admin", ["licitaciones"]), ORDEN_SECCIONES);
  assert.equal(puedeVer("admin", ["licitaciones"], "proyectos"), true);
});

test("null = todas: nadie pierde acceso cuando se despliega esto", () => {
  assert.deepEqual(seccionesVisibles("engineer", null), ORDEN_SECCIONES);
  assert.deepEqual(seccionesVisibles("viewer", undefined), ORDEN_SECCIONES);
});

test("engineer/viewer restringidos ven SOLO lo suyo", () => {
  assert.deepEqual(seccionesVisibles("engineer", ["licitaciones"]), ["licitaciones"]);
  assert.equal(puedeVer("viewer", ["licitaciones"], "licitaciones"), true);
  assert.equal(puedeVer("viewer", ["licitaciones"], "proyectos"), false);
  assert.equal(puedeVer("viewer", ["licitaciones"], "inicio"), false);
});

test("un array vacío no deja a nadie encerrado afuera: vale como todas", () => {
  assert.equal(normalizarSecciones([]), null);
  assert.deepEqual(seccionesVisibles("engineer", []), ORDEN_SECCIONES);
});

test("valores desconocidos o repetidos se descartan, y el orden es el del menú", () => {
  assert.deepEqual(normalizarSecciones(["clientes", "basura", "leads", "clientes", 42]), ["leads", "clientes"]);
  assert.equal(normalizarSecciones("licitaciones"), null, "un string suelto no es una lista");
});

test("seccionDeRuta: rutas propias, subrutas y alias", () => {
  assert.equal(seccionDeRuta("/proyectos"), "proyectos");
  assert.equal(seccionDeRuta("/proyectos/abc"), "proyectos");
  assert.equal(seccionDeRuta("/projects/123/edit"), "proyectos");
  assert.equal(seccionDeRuta("/potenciales"), "cotizaciones");
  assert.equal(seccionDeRuta("/carta/uuid"), "cotizaciones");
  assert.equal(seccionDeRuta("/reportes/9"), "mantenimiento");
  assert.equal(seccionDeRuta("/settings"), null);
  assert.equal(seccionDeRuta("/proyectosfalsos"), null, "un prefijo que no es la ruta no cuenta");
});

test("primeraRuta: adónde va quien entra a algo que no le toca", () => {
  assert.equal(primeraRuta("engineer", ["licitaciones"]), "/licitaciones");
  assert.equal(primeraRuta("engineer", ["clientes", "leads"]), "/leads", "el orden del menú, no el guardado");
  assert.equal(primeraRuta("admin", ["licitaciones"]), "/inicio");
});

test("perfilDe reconoce los presets sin importar el orden, y el resto es personalizado", () => {
  assert.equal(perfilDe(null), "todo");
  assert.equal(perfilDe(["licitaciones"]), "licitaciones");
  assert.equal(perfilDe(["clientes", "licitaciones", "cotizaciones", "leads"]), "comercial");
  assert.equal(perfilDe(["proyectos", "mantenimiento", "personal", "clientes"]), "operacion");
  assert.equal(perfilDe(["licitaciones", "clientes"]), "personalizado");
});

test("resumenAcceso: el rol manda, después el perfil, y si no hay perfil la lista", () => {
  assert.equal(resumenAcceso("admin", ["licitaciones"]), "Ve todo (por rol)");
  assert.equal(resumenAcceso("engineer", null), "Acceso completo");
  assert.equal(resumenAcceso("viewer", ["licitaciones"]), "Solo licitaciones");
  assert.equal(resumenAcceso("engineer", ["clientes", "leads"]), "Leads, Clientes");
});

test("verConfiguracion: owner/admin y quien no tiene restricciones; el restringido no", () => {
  assert.equal(verConfiguracion("admin", ["licitaciones"]), true);
  assert.equal(verConfiguracion("engineer", null), true);
  assert.equal(verConfiguracion("engineer", ["licitaciones"]), false);
});

// Cada carpeta de ruta tiene su guardia, y el guardia dice la MISMA sección que
// el mapa de rutas. Sin esto, una página nueva nace sin guardia (y nadie se
// entera) o con el guardia de otra sección.
const APP = join(process.cwd(), "src/app/(app)");

function guardiaDe(dir: string): string | null {
  const layout = join(dir, "layout.tsx");
  if (!existsSync(layout)) return null;
  return readFileSync(layout, "utf8").match(/exigirSeccion\("(\w+)"\)/)?.[1] ?? null;
}

test("cada carpeta de (app) tiene el guardia de su sección", () => {
  const carpetas = readdirSync(APP, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "settings")
    .map((d) => d.name);
  assert.ok(carpetas.length > 10, "se leyeron las carpetas de rutas");
  for (const c of carpetas) {
    const esperada = seccionDeRuta(`/${c}`);
    assert.ok(esperada, `/${c} no está en ninguna sección de src/lib/secciones.ts`);
    assert.equal(guardiaDe(join(APP, c)), esperada, `src/app/(app)/${c}/layout.tsx`);
  }
  assert.equal(guardiaDe(join(process.cwd(), "src/app/carta")), "cotizaciones", "src/app/carta/layout.tsx");
  assert.match(readFileSync(join(APP, "settings/layout.tsx"), "utf8"), /exigirConfiguracion\(\)/);
});

test("cada ruta del mapa existe de verdad (un typo acá deja una sección sin guardia)", () => {
  for (const s of ORDEN_SECCIONES) {
    for (const r of SECCIONES[s].rutas) {
      const dentro = existsSync(join(APP, r));
      const afuera = existsSync(join(process.cwd(), "src/app", r));
      assert.ok(dentro || afuera, `${s}: ${r}`);
    }
  }
});
