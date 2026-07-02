"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", exact: true },
  { href: "/dashboard/trade", label: "Trade", exact: false },
  { href: "/dashboard/portfolio", label: "Portfolio", exact: false },
  { href: "/dashboard/delegations", label: "Delegations", exact: false },
  { href: "/dashboard/history", label: "History", exact: false },
  { href: "/dashboard/settings", label: "Settings", exact: true },
] as const;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Only used to decide whether the mobile overlay/hamburger should render at all — the actual
  // responsive layout (sidebar hidden/offset, content margin) is driven by CSS `lg:` breakpoints
  // below, not this flag, so there's no SSR/client mismatch and no flash of desktop layout on
  // mobile page loads.
  const [isDesktop, setIsDesktop] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    setIsDesktop(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const isActive = (item: (typeof NAV_ITEMS)[number]) => {
    if (item.exact) return pathname === item.href;
    return pathname.startsWith(item.href);
  };

  return (
    <div className="flex min-h-screen bg-bg-primary text-text-primary">
      {/* ── Overlay (mobile) ── */}
      {!isDesktop && sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Hamburger (mobile) ── */}
      <button
        onClick={() => setSidebarOpen((v) => !v)}
        className="fixed left-4 top-4 z-50 flex h-9 w-9 items-center justify-center rounded-xl border border-white/5 bg-glass-bg backdrop-blur-2xl lg:hidden"
        aria-label="Toggle sidebar"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      {/* ── Left Sidebar ── */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-50 flex h-screen w-56 flex-col border-r border-white/5 bg-glass-bg backdrop-blur-2xl transition-transform duration-300 lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center gap-3 px-6 pt-6 pb-4">
          <Image
            src="/logo.png"
            alt="Kairos"
            width={32}
            height={32}
            className="opacity-80"
          />
          <span className="text-sm font-medium tracking-[0.15em] uppercase text-white/70">
            Kairos
          </span>
        </div>
        <nav className="flex flex-col gap-0.5 px-3">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  "rounded-[7px] px-3 py-2 text-xs font-medium capitalize transition-all duration-300",
                  active
                    ? "bg-white/6 text-text-primary shadow-[0_0_20px_-10px_rgba(120,81,233,0.12)]"
                    : "text-text-muted hover:bg-white/[0.03] hover:text-text-secondary",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* ── Main Content ── */}
      <main className="ml-0 flex-1 px-6 py-8 lg:ml-56">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
