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

  // Deadline GLOBAL de la función (no por org): con varias orgs, cada sync usa
  // lo que quede del presupuesto — si cada una tuviera 235s propios, la segunda
  // ya correría más allá de los 300s y Vercel mataría la función a mitad.
  const deadlineTs = Date.now() + 265_000;

  const admin = createAdminClient() as unknown as Db;
  // Orgs con la feature activa. PAGINADO: select plano sobre gov_tenders corta
  // en 1000 filas y con miles de procesos podía dejar orgs fuera del nightly.
  const orgSet = new Set<string>();
  for (let from = 0; from < 100_000; from += 1000) {
    const { data: page } = (await admin
      .from("gov_tenders")
      .select("org_id")
      .order("org_id")
      .range(from, from + 999)) as { data: { org_id: string }[] | null };
    for (const r of page ?? []) orgSet.add(r.org_id);
    if ((page?.length ?? 0) < 1000) break;
  }
  const orgIds = Array.from(orgSet);

  // full=true: escaneo completo diario. El corte incremental asume que lo nuevo
  // sale primero en PanamaCompra; el escaneo completo garantiza cobertura aunque
  // ese orden no se cumpla (el interactivo "Actualizar" sigue siendo incremental).
  const results: Record<string, unknown> = {};
  for (const orgId of orgIds) {
    // Loops por org con cursores reanudables: repite el escaneo completo hasta
    // agotar todas las páginas (truncados vacío) o quedarse sin tiempo. Así el
    // nightly cubre TODO en una corrida cuando alcanza — sin dejar "más páginas".
    let last: unknown = { skipped: "sin tiempo — corre en el próximo cron" };
    let pasadas = 0;
    while (Date.now() < deadlineTs && pasadas < 12) {
      const r = await syncGovTenders(admin, orgId, { full: true, deadlineTs });
      pasadas++;
      if ("error" in r) { last = { error: r.error }; break; }
      last = { ...r.data, pasadas };
      if (r.data.truncados.length === 0) break; // ciclo completo
    }
    results[orgId] = last;
  }
  return NextResponse.json({ ok: true, orgs: orgIds.length, results });
}
