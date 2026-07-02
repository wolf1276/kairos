"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import TerminalTicker from "@/app/components/TerminalTicker";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", exact: true },
  { href: "/dashboard/trade", label: "Trade" },
  { href: "/dashboard/portfolio", label: "Portfolio" },
  { href: "/dashboard/delegations", label: "Delegations" },
  { href: "/dashboard/history", label: "History" },
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
      <header className="sticky top-0 z-50 border-b border-border bg-bg-primary/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <Link href="/dashboard" className="flex items-center gap-3">
            <Image
              src="/logo.png"
              alt="Kairos"
              width={28}
              height={28}
              className="opacity-80"
            />
            <span className="text-sm font-medium tracking-[0.3em] uppercase text-white/80">
              Kairos
            </span>
          </Link>

          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                  isActive(item)
                    ? "bg-accent-muted text-accent"
                    : "text-text-muted hover:text-text-secondary"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <TerminalTicker />

      <main className="mx-auto max-w-7xl px-6 py-6">{children}</main>
    </div>
  );
}
