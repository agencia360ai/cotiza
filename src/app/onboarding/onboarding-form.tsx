"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createOrganization } from "./actions";

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState(createOrganization, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Nombre de la empresa</Label>
        <Input id="name" name="name" required autoFocus placeholder="Ej: Climatización Panamá" />
      </div>

      {state && "error" in state && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Creando..." : "Crear organización"}
      </Button>
    </form>
  );
}
