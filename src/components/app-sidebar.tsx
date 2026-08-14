"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LogOut,
  Users,
  Building2,
  LayoutDashboard,
  Menu,
  X,
  Settings,
  Hammer,
  Wrench,
  TrendingUp,
  Sparkles,
  Landmark,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavCounts } from "@/lib/nav-counts";

type CountKey = keyof NavCounts;

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
  also?: string[];
  count?: CountKey;
  alerta?: boolean; // pastilla roja: es un pendiente, no un inventario
};

// Tres grupos, según el handoff: lo que YA es negocio arriba, lo que todavía no
// lo es en el medio, y los catálogos abajo.
const GRUPOS: { label: string; items: NavItem[] }[] = [
  {
    label: "Operación",
    items: [
      { href: "/inicio", label: "Inicio", icon: LayoutDashboard, exact: true },
      { href: "/proyectos", label: "Proyectos", icon: Hammer, count: "proyectos" },
      {
        href: "/mantenimiento",
        label: "Mantenimiento",
        icon: Wrench,
        also: ["/reportes", "/cronograma"],
        count: "mantenimiento",
        alerta: true,
      },
    ],
  },
  {
    label: "Potenciales",
    items: [
      { href: "/leads", label: "Leads", icon: Sparkles, count: "leads" },
      { href: "/potenciales", label: "Cotizaciones", icon: TrendingUp, count: "cotizaciones" },
      { href: "/licitaciones", label: "Licitaciones", icon: Landmark, count: "licitaciones" },
    ],
  },
  {
    label: "Base",
    items: [
      { href: "/clientes", label: "Clientes", icon: Building2, count: "clientes" },
      { href: "/personal", label: "Personal", icon: Users, count: "personal" },
    ],
  },
];

const TODOS = GRUPOS.flatMap((g) => g.items);

function isNavActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.href;
  if (pathname === item.href || pathname.startsWith(`${item.href}/`)) return true;
  return (item.also ?? []).some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

type Props = {
  org: { name: string };
  user: { email: string | null };
  showOrgSwitcher?: boolean;
  counts?: NavCounts;
};

function Pastilla({ n, alerta }: { n: number; alerta?: boolean }) {
  return (
    <span
      className={cn(
        "ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
        // El rojo dice "esto te está esperando"; el gris es solo cuántos hay.
        alerta ? "bg-rose-500/15 text-rose-300" : "bg-sidebar-pill text-sidebar-pill-text",
      )}
    >
      {n}
    </span>
  );
}

export function AppSidebar({ org, user, showOrgSwitcher = false, counts }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const navContent = (
    <>
      <div className="flex items-center justify-between px-5 py-5">
        <div className="min-w-0">
          {showOrgSwitcher ? (
            <Link href="/select-org" className="group inline-flex items-center gap-1.5" title="Cambiar organización">
              <span className="max-w-[150px] truncate text-[15px] font-bold tracking-tight text-white">{org.name}</span>
              <span className="text-slate-500 group-hover:text-slate-300">↕</span>
            </Link>
          ) : (
            <p className="truncate text-[15px] font-bold tracking-tight text-white">{org.name}</p>
          )}
          <p className="mt-0.5 text-[11px] text-slate-400">
            Reportme<span className="text-[#60A5FA]">.ai</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="-mr-2 flex size-9 items-center justify-center rounded-lg text-slate-400 hover:bg-sidebar-hover hover:text-white md:hidden"
          aria-label="Cerrar menú"
        >
          <X className="size-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-3">
        {GRUPOS.map((grupo) => (
          <div key={grupo.label} className="mb-1.5">
            <p className="px-3 pb-1 pt-3 text-[9px] font-bold uppercase tracking-[0.12em] text-sidebar-label">
              {grupo.label}
            </p>
            <div className="flex flex-col gap-0.5">
              {grupo.items.map((item) => {
                const active = isNavActive(item, pathname);
                const Icon = item.icon;
                const n = item.count ? counts?.[item.count] ?? null : null;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors",
                      active
                        ? "bg-sidebar-active font-semibold text-white shadow-[inset_2px_0_0_#2563EB]"
                        : "text-slate-300 hover:bg-sidebar-hover hover:text-white",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                    {n !== null && n > 0 ? <Pastilla n={n} alerta={item.alerta} /> : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/5 p-3">
        <p className="truncate px-3 pb-1.5 text-[11px] text-slate-400" title={user.email ?? undefined}>
          {user.email}
        </p>
        <Link
          href="/settings"
          onClick={() => setOpen(false)}
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors",
            pathname.startsWith("/settings")
              ? "bg-sidebar-active font-semibold text-white"
              : "text-slate-300 hover:bg-sidebar-hover hover:text-white",
          )}
        >
          <Settings className="size-4" />
          Configuración
        </Link>
        <form action="/logout" method="post">
          <button
            type="submit"
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-slate-300 transition-colors hover:bg-sidebar-hover hover:text-white"
          >
            <LogOut className="size-4" />
            Cerrar sesión
          </button>
        </form>
      </div>
    </>
  );

  const activeItem = TODOS.find((n) => isNavActive(n, pathname));

  return (
    <>
      {/* Barra superior móvil */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-white/5 bg-sidebar-bg px-4 py-3 md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="-ml-2 flex size-9 items-center justify-center rounded-lg text-white hover:bg-sidebar-hover"
          aria-label="Abrir menú"
        >
          <Menu className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-tight text-white">
            {activeItem?.label ?? (
              <>
                Reportme<span className="text-[#60A5FA]">.ai</span>
              </>
            )}
          </p>
          <p className="truncate text-[11px] text-slate-400">{org.name}</p>
        </div>
      </header>

      {/* Sidebar de escritorio */}
      <aside className="hidden w-[236px] shrink-0 flex-col bg-sidebar-bg md:flex">{navContent}</aside>

      {/* Drawer móvil */}
      {open ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Cerrar menú"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
          />
          <aside className="absolute bottom-0 left-0 top-0 flex w-72 max-w-[85vw] flex-col bg-sidebar-bg shadow-xl">
            {navContent}
          </aside>
        </div>
      ) : null}
    </>
  );
}
