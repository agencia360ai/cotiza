"use client";

import { Printer, ArrowLeft } from "lucide-react";
import Link from "next/link";

export function CartaControls() {
  return (
    <div className="no-print mx-auto mb-4 flex max-w-[8.5in] items-center justify-between">
      <Link
        href="/potenciales"
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
      >
        <ArrowLeft className="size-4" /> Cotizaciones
      </Link>
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
      >
        <Printer className="size-4" />
        Imprimir / PDF
      </button>
    </div>
  );
}
