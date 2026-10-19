import type { LetterData } from "../../src/lib/quotes/letter";

// La cotización de NAZ Beauty Shop (DC 26-211) tal como vino del diseño: el
// caso de referencia del formato Propuesta.
export const NAZ: { quoteNumber: string; cliente: string; letter: LetterData } = {
  quoteNumber: "COT DC 26-211",
  cliente: "NAZ & Co., S.A.",
  letter: {
    fecha: "2026-10-16",
    ubicacion: "PH Ocean Mall, Local 7",
    tipo: "realizar",
    formato: "propuesta",
    items: [
      { cant: 1, titulo: "Unidad autocontenida 15 TR", desc: "LG 15 TR, R-410A, 208V/3F · estructura metálica, izaje, montaje y drenaje", precio: 13995 },
      { cant: 1, titulo: "Splits 3 × 12,000 BTU", desc: "EV-1, 2 y 3 inverter · condensadoras en estructura, cobre aislado y drenajes", precio: 3303 },
      { cant: 1, titulo: "Ducto de suministro y difusores", desc: "28×24 galv. aislado exterior · spiro 28\" y 16\" nuevos · 14 difusores Ø14\"", precio: 4775 },
      { cant: 1, titulo: "Ducto de retorno", desc: "28×24 galv. aislado, pintado e impermeabilizado · 4 rejillas 24×24", precio: 1809 },
      { cant: 1, titulo: "Extracción de baños", desc: "3 extractores Greenheck 75 CFM · PVC 3\" · wall caps con malla", precio: 1256 },
      { cant: 1, titulo: "Conexiones eléctricas", desc: "Desde tablero existente: UE-1 208V/3F, 3 splits y 3 extractores", precio: 1921 },
      { cant: 1, titulo: "Controles, arranque y balance", desc: "Termostato 2 etapas, detector de humo, prueba y balance con informe TAB", precio: 1441 },
    ],
    aplica_itbms: true,
    tasa: 7,
    validez: 30,
    condiciones: null,
    elaborado: "Ventas DICEC",
    propuesta: {
      etiqueta: "PROPUESTA TÉCNICA Y ECONÓMICA",
      titulo: "NAZ Beauty Shop",
      subtitulo: "Climatización y extracción de baños · Costa del Este",
      datos: [
        { label: "Cliente", valor: "NAZ & Co., S.A." },
        { label: "Ubicación", valor: "PH Ocean Mall, Local 7" },
        { label: "Base de diseño", valor: "Planos AA · FLT Estudio" },
      ],
      cifras: [
        { valor: "18 TR", texto: "Autocontenida 15 TR + 3 splits de 1 TR" },
        { valor: "6,000 CFM", texto: "Suministro · 300 CFM de aire fresco" },
        { valor: "14 + 4", texto: "Difusores Ø14\" nuevos + rejillas de retorno" },
        { valor: "3", texto: "Extractores de baño, 75 CFM c/u" },
      ],
      inversion: "Inversión · llave en mano",
      plazo: { label: "Instalación", valor: "12 días hábiles", detalle: "Equipos en sitio: 3–4 semanas" },
      partidas_titulo: "Partida · suministro e instalación",
      condiciones: [
        { label: "Vigencia", texto: "30 días." },
        { label: "Pago", texto: "50% con la orden de compra · 40% con equipos en sitio · 10% contra entrega." },
        { label: "Entrega", texto: "Equipos 3–4 semanas desde el anticipo · instalación 12 días hábiles." },
        { label: "Garantía", texto: "12 meses (equipos según fabricante)." },
        { label: "No incluye", texto: "Obra civil, cielo raso, pintura, tablero eléctrico, permisos y trabajo nocturno si la plaza lo exige." },
      ],
      contacto: "Ventas DICEC · info@dicecpanama.com · (507) 236-2966",
      plano: {
        titulo: "Plano de aire acondicionado",
        fuente: "Planos AA · FLT Estudio · oct 2026",
        imagenes: [
          { path: "naz/plano.png", mime: "image/png", nota: null },
          { path: "naz/tabla.png", mime: "image/png", nota: "Capacidades de equipos según plano" },
        ],
      },
    },
  },
};
