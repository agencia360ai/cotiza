"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, signUp } from "./actions";

type Mode = "signin" | "signup";

export function LoginForm() {
  const [mode, setMode] = useState<Mode>("signin");
  const action = mode === "signin" ? signIn : signUp;
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder={mode === "signup" ? "tu-nombre@dicecpanama.com" : undefined}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Contraseña</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
        />
      </div>

      {state && "error" in state && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}
      {state && "success" in state && (
        <p className="text-sm text-muted-foreground">{state.success}</p>
      )}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Procesando..." : mode === "signin" ? "Iniciar sesión" : "Crear cuenta"}
      </Button>

      <button
        type="button"
        onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        {mode === "signin" ? "¿Primera vez? Crear cuenta con tu correo @dicecpanama.com" : "¿Ya tienes cuenta? Iniciar sesión"}
      </button>

      {mode === "signup" ? (
        <p className="text-center text-xs text-muted-foreground">
          Solo correos <span className="font-medium">@dicecpanama.com</span> — te llega un email para confirmar la
          cuenta y entras directo al panel de DICEC. Externos: por invitación.
        </p>
      ) : null}
    </form>
  );
}
