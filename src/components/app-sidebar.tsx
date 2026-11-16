"use client";

import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
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
import type { Seccion } from "@/lib/secciones";

type CountKey = keyof NavCounts;

type NavItem = {
  seccion: Seccion;
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
      { seccion: "inicio", href: "/inicio", label: "Inicio", icon: LayoutDashboard, exact: true },
      { seccion: "proyectos", href: "/proyectos", label: "Proyectos", icon: Hammer, count: "proyectos" },
      {
        seccion: "mantenimiento",
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
      { seccion: "leads", href: "/leads", label: "Leads", icon: Sparkles, count: "leads" },
      { seccion: "cotizaciones", href: "/potenciales", label: "Cotizaciones", icon: TrendingUp, count: "cotizaciones" },
      { seccion: "licitaciones", href: "/licitaciones", label: "Licitaciones", icon: Landmark, count: "licitaciones" },
    ],
  },
  {
    label: "Base",
    items: [
      { seccion: "clientes", href: "/clientes", label: "Clientes", icon: Building2, count: "clientes" },
      { seccion: "personal", href: "/personal", label: "Personal", icon: Users, count: "personal" },
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
  secciones: Seccion[];
  verConfiguracion: boolean;
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

export function AppSidebar({ org, user, showOrgSwitcher = false, counts, secciones, verConfiguracion }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const closeOnDesktop = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);
  const grupos = GRUPOS.map((g) => ({ ...g, items: g.items.filter((i) => secciones.includes(i.seccion)) })).filter(
    (g) => g.items.length > 0,
  );

  const navContent = (
    <>
      <div className="flex items-center justify-between gap-3 px-5 py-7">
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-lg font-bold text-white shadow-lg shadow-blue-950/40">{org.name.trim().slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0 flex-1">
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
          className="-mr-2 flex size-11 items-center justify-center rounded-lg text-slate-400 hover:bg-sidebar-hover hover:text-white md:hidden"
          aria-label="Cerrar menú"
        >
          <X className="size-5" />
        </button>
      </div>

      <nav aria-label="Navegación principal" className="flex-1 overflow-y-auto px-3 pb-3">
        {grupos.map((grupo) => (
          <div key={grupo.label} className="mb-1.5">
            <p className="px-3 pb-2 pt-5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
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
                      "flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-blue-400",
                      active
                        ? "bg-blue-600 font-semibold text-white shadow-sm shadow-blue-950/20"
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
        {verConfiguracion ? (
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className={cn(
              "flex min-h-11 items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-blue-400",
              pathname.startsWith("/settings")
                ? "bg-sidebar-active font-semibold text-white"
                : "text-slate-300 hover:bg-sidebar-hover hover:text-white",
            )}
          >
            <Settings className="size-4" />
            Configuración
          </Link>
        ) : null}
        <form action="/logout" method="post">
          <button
            type="submit"
            className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-slate-300 transition-colors hover:bg-sidebar-hover hover:text-white focus-visible:outline-2 focus-visible:outline-blue-400"
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
          ref={menuButton}
          onClick={() => setOpen(true)}
          className="-ml-2 flex size-11 items-center justify-center rounded-lg text-white hover:bg-sidebar-hover focus-visible:outline-2 focus-visible:outline-blue-400"
          aria-label="Abrir menú"
          aria-expanded={open}
          aria-controls="mobile-navigation"
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
      <aside className="sticky top-0 hidden h-dvh w-[224px] shrink-0 flex-col bg-sidebar-bg md:flex 2xl:w-[248px]">{navContent}</aside>

      {/* Drawer móvil */}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm md:hidden" />
          <Dialog.Content id="mobile-navigation" aria-describedby={undefined} onCloseAutoFocus={(event) => { event.preventDefault(); menuButton.current?.focus(); }} className="fixed inset-y-0 left-0 z-50 flex w-80 max-w-[90vw] flex-col bg-sidebar-bg shadow-xl focus:outline-none md:hidden">
            <Dialog.Title className="sr-only">Menú de {org.name}</Dialog.Title>
            {navContent}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
