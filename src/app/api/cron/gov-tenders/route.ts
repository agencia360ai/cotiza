import { NextResponse } from "next/server";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase/admin";
import { syncGovTenders, type Db } from "@/lib/panamacompra/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Cron diario de Vercel: refresca las licitaciones del gobierno para cada org
// que ya activó la feature (tiene filas en gov_tenders). Protegido con
// CRON_SECRET (Vercel manda Authorization: Bearer <CRON_SECRET>).
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasAdminCredentials()) return NextResponse.json({ error: "sin service role" }, { status: 500 });

  const admin = createAdminClient() as unknown as Db;
  const { data: orgs } = (await admin.from("gov_tenders").select("org_id")) as { data: { org_id: string }[] | null };
  const orgIds = Array.from(new Set((orgs ?? []).map((r) => r.org_id)));

  // full=true: escaneo completo diario. El corte incremental asume que lo nuevo
  // sale primero en PanamaCompra; el escaneo completo garantiza cobertura aunque
  // ese orden no se cumpla (el interactivo "Actualizar" sigue siendo incremental).
  const results: Record<string, unknown> = {};
  for (const orgId of orgIds) {
    const r = await syncGovTenders(admin, orgId, { full: true });
    results[orgId] = "error" in r ? { error: r.error } : r.data;
  }
  return NextResponse.json({ ok: true, orgs: orgIds.length, results });
}
