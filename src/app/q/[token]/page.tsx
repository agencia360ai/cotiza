import { createAdminClient, hasAdminCredentials } from "@/lib/supabase/admin";
import { PortalCotizador } from "./portal";

export const dynamic = "force-dynamic";

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let orgName: string | null = null;
  if (hasAdminCredentials() && token && token.length >= 16) {
    const admin = createAdminClient();
    const { data } = (await admin.from("organizations").select("name").eq("cotizador_token", token).maybeSingle()) as {
      data: { name: string } | null;
    };
    orgName = data?.name ?? null;
  }

  if (!orgName) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Link inválido</h1>
          <p className="mt-2 text-sm text-slate-500">
            Este link del cotizador no existe o fue revocado. Pedile uno nuevo al administrador.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <PortalCotizador token={token} orgName={orgName} />
    </div>
  );
}
