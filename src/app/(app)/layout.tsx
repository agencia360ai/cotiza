import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgContext, listMemberships } from "@/lib/org-context";
import { AppSidebar } from "@/components/app-sidebar";
import { getNavCounts } from "@/lib/nav-counts";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const memberships = await listMemberships();
  if (memberships.length === 0) redirect("/onboarding");
  if (memberships.length > 1) {
    const ctx = await getActiveOrgContext();
    if (!ctx) redirect("/select-org");
  }
  const ctx = await getActiveOrgContext();
  if (!ctx) redirect("/onboarding");

  const { data: org } = (await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", ctx.orgId)
    .single()) as { data: { id: string; name: string } | null };
  if (!org) redirect("/onboarding");

  const counts = await getNavCounts(ctx.orgId);

  return (
    <div className="min-h-screen bg-canvas md:flex">
      <AppSidebar
        org={{ name: org.name }}
        user={{ email: user.email ?? null }}
        showOrgSwitcher={memberships.length > 1}
        counts={counts}
      />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
