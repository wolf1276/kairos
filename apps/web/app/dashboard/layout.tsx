"use client";

import { useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/utils";
import {
  Home,
  ArrowRightLeft,
  Bot,
  Cpu,
  History,
  Settings,
  ChevronLeft,
  Menu,
  Wallet,
  LogOut,
} from "lucide-react";
import { WalletProvider, useWalletContext } from "@/app/contexts/WalletContext";

function useMediaQuery(query: string): boolean {
  const subscribe = (callback: () => void) => {
    const mq = window.matchMedia(query);
    mq.addEventListener("change", callback);
    return () => mq.removeEventListener("change", callback);
  };
  const getSnapshot = () => window.matchMedia(query).matches;
  const getServerSnapshot = () => false;
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

type NavItem = {
  href: string;
  label: string;
  exact: boolean;
  icon: React.ElementType;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Overview", exact: true, icon: Home },
  { href: "/dashboard/trade", label: "Trade", exact: false, icon: ArrowRightLeft },
  { href: "/dashboard/autonomous", label: "Autonomous", exact: false, icon: Cpu },
  { href: "/dashboard/agents", label: "Agents", exact: false, icon: Bot },
  { href: "/dashboard/history", label: "History", exact: false, icon: History },
  { href: "/dashboard/settings", label: "Settings", exact: true, icon: Settings },
];

function WalletBar({ isCollapsed }: { isCollapsed: boolean }) {
  const { walletOwner, connected, connecting, checked, connect, disconnect } = useWalletContext();
  const cols = isCollapsed;

  if (!checked) {
    return (
      <div className={cols ? "flex justify-center" : "flex items-center gap-3"}>
        <span className="h-2 w-2 shrink-0 rounded-full bg-text-muted/30" />
        {!cols && <span className="text-[13px] font-medium text-text-muted">Checking…</span>}
      </div>
    );
  }

  if (!connected) {
    return (
      <div className={cols ? "flex justify-center" : ""}>
        <button
          onClick={() => connect()}
          disabled={connecting}
          className={cols
            ? "flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.04] text-text-muted hover:bg-white/[0.08] hover:text-text-primary transition-colors"
            : "flex w-full items-center justify-center gap-2 rounded-xl bg-white/[0.04] py-2.5 text-[13px] font-medium text-text-muted hover:bg-white/[0.08] hover:text-text-primary transition-colors"
          }
          aria-label="Connect wallet"
        >
          {connecting ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : cols ? (
            <Wallet className="h-4 w-4" />
          ) : (
            <>
              <Wallet className="h-4 w-4" />
              Connect Wallet
            </>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className={cols ? "flex justify-center" : "space-y-2"}>
      <div className={cols ? "" : "flex items-center gap-3"}>
        <span className="h-2 w-2 shrink-0 rounded-full bg-success shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
        {!cols && (
          <span className="text-[13px] font-medium text-text-muted tracking-wide">Testnet</span>
        )}
      </div>
      {!cols && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-white/[0.02] px-3 py-2">
          <span className="font-mono text-[12px] text-text-secondary truncate">
            {walletOwner ? `${walletOwner.slice(0, 4)}…${walletOwner.slice(-4)}` : ""}
          </span>
          <button
            onClick={disconnect}
            className="shrink-0 text-text-muted hover:text-error transition-colors"
            aria-label="Disconnect wallet"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  const isActive = (item: NavItem) => {
    if (item.exact) return pathname === item.href;
    return pathname.startsWith(item.href);
  };

  return (
    <WalletProvider>
    <div className="flex min-h-screen bg-bg-primary text-text-primary font-body">
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
        className="fixed left-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-xl border border-white/5 bg-glass-bg backdrop-blur-2xl lg:hidden"
        aria-label="Toggle sidebar"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* ── Left Sidebar ── */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-50 flex h-screen flex-col border-r border-white/5 bg-glass-bg backdrop-blur-2xl transition-all duration-300",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
          "lg:translate-x-0",
          isCollapsed ? "lg:w-24" : "lg:w-72",
          !isDesktop && "w-72"
        )}
      >
        {/* Toggle Button (Desktop) */}
        {isDesktop && (
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="absolute -right-3.5 top-9 z-50 flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-glass-bg text-text-muted hover:text-text-primary hover:bg-white/10 transition-colors"
            aria-label="Toggle collapse"
          >
            <ChevronLeft className={cn("h-4 w-4 transition-transform", isCollapsed && "rotate-180")} />
          </button>
        )}

        {/* ── Brand ── */}
        <div className={cn("flex items-center pt-8 pb-8 transition-all", isCollapsed && isDesktop ? "justify-center px-0" : "gap-4 px-8")}>
          <div className="flex shrink-0 items-center justify-center">
            <Image
              src="/logo.png"
              alt="Kairos"
              width={40}
              height={40}
            />
          </div>
          {(!isCollapsed || !isDesktop) && (
            <span className="text-base font-semibold tracking-[0.15em] uppercase text-text-primary font-display truncate">
              Kairos
            </span>
          )}
        </div>

        {/* ── Navigation ── */}
        <nav className="flex flex-1 flex-col gap-2 px-4 overflow-y-auto no-scrollbar">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => !isDesktop && setSidebarOpen(false)}
                className={cn(
                  "group relative flex items-center gap-4 rounded-2xl px-4 py-3.5 text-[15px] font-medium transition-all duration-200",
                  active
                    ? "bg-white/[0.08] text-text-primary"
                    : "text-text-muted hover:bg-white/[0.04] hover:text-text-secondary",
                  isCollapsed && isDesktop && "justify-center px-0"
                )}
                title={isCollapsed && isDesktop ? item.label : undefined}
              >
                <item.icon
                  className={cn(
                    "shrink-0 h-[22px] w-[22px] transition-colors duration-200",
                    active
                      ? "text-accent"
                      : "text-text-muted group-hover:text-text-secondary"
                  )}
                  strokeWidth={active ? 2.5 : 2}
                />
                {(!isCollapsed || !isDesktop) && (
                  <span className="truncate">{item.label}</span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* ── Footer / Wallet ── */}
        <div className="border-t border-white/5 p-4 mt-auto">
          <WalletBar isCollapsed={isCollapsed && isDesktop} />
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className={cn(
        "flex-1 px-6 py-8 transition-all duration-300",
        isDesktop ? (isCollapsed ? "ml-24" : "ml-72") : "ml-0"
      )}>
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
    </WalletProvider>
  );
}
