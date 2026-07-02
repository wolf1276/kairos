"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", exact: true },
  { href: "/dashboard/trade", label: "Trade", exact: false },
  { href: "/dashboard/portfolio", label: "Portfolio", exact: false },
  { href: "/dashboard/delegations", label: "Delegations", exact: false },
  { href: "/dashboard/history", label: "History", exact: false },
  { href: "/settings", label: "Settings", exact: true },
] as const;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const isActive = (item: (typeof NAV_ITEMS)[number]) => {
    if (item.exact) return pathname === item.href;
    return pathname.startsWith(item.href);
  };

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      {/* ── Sticky header ── */}
      <header className="sticky top-0 z-50 bg-glass-bg backdrop-blur-2xl shadow-[0_1px_0_rgba(255,255,255,0.03)]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/dashboard" className="flex items-center gap-3">
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
          </Link>

          <nav className="flex items-center gap-0.5">
            {NAV_ITEMS.map((item) => {
              const active = isActive(item);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-[7px] px-3 py-1.5 text-xs font-medium capitalize transition-all duration-300 ${
                    active
                      ? "bg-white/6 text-text-primary shadow-[0_0_20px_-10px_rgba(120,81,233,0.12)]"
                      : "text-text-muted hover:bg-white/[0.03] hover:text-text-secondary"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
