"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { createProject } from "../actions";

export function NewProjectForm() {
  const [state, formAction, pending] = useActionState(createProject, null);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Nombre del proyecto</Label>
        <Input id="name" name="name" required autoFocus placeholder="Ej: Oficinas Avenida Balboa" />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="client_name">Cliente (opcional)</Label>
        <Input id="client_name" name="client_name" placeholder="Razón social o nombre" />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="scope">Alcance</Label>
        <NativeSelect id="scope" name="scope" defaultValue="simple" required>
          <option value="simple">Simple — residencial / oficina chica</option>
          <option value="complex">Complejo — edificio / industrial</option>
        </NativeSelect>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="description">Descripción (opcional)</Label>
        <Textarea
          id="description"
          name="description"
          rows={3}
          placeholder="Cualquier contexto que ayude: ubicación, requerimientos especiales..."
        />
      </div>

      {state && "error" in state && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Creando..." : "Crear proyecto"}
        </Button>
        <Button type="button" variant="ghost" asChild>
          <Link href="/dashboard">Cancelar</Link>
        </Button>
      </div>
    </form>
  );
}
