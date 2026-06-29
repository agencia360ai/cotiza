import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_ORG_COOKIE, listMemberships } from "@/lib/org-context";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const memberships = await listMemberships();
  if (memberships.length === 0) redirect("/onboarding");

  // If user has multiple orgs and hasn't picked yet → selector
  const store = await cookies();
  const cookieOrgId = store.get(ACTIVE_ORG_COOKIE)?.value;
  const hasValidActive = !!cookieOrgId && memberships.some((m) => m.org_id === cookieOrgId);
  if (memberships.length > 1 && !hasValidActive) redirect("/select-org");

  redirect("/inicio");
}
