"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { Building2, Upload, Trash2, Loader2, Save, ImageIcon } from "lucide-react";
import { imageUrl } from "@/lib/maintenance/types";
import { updateOrgName, uploadOrgLogo, removeOrgLogo } from "./actions";

type Org = {
  id: string;
  name: string;
  slug: string;
  logo_path: string | null;
  created_at: string;
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function OrgSettingsForm({
  org,
  userEmail,
  userRole,
}: {
  org: Org;
  userEmail: string;
  userRole: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(org.name);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [isSaving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const dirty = name.trim() !== org.name;

  function saveName() {
    if (!dirty) return;
    setError(null);
    startSaving(async () => {
      const r = await updateOrgName(name);
      if ("error" in r) setError(r.error);
      else {
        setSavedAt(new Date());
        router.refresh();
      }
    });
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    const r = await uploadOrgLogo(fd);
    setUploading(false);
    if ("error" in r) setError(r.error);
    else router.refresh();
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleLogoRemove() {
    if (!confirm("¿Quitar el logo? Volverá a las iniciales por defecto.")) return;
    setError(null);
    const r = await removeOrgLogo();
    if ("error" in r) setError(r.error);
    else router.refresh();
  }

  return (
    <section className="rounded-2xl border border-border bg-card">
      <header className="border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <Building2 className="size-4 text-slate-700" />
          <h2 className="text-base font-semibold">Identidad de tu organización</h2>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Lo que aparece en el portal público que ven tus clientes (
          <span className="font-mono">{userEmail}</span> · rol: {userRole})
        </p>
      </header>

      <div className="p-5">
        <div className="mb-6 flex flex-wrap items-start gap-5">
          <div className="flex flex-col items-center gap-2">
            <div className="group relative">
              {org.logo_path ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageUrl(org.logo_path)}
                  alt={org.name}
                  className="size-24 rounded-2xl object-cover ring-1 ring-slate-200"
                />
              ) : (
                <div className="flex size-24 items-center justify-center rounded-2xl bg-slate-900 text-2xl font-bold text-white">
                  {initials(name)}
                </div>
              )}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/0 text-white opacity-0 transition-all hover:bg-black/40 hover:opacity-100 disabled:opacity-30"
              >
                {uploading ? <Loader2 className="size-6 animate-spin" /> : <Upload className="size-6" />}
              </button>
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleLogoUpload} />
            <div className="text-center">
              {org.logo_path ? (
                <button
                  type="button"
                  onClick={handleLogoRemove}
                  className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-red-600"
                >
                  <Trash2 className="size-3" />
                  Quitar logo
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                >
                  <ImageIcon className="size-3" />
                  Subir logo
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 min-w-[250px]">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Nombre de la organización
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
                placeholder="DICEC, INC"
              />
              <p className="mt-1 text-xs text-slate-500">
                Aparece como &ldquo;Servicio prestado por{" "}
                <strong className="text-slate-700">{name || "tu organización"}</strong>&rdquo; en el portal del cliente.
              </p>
            </div>

            <div className="mt-4">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Slug de la org
              </label>
              <p className="mt-1 font-mono text-sm text-slate-600">{org.slug}</p>
              <p className="mt-1 text-xs text-slate-500">No editable por ahora</p>
            </div>
          </div>
        </div>

        {error ? <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
          {savedAt ? <span className="text-xs text-emerald-600">Guardado</span> : null}
          <button
            type="button"
            onClick={saveName}
            disabled={!dirty || isSaving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Guardando…
              </>
            ) : (
              <>
                <Save className="size-4" />
                Guardar cambios
              </>
            )}
          </button>
        </div>
      </div>
    </section>
  );
}
