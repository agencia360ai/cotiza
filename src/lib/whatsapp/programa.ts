// Parser del mensaje de PROGRAMACIÓN del día que el supervisor reenvía al bot.
//
// Formato real que usa DICEC:
//
//   Buenos días equipo, espero se encuentren bien.
//   Programación de hoy jueves 30 de julio:
//
//   Cirion – Colón: @50761111111 @50762222222 @50763333333
//   → DM25-16 Cirion Technologies Mantenimiento — Mantenimiento preventivo
//
//   EFR – San Francisco: @50764444444 @50765555555
//   → DM26-08 Mantenimiento EFR San Francisco — Mantenimiento preventivo
//
//   Apoyo con transporte: @50766666666
//
// Al reenviarse por la API, las menciones llegan como NÚMEROS (no como el
// nombre que muestra la app), y esos números se cruzan contra el wa_id del
// personal. Una sección sin línea "→" no tiene proyecto: se usa su etiqueta
// (y "transporte" se normaliza a la labor "Transporte").

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
  return linea.replace(RE_MENCION, "").replace(/[:\-–—]+\s*$/, "").trim();
}

export function parsePrograma(texto: string): ProgramaParseado {
  const lineas = texto.split(/\r?\n/);
  type Seccion = { etiqueta: string; waIds: string[]; projectNo: string | null };
  const secciones: Seccion[] = [];
  let actual: Seccion | null = null;

  for (const linea of lineas) {
    const menciones = mencionesDe(linea);

    if (menciones.length > 0) {
      const etiqueta = etiquetaDe(linea);
      // Menciones sueltas debajo de una sección (se desbordó de línea) se suman
      // a la sección abierta en vez de abrir una nueva sin nombre.
      if (!etiqueta && actual) {
        actual.waIds.push(...menciones);
        continue;
      }
      actual = { etiqueta, waIds: menciones, projectNo: null };
      secciones.push(actual);
      continue;
    }

    const mProy = linea.match(RE_LINEA_PROYECTO);
    if (mProy && actual && !actual.projectNo) {
      const m = mProy[1].match(RE_PROYECTO);
      actual.projectNo = m ? m[1].replace(/\s+/g, "").toUpperCase() : mProy[1].trim().slice(0, 60);
      continue;
    }

    // Línea en blanco: cierra la sección (lo que venga después es otra cosa).
    if (!linea.trim()) actual = null;
  }

  const asignaciones: AsignacionPrograma[] = [];
  for (const s of secciones) {
    const proyecto = s.projectNo ?? (s.etiqueta ? laborDeEtiqueta(s.etiqueta) : null);
    for (const waId of s.waIds) {
      asignaciones.push({ waId, siteLabel: s.etiqueta, projectNo: proyecto });
    }
  }

  return {
    asignaciones,
    secciones: secciones.length,
    sinMenciones: secciones.length === 0,
  };
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
