import { LeadsBoard } from "./board";

export const dynamic = "force-dynamic";

// El (app)/layout.tsx ya verifica sesión + organización. El tablero lee sus
// propios datos vía server action (listLeads) para poder actualizarlos en vivo.
export default function LeadsPage() {
  return <LeadsBoard />;
}
