export default function LoadingOverview() {
  return (
    <div role="status" className="min-h-screen bg-[#f4f6fa] p-5 sm:p-8">
      <span className="sr-only">Cargando resumen del negocio</span>
      <div aria-hidden="true" className="space-y-6 motion-safe:animate-pulse">
        <div className="h-8 w-64 rounded-lg bg-slate-200" />
        <div className="h-4 w-48 rounded bg-slate-200" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-44 rounded-2xl bg-white" />
          ))}
        </div>
        <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
          <div className="h-80 rounded-2xl bg-white" />
          <div className="h-80 rounded-2xl bg-white" />
        </div>
        <div className="h-80 rounded-2xl bg-white" />
      </div>
    </div>
  );
}
