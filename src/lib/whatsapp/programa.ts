// Parser del mensaje de PROGRAMACIÓN del día que el supervisor reenvía al bot.
//
// Aguanta los DOS órdenes que usa DICEC. Formato actual — el proyecto ABRE el
// bloque y la gente va al final:
//
//   Programación de mañana viernes 7 de agosto
//
//   →DS26-22
//   Carga de refrigerante a equipos      ← descripción
//   Cirion Amador                        ← LUGAR (la línea pegada a la gente)
//   @50761111111 , @50762222222 .
//
//   Apoyo con transporte @50767777777
//
// Y el formato anterior, donde la gente va primero y la flecha después:
//
//   Cirion – Colón: @50761111111 @50762222222
//   → DM25-16 Cirion Technologies Mantenimiento
//
// Al reenviarse por la API, las menciones llegan como NÚMEROS (no como el
// nombre que muestra la app), y esos números se cruzan contra el wa_id del
// personal. OJO: alguien nombrado sin "@" (p. ej. "…, Humberto.") no viaja como
// mención y por lo tanto no se puede marcar.
//
// Un bloque sin línea "→" usa su etiqueta como labor, y "transporte" se
// normaliza a "Transporte".

export type AsignacionPrograma = {
  waId: string; // número tal cual vino en la mención (solo dígitos)
  siteLabel: string; // "Cirion – Colón"
  projectNo: string | null; // "DM25-16" · "Transporte" · null si no se pudo determinar
};

export type ProgramaParseado = {
  asignaciones: AsignacionPrograma[];
  secciones: number;
  sinMenciones: boolean; // no traía ningún @: no es un mensaje de programación
};

// Correlativo de DICEC dentro de la línea del proyecto.
const RE_PROYECTO = /\b(D[CMSV]\s*-?\s*\d{2}\s*-\s*\d+)/i;
// Menciones: @ seguido de dígitos (pueden venir con +, espacios o guiones).
const RE_MENCION = /@\s*\+?([\d][\d\s-]{6,})/g;
// Línea de proyecto: empieza con flecha (→, ->, ⇒) o con el correlativo pelado.
const RE_LINEA_PROYECTO = /^\s*(?:→|->|⇒|»)\s*(.+)$/;

const soloDigitos = (s: string) => s.replace(/\D/g, "");

function mencionesDe(linea: string): string[] {
  const out: string[] = [];
  for (const m of linea.matchAll(RE_MENCION)) {
    const num = soloDigitos(m[1]);
    if (num.length >= 7) out.push(num);
  }
  return out;
}

// "Apoyo con transporte" y variantes → labor "Transporte" en vez de un proyecto.
function laborDeEtiqueta(etiqueta: string): string {
  return /transport/i.test(etiqueta) ? "Transporte" : etiqueta.trim();
}

// La etiqueta de la sección es lo que va ANTES del primer ':' — pero solo si ese
// ':' está antes de la primera mención (si no, "Programación de hoy jueves 30
// de julio:" se colaría como sección).
function etiquetaDe(linea: string): string {
  const iArroba = linea.indexOf("@");
  const iDosPuntos = linea.indexOf(":");
  if (iDosPuntos > 0 && (iArroba === -1 || iDosPuntos < iArroba)) {
    return linea.slice(0, iDosPuntos).trim();
  }
  // Quitadas las menciones puede no quedar nada útil: en "@X , @Y ." sobran solo
  // los separadores. Si no queda ni una letra ni un dígito, NO hay etiqueta —
  // si no, esa basura pisaría al lugar que venía en la línea de arriba.
  const resto = linea.replace(RE_MENCION, "").replace(/[:\-–—,.;·|]+/g, " ").trim();
  return /[\p{L}\p{N}]/u.test(resto) ? resto : "";
}

export function parsePrograma(texto: string): ProgramaParseado {
  const lineas = texto.split(/\r?\n/);
  type Bloque = { etiqueta: string; waIds: string[]; projectNo: string | null };
  const bloques: Bloque[] = [];
  let actual: Bloque | null = null;
  // Líneas sueltas entre el "→PROYECTO" y las menciones (descripción y lugar).
  // La ÚLTIMA es el lugar: en el formato real va justo encima de la gente.
  let pendiente: string | null = null;

  // Fábrica pura: `actual` se asigna en el sitio de llamada para que TypeScript
  // pueda estrechar el tipo (asignarlo dentro del closure lo volvía `never`).
  const nuevoBloque = (etiqueta: string, projectNo: string | null): Bloque => {
    const b: Bloque = { etiqueta, waIds: [], projectNo };
    bloques.push(b);
    return b;
  };

  for (const linea of lineas) {
    if (!linea.trim()) {
      actual = null; // el bloque se cierra con una línea en blanco
      pendiente = null;
      continue;
    }

    // "→DS26-22" abre bloque y fija el proyecto. Puede venir ANTES de la gente
    // (formato nuevo) o DESPUÉS de ella (formato viejo).
    const mFlecha = linea.match(RE_LINEA_PROYECTO);
    if (mFlecha) {
      const cuerpo = mFlecha[1].trim();
      const mProy = cuerpo.match(RE_PROYECTO);
      const proyecto = mProy ? mProy[1].replace(/\s+/g, "").toUpperCase() : cuerpo.slice(0, 60);
      // Si el bloque abierto ya tiene gente pero no proyecto, la flecha es SUYA
      // (formato viejo: gente y luego la flecha).
      if (actual && actual.waIds.length > 0 && !actual.projectNo) {
        actual.projectNo = proyecto;
      } else {
        actual = nuevoBloque("", proyecto);
        pendiente = null;
      }
      continue;
    }

    const menciones = mencionesDe(linea);
    if (menciones.length > 0) {
      const etiqueta = etiquetaDe(linea);
      // Una etiqueta nueva cuando el bloque ya tiene gente abre otro bloque
      // ("Apoyo con transporte @X" después de una sección).
      let bloque: Bloque;
      if (!actual || (etiqueta && actual.waIds.length > 0)) bloque = nuevoBloque(etiqueta, null);
      else {
        bloque = actual;
        if (etiqueta && !bloque.etiqueta) bloque.etiqueta = etiqueta;
      }
      if (!bloque.etiqueta && pendiente) bloque.etiqueta = pendiente;
      bloque.waIds.push(...menciones);
      actual = bloque;
      pendiente = null;
      continue;
    }

    // Texto suelto: candidato a lugar. Solo cuenta dentro de un bloque abierto,
    // así el encabezado ("Programación de mañana viernes 7…") no se cuela.
    if (actual && actual.waIds.length === 0) pendiente = linea.trim().replace(/[:\-–—]+$/, "").trim();
  }

  const asignaciones: AsignacionPrograma[] = [];
  for (const b of bloques) {
    const proyecto = b.projectNo ?? (b.etiqueta ? laborDeEtiqueta(b.etiqueta) : null);
    for (const waId of b.waIds) {
      asignaciones.push({ waId, siteLabel: b.etiqueta, projectNo: proyecto });
    }
  }

  return { asignaciones, secciones: bloques.length, sinMenciones: asignaciones.length === 0 };
}

// Normaliza para comparar contra los wa_id guardados: WhatsApp puede mandar el
// número con o sin el código de país, así que se comparan los últimos 8 dígitos
// (largo de un móvil panameño) cuando no hay match exacto.
export function mismoNumero(a: string, b: string): boolean {
  const x = soloDigitos(a);
  const y = soloDigitos(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const n = Math.min(8, x.length, y.length);
  return n >= 7 && x.slice(-n) === y.slice(-n);
}
