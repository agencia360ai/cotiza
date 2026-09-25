// Qué partes de la plataforma puede ver cada miembro.
//
// Dos ejes que NO se mezclan:
//   - el ROL (owner/admin/engineer/viewer) dice qué puede HACER;
//   - las SECCIONES dicen qué puede VER.
// "Solo licitaciones" no es un rol: es una persona que puede editar (o solo
// mirar) dentro de un área. Mezclar las dos cosas obliga a inventar un rol por
// cada combinación, y a los tres meses nadie sabe qué significa cada uno.
//
// Este archivo es la ÚNICA fuente de verdad del lado de la app. El lado de la
// base (cotiza.puede_ver y las políticas) usa los mismos nombres de sección —
// si se agrega una acá, hay que agregarla allá (migración 0050).

export const SECCIONES = {
  inicio: {
    label: "Inicio",
    ayuda: "Resumen del negocio — incluye montos de proyectos y cotizaciones",
    rutas: ["/inicio"],
  },
  proyectos: {
    label: "Proyectos",
    ayuda: "Facturado, cobrado, gasto y margen de cada proyecto",
    rutas: ["/proyectos", "/projects", "/dashboard"],
  },
  mantenimiento: {
    label: "Mantenimiento",
    ayuda: "Programación, reportes y cronograma",
    rutas: ["/mantenimiento", "/reportes", "/cronograma"],
  },
  leads: {
    label: "Leads",
    ayuda: "Oportunidades antes de cotizar",
    rutas: ["/leads"],
  },
  cotizaciones: {
    label: "Cotizaciones",
    ayuda: "Cotizaciones, precios y cartas",
    rutas: ["/potenciales", "/quotes", "/catalog", "/carta"],
  },
  licitaciones: {
    label: "Licitaciones",
    ayuda: "PanamaCompra y licitaciones participadas",
    rutas: ["/licitaciones"],
  },
  clientes: {
    label: "Clientes",
    ayuda: "Clientes, sucursales y equipos",
    rutas: ["/clientes"],
  },
  personal: {
    label: "Personal",
    ayuda: "Técnicos y asistencia",
    rutas: ["/personal"],
  },
} as const;

export type Seccion = keyof typeof SECCIONES;

// El orden en que se muestran y en que se elige "la primera a la que puede
// entrar" al redirigir. Inicio primero: es la portada para quien la tiene.
export const ORDEN_SECCIONES: Seccion[] = [
  "inicio",
  "proyectos",
  "mantenimiento",
  "leads",
  "cotizaciones",
  "licitaciones",
  "clientes",
  "personal",
];

export function esSeccion(v: unknown): v is Seccion {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(SECCIONES, v);
}

/**
 * Perfiles: combinaciones con nombre, para no tildar casillas cada vez.
 *
 * Son solo atajos — lo que se guarda son las secciones. Si mañana alguien
 * necesita "Comercial pero sin Leads", se destilda una casilla y queda como
 * Personalizado, sin inventar un perfil nuevo.
 */
export const PERFILES: { id: string; label: string; ayuda: string; secciones: Seccion[] | null }[] = [
  { id: "todo", label: "Acceso completo", ayuda: "Ve toda la plataforma", secciones: null },
  {
    id: "comercial",
    label: "Comercial",
    ayuda: "Leads, cotizaciones, licitaciones y clientes",
    secciones: ["leads", "cotizaciones", "licitaciones", "clientes"],
  },
  {
    id: "operacion",
    label: "Operación",
    ayuda: "Proyectos, mantenimiento, personal y clientes",
    secciones: ["proyectos", "mantenimiento", "personal", "clientes"],
  },
  { id: "licitaciones", label: "Solo licitaciones", ayuda: "Únicamente licitaciones", secciones: ["licitaciones"] },
];

/** Roles que ven todo siempre, tengan lo que tengan guardado. */
export const ROLES_SIN_RESTRICCION = ["owner", "admin"] as const;

export function rolSinRestriccion(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Normaliza lo que viene de la base.
 *
 * null = todas. Un array vacío NO es "todas": sería un miembro que no ve nada,
 * y eso no es un estado útil — se trata como null para no dejar a nadie
 * encerrado afuera por un guardado a medias. Valores desconocidos se descartan.
 */
export function normalizarSecciones(v: unknown): Seccion[] | null {
  if (!Array.isArray(v)) return null;
  const limpias = [...new Set(v.filter(esSeccion))];
  return limpias.length > 0 ? ORDEN_SECCIONES.filter((s) => limpias.includes(s)) : null;
}

/** Las secciones que de verdad ve este miembro. */
export function seccionesVisibles(role: string | null | undefined, secciones: unknown): Seccion[] {
  if (rolSinRestriccion(role)) return [...ORDEN_SECCIONES];
  return normalizarSecciones(secciones) ?? [...ORDEN_SECCIONES];
}

export function puedeVer(role: string | null | undefined, secciones: unknown, seccion: Seccion): boolean {
  return seccionesVisibles(role, secciones).includes(seccion);
}

/**
 * Configuración (datos de la org, miembros) no es una sección más: es para
 * quien no tiene restricciones. A alguien de "solo licitaciones" no le toca ver
 * la lista del equipo con sus correos.
 */
export function verConfiguracion(role: string | null | undefined, secciones: unknown): boolean {
  return rolSinRestriccion(role) || normalizarSecciones(secciones) === null;
}

/** A qué sección pertenece una ruta. null = ruta que no es de ninguna (settings, etc.). */
export function seccionDeRuta(pathname: string): Seccion | null {
  for (const s of ORDEN_SECCIONES) {
    for (const r of SECCIONES[s].rutas) {
      if (pathname === r || pathname.startsWith(`${r}/`)) return s;
    }
  }
  return null;
}

/** Adónde mandar a alguien que entra a una sección que no le toca. */
export function primeraRuta(role: string | null | undefined, secciones: unknown): string {
  const [s] = seccionesVisibles(role, secciones);
  return SECCIONES[s ?? "inicio"].rutas[0];
}

/** Qué perfil corresponde a un conjunto de secciones; "personalizado" si ninguno. */
export function perfilDe(secciones: unknown): string {
  const n = normalizarSecciones(secciones);
  if (n === null) return "todo";
  const clave = n.join(",");
  const p = PERFILES.find((x) => x.secciones !== null && [...x.secciones].sort().join(",") === [...n].sort().join(","));
  return p ? p.id : clave ? "personalizado" : "todo";
}

/** El acceso de un miembro en pocas palabras, para la lista de Miembros. */
export function resumenAcceso(role: string | null | undefined, secciones: unknown): string {
  if (rolSinRestriccion(role)) return "Ve todo (por rol)";
  const n = normalizarSecciones(secciones);
  if (n === null) return "Acceso completo";
  const perfil = PERFILES.find((p) => p.id === perfilDe(n));
  return perfil ? perfil.label : n.map((s) => SECCIONES[s].label).join(", ");
}
