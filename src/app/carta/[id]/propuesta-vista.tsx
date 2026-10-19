import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";

export function PropuestaVista({ quoteId, quoteNumber, cliente }: { quoteId: string; quoteNumber: string; cliente: string }) {
  const src = `/carta/${quoteId}/pdf`;
  return (
    <div className="flex min-h-screen flex-col bg-slate-200">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-300 bg-white px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/potenciales"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
            aria-label="Volver a cotizaciones"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{quoteNumber}</p>
            <p className="truncate text-xs text-slate-500">{cliente} · formato Propuesta</p>
          </div>
        </div>
        <a
          href={`${src}?descargar=1`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          <Download className="size-4" /> Descargar PDF
        </a>
      </header>
      <iframe src={src} title={`Cotización ${quoteNumber}`} className="w-full flex-1 border-0" style={{ minHeight: "calc(100vh - 64px)" }} />
    </div>
  );
}
