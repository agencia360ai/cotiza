"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { ORDEN_SECCIONES, PERFILES, SECCIONES, perfilDe, type Seccion } from "@/lib/secciones";

type Props = {
  value: Seccion[] | null;
  onChange: (v: Seccion[] | null) => void;
  disabled?: boolean;
  labelledBy?: string;
};

/**
 * Perfiles arriba (atajos), casillas abajo (lo que se guarda). Tocar una
 * casilla de un perfil lo deja como Personalizado, sin inventar un perfil.
 */
export function AccesoPicker({ value, onChange, disabled, labelledBy }: Props) {
  const perfil = perfilDe(value);
  const marcadas = value ?? ORDEN_SECCIONES;

  function alternar(s: Seccion) {
    const quedan = marcadas.includes(s) ? marcadas.filter((x) => x !== s) : [...marcadas, s];
    if (quedan.length === 0) return;
    // Todas tildadas = acceso completo (null): así también ve las secciones que
    // se agreguen más adelante.
    onChange(quedan.length === ORDEN_SECCIONES.length ? null : ORDEN_SECCIONES.filter((x) => quedan.includes(x)));
  }

  return (
    <div role="group" aria-labelledby={labelledBy} aria-disabled={disabled || undefined} className={cn(disabled && "opacity-50")}>
      <div className="flex flex-wrap gap-1.5">
        {PERFILES.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(p.secciones ? [...p.secciones] : null)}
            aria-pressed={perfil === p.id}
            title={p.ayuda}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed",
              perfil === p.id
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white text-slate-700 hover:border-slate-400",
            )}
          >
            {p.label}
          </button>
        ))}
        {perfil === "personalizado" ? (
          <span className="rounded-full border border-dashed border-slate-400 px-2.5 py-1 text-xs font-semibold text-slate-600">
            Personalizado
          </span>
        ) : null}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {ORDEN_SECCIONES.map((s) => {
          const on = marcadas.includes(s);
          const ultima = on && marcadas.length === 1;
          return (
            <button
              key={s}
              type="button"
              role="checkbox"
              aria-checked={on}
              disabled={disabled || ultima}
              onClick={() => alternar(s)}
              title={ultima ? "Tiene que ver al menos una sección" : SECCIONES[s].ayuda}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left text-xs transition-colors disabled:cursor-not-allowed",
                on
                  ? "border-slate-300 bg-white font-semibold text-slate-900"
                  : "border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300",
              )}
            >
              <span
                className={cn(
                  "flex size-3.5 shrink-0 items-center justify-center rounded border",
                  on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white",
                )}
              >
                {on ? <Check className="size-2.5" strokeWidth={3} /> : null}
              </span>
              {SECCIONES[s].label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
