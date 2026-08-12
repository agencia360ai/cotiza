import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { listOrgMembers, nombreDeMiembro } from "@/lib/org/members";
import type { LeadOwner } from "@/lib/leads/types";
import { LeadsBoard } from "./board";

export const dynamic = "force-dynamic";

// El (app)/layout.tsx ya verifica sesión + organización. El tablero lee sus
// propios leads vía server action (listLeads) para actualizarlos en vivo, pero
// la lista de MIEMBROS se resuelve acá: el email vive en auth.users y leerlo
// necesita el cliente admin, que es server-only.
export default async function LeadsPage() {
  const orgId = await getActiveOrgId();
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();

  const miembros = orgId ? await listOrgMembers(orgId) : [];
  const members: LeadOwner[] = miembros.map((m) => ({ id: m.id, label: nombreDeMiembro(m), email: m.email }));
  // Un lead nuevo arranca a nombre de quien lo crea: es quien acaba de hablar
  // con el cliente. Se puede cambiar en el mismo formulario.
  const currentMemberId = miembros.find((m) => m.user_id === u.user?.id)?.id ?? null;

  return <LeadsBoard members={members} currentMemberId={currentMemberId} />;
}
