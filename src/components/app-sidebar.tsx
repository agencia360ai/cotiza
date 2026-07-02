"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Users, Building2, Home, Menu, X, Settings, Hammer, Wrench, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
  also?: string[];
};

const NAV: NavItem[] = [
  { href: "/inicio", label: "Inicio", icon: Home, exact: true },
  { href: "/potenciales", label: "Cotizaciones", icon: TrendingUp },
  { href: "/proyectos", label: "Proyectos", icon: Hammer },
  {
    href: "/mantenimiento",
    label: "Mantenimiento",
    icon: Wrench,
    also: ["/reportes", "/cronograma"],
  },
  { href: "/clientes", label: "Clientes", icon: Building2 },
  { href: "/personal", label: "Personal", icon: Users },
];

function isNavActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.href;
  if (pathname === item.href || pathname.startsWith(`${item.href}/`)) return true;
  return (item.also ?? []).some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

type Props = {
  org: { name: string };
  user: { email: string | null };
  showOrgSwitcher?: boolean;
};

export function AppSidebar({ org, user, showOrgSwitcher = false }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const navContent = (
    <>
      <div className="px-5 py-5 border-b border-border flex items-center justify-between">
        <div className="min-w-0">
          {showOrgSwitcher ? (
            <Link
              href="/select-org"
              className="group inline-flex items-center gap-1.5"
              title="Cambiar organización"
            >
              <span className="truncate max-w-[150px] text-sm font-bold tracking-tight text-slate-900">
                {org.name}
              </span>
              <span className="text-muted-foreground/70 group-hover:text-foreground">↕</span>
            </Link>
          ) : (
            <p className="truncate text-sm font-bold tracking-tight text-slate-900">{org.name}</p>
          )}
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Reportme<span className="text-blue-600">.ai</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="md:hidden -mr-2 flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
          aria-label="Cerrar menú"
        >
          <X className="size-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto p-3">
        <div className="flex flex-col gap-0.5">
          {NAV.map((item) => {
            const active = isNavActive(item, pathname);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
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
      </nav>

      <div className="p-3 border-t border-border flex flex-col gap-2">
        <p className="text-xs text-muted-foreground truncate px-3">{user.email}</p>
        <Link
          href="/settings"
          onClick={() => setOpen(false)}
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
            pathname.startsWith("/settings")
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          <Settings className="size-4" />
          Configuración
        </Link>
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
    </>
  );

  const activeItem = NAV.find((n) => isNavActive(n, pathname));

  return (
    <>
      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-card/95 px-4 py-3 backdrop-blur">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="-ml-2 flex size-9 items-center justify-center rounded-lg text-foreground hover:bg-accent"
          aria-label="Abrir menú"
        >
          <Menu className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-tight">
            {activeItem?.label ?? (
              <>
                Reportme<span className="text-blue-600">.ai</span>
              </>
            )}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">{org.name}</p>
        </div>
      </header>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 shrink-0 border-r border-border bg-card flex-col">
        {navContent}
      </aside>

      {/* Mobile drawer */}
      {open ? (
        <div className="md:hidden fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Cerrar menú"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm"
          />
          <aside className="absolute left-0 top-0 bottom-0 flex w-72 max-w-[85vw] flex-col bg-card shadow-xl">
            {navContent}
          </aside>
        </div>
      ) : null}
    </>
  );
}
