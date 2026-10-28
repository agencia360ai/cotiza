// Los errores de la API de IA llegan como `400 {"type":"error",...}`: en
// inglés, en JSON y sin decir qué hacer. Así se mostraban en pantalla. Acá se
// dicen en castellano y con el paso siguiente. null = no hay nada mejor que
// decir que el mensaje original.

export type ProveedorIA = "anthropic" | "openrouter";

const CUENTA: Record<ProveedorIA, { nombre: string; clave: string; creditos: string; tope: string }> = {
  anthropic: {
    nombre: "Anthropic",
    clave: "ANTHROPIC_API_KEY",
    creditos: "console.anthropic.com → Billing",
    tope: "console.anthropic.com → Limits",
  },
  openrouter: {
    nombre: "OpenRouter",
    clave: "OPENROUTER_API_KEY",
    creditos: "openrouter.ai/settings/credits",
    tope: "openrouter.ai/settings/keys",
  },
};

export function sinSaldo(proveedor: ProveedorIA = "anthropic") {
  const c = CUENTA[proveedor];
  return `Se acabó el saldo de la cuenta de ${c.nombre} que usa la plataforma para la IA. Hasta que se carguen créditos (${c.creditos}), ninguna función con IA va a responder — no es un problema de lo que subiste.`;
}

type Cuerpo = { error?: { type?: unknown; message?: unknown } } | null | undefined;

export function mensajeDeIA(status: number | undefined, cuerpo: unknown, proveedor: ProveedorIA = "anthropic"): string | null {
  const detalle = (cuerpo as Cuerpo)?.error;
  const tipo = typeof detalle?.type === "string" ? detalle.type : "";
  const texto = typeof detalle?.message === "string" ? detalle.message : "";
  const c = CUENTA[proveedor];

  // Por el texto antes que por el status: el saldo agotado y el tope de gasto
  // llegan como 400 (o 429), igual que errores que no tienen nada que ver.
  // OpenRouter rechaza con "requires more credits" cuando el saldo no cubre el
  // max_tokens pedido, aunque quede algo: para quien lo ve es lo mismo.
  if (status === 402 || tipo === "billing_error" || /credit balance|insufficient credits|more credits/i.test(texto)) {
    return sinSaldo(proveedor);
  }
  if (/usage limit|limit exceeded/i.test(texto)) {
    return `Se llegó al tope de gasto configurado en la cuenta de ${c.nombre}. Se sube en ${c.tope}.`;
  }
  if (status === 413 || /prompt is too long|too large|image exceeds|PDF pages/i.test(texto)) {
    return "El archivo es demasiado grande para la IA — prueba con uno más liviano o con menos páginas.";
  }
  if (status === 401) return `La clave de ${c.nombre} (${c.clave} en Vercel) es inválida o fue revocada.`;
  if (status === 403 && proveedor === "anthropic") {
    return "La clave de Anthropic no tiene permiso para esto — revisa el workspace en console.anthropic.com.";
  }
  if (status === 404) return `El modelo de IA configurado no está disponible en ${c.nombre}.`;
  if (status === 429) return "La IA recibió demasiadas consultas a la vez — prueba de nuevo en un minuto.";
  if (tipo === "overloaded_error" || (status ?? 0) >= 500) {
    return `La IA de ${c.nombre} está saturada o con problemas en este momento — prueba de nuevo en unos minutos.`;
  }
  return texto ? `La IA rechazó la consulta: ${texto}` : null;
}
