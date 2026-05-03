import type { Client } from "@/lib/maintenance/types";
import { imageUrl } from "@/lib/maintenance/types";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function ClientHeader({
  client,
  serviceProvider,
  subtitle,
}: {
  client: Client;
  serviceProvider?: string;
  subtitle?: string;
}) {
  const accent = client.brand_color ?? "#0369A1";
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-7xl px-6 py-6 lg:px-8">
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            {client.logo_path ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl(client.logo_path)}
                alt={client.name}
                className="size-14 rounded-xl object-cover ring-1 ring-slate-200"
              />
            ) : (
              <div
                className="flex size-14 shrink-0 items-center justify-center rounded-xl text-lg font-semibold text-white"
                style={{ backgroundColor: accent }}
              >
                {initials(client.name)}
              </div>
            )}
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                {client.name}
              </h1>
              <p className="mt-0.5 text-sm text-slate-500">
                {subtitle ?? "Reportes de Mantenimiento"}
              </p>
            </div>
          </div>
          {serviceProvider ? (
            <div className="hidden text-right sm:block">
              <p className="text-xs uppercase tracking-wider text-slate-400">Servicio prestado por</p>
              <p className="mt-0.5 text-sm font-semibold text-slate-700">{serviceProvider}</p>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
