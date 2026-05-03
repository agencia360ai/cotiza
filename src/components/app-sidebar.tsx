"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, LogOut, Package, Users, Building2, ClipboardCheck, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; section?: string };

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Proyectos", icon: FileText, section: "Cotizaciones" },
  { href: "/catalog", label: "Catálogo", icon: Package, section: "Cotizaciones" },
  { href: "/maintenance/schedule", label: "Cronograma", icon: Calendar, section: "Mantenimiento" },
  { href: "/maintenance/reports", label: "Reportes", icon: ClipboardCheck, section: "Mantenimiento" },
  { href: "/maintenance/clients", label: "Clientes", icon: Building2, section: "Mantenimiento" },
  { href: "/maintenance/technicians", label: "Técnicos", icon: Users, section: "Mantenimiento" },
];

type Props = {
  org: { name: string };
  user: { email: string | null };
};

export function AppSidebar({ org, user }: Props) {
  const pathname = usePathname();

  return (
    <aside className="w-60 shrink-0 border-r border-border bg-card flex flex-col">
      <div className="px-5 py-5 border-b border-border">
        <p className="text-sm font-semibold tracking-tight">Reportme<span className="text-blue-600">.ai</span></p>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">{org.name}</p>
      </div>

      <nav className="flex-1 overflow-y-auto p-3">
        {Array.from(new Set(NAV.map((n) => n.section ?? ""))).map((section) => {
          const items = NAV.filter((n) => (n.section ?? "") === section);
          if (items.length === 0) return null;
          return (
            <div key={section} className="mb-4">
              {section ? (
                <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {section}
                </p>
              ) : null}
              <div className="flex flex-col gap-0.5">
                {items.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                        active
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      )}
                    >
                      <Icon className="size-4" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="p-3 border-t border-border flex flex-col gap-2">
        <p className="text-xs text-muted-foreground truncate px-3">{user.email}</p>
        <form action="/logout" method="post">
          <button
            type="submit"
            className="w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <LogOut className="size-4" />
            Cerrar sesión
          </button>
        </form>
      </div>
    </aside>
  );
}
