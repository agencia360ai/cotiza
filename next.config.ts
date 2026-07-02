import type { NextConfig } from "next";

// Punto E: rutas limpias. Redirige los links viejos /maintenance/* a las nuevas
// (bookmarks / links compartidos del equipo siguen funcionando).
const nextConfig: NextConfig = {
  // Fotos del cotizador (base64) en server actions.
  experimental: {
    serverActions: { bodySizeLimit: "8mb" },
  },
  // El renderer del PDF (pdf-lib) lee el membrete del filesystem en runtime;
  // hay que incluirlo explícitamente en el bundle serverless de esas rutas.
  outputFileTracingIncludes: {
    "/potenciales": ["./public/dicec-membrete.png"],
    "/q/[token]": ["./public/dicec-membrete.png"],
  },
  async redirects() {
    return [
      { source: "/maintenance/potenciales/:path*", destination: "/potenciales/:path*", permanent: true },
      { source: "/maintenance/projects/:path*", destination: "/proyectos/:path*", permanent: true },
      { source: "/maintenance/mantenimiento/:path*", destination: "/mantenimiento/:path*", permanent: true },
      { source: "/maintenance/reports/:path*", destination: "/reportes/:path*", permanent: true },
      { source: "/maintenance/schedule/:path*", destination: "/cronograma/:path*", permanent: true },
      { source: "/maintenance/clients/:path*", destination: "/clientes/:path*", permanent: true },
      { source: "/maintenance/technicians/:path*", destination: "/personal/:path*", permanent: true },
      { source: "/maintenance", destination: "/inicio", permanent: true },
    ];
  },
};

export default nextConfig;
