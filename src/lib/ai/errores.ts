// Los errores de la API de Anthropic llegan como `400 {"type":"error",...}`:
// en inglés, en JSON y sin decir qué hacer. Así se mostraban en pantalla.
// Acá se dicen en castellano y con el paso siguiente. null = no hay nada mejor
// que decir que el mensaje original.

export const SIN_SALDO =
  "Se acabó el saldo de la cuenta de Anthropic que usa la plataforma para la IA. Hasta que se carguen créditos (console.anthropic.com → Billing), ninguna función con IA va a responder — no es un problema de lo que subiste.";

type Cuerpo = { error?: { type?: unknown; message?: unknown } } | null | undefined;

export function mensajeDeIA(status: number | undefined, cuerpo: unknown): string | null {
  const detalle = (cuerpo as Cuerpo)?.error;
  const tipo = typeof detalle?.type === "string" ? detalle.type : "";
  const texto = typeof detalle?.message === "string" ? detalle.message : "";

  // Por el texto antes que por el status: el saldo agotado y el tope de gasto
  // llegan como 400 (o 429), igual que errores que no tienen nada que ver.
  if (/credit balance/i.test(texto)) return SIN_SALDO;
  if (/usage limit/i.test(texto)) {
    return "Se llegó al tope de gasto configurado en la cuenta de Anthropic. Se sube en console.anthropic.com → Limits.";
  }
  if (status === 413 || /prompt is too long|too large|image exceeds|PDF pages/i.test(texto)) {
    return "El archivo es demasiado grande para la IA — probá con uno más liviano o con menos páginas.";
  }
  if (status === 401) return "La clave de Anthropic (ANTHROPIC_API_KEY en Vercel) es inválida o fue revocada.";
  if (status === 403) return "La clave de Anthropic no tiene permiso para esto — revisá el workspace en console.anthropic.com.";
  if (status === 404) return "El modelo de IA configurado no está disponible para esta cuenta de Anthropic.";
  if (status === 429) return "La IA recibió demasiadas consultas a la vez — probá de nuevo en un minuto.";
  if (tipo === "overloaded_error" || (status ?? 0) >= 500) {
    return "La IA de Anthropic está saturada o con problemas en este momento — probá de nuevo en unos minutos.";
  }
  return texto ? `La IA rechazó la consulta: ${texto}` : null;
}
