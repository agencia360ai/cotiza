import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppSidebar } from "@/components/app-sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: memberships } = await supabase
    .from("org_members")
    .select("org_id, organizations(id, name)")
    .eq("user_id", user.id)
    .limit(1);

  const membership = memberships?.[0];
  const org = membership?.organizations as { id: string; name: string } | null | undefined;
  if (!org) redirect("/onboarding");

  return (
    <div className="min-h-screen flex">
      <AppSidebar org={{ name: org.name }} user={{ email: user.email ?? null }} />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
