"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useWalletContext } from "@/app/contexts/WalletContext";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", exact: true },
  { href: "/dashboard/agents", label: "Agents", exact: false },
] as const;

function shortAddress(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export function Navbar() {
  const pathname = usePathname();
  const isDashboard = pathname.startsWith("/dashboard");
  const wallet = isDashboard ? useWalletContext() : null;

  const isActive = (href: string, exact: boolean) => {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 md:px-8 lg:px-12 h-14 md:h-16 bg-black/50 backdrop-blur-xl border-b border-white/5">
      <div className="flex items-center gap-2 md:gap-3">
        <Link href={isDashboard ? "/dashboard" : "/"} className="flex items-center gap-2 shrink-0">
          <Image
            src="/logo.png"
            alt="Kairos"
            width={28}
            height={28}
            className="opacity-80 shrink-0"
          />
          <span className="text-xs md:text-sm font-semibold tracking-[0.3em] uppercase text-white/90">
            KAIROS
          </span>
        </Link>

        {isDashboard && (
          <div className="flex items-center ml-2 md:ml-6 gap-0.5 md:gap-1">
            {NAV_ITEMS.map((item) => {
              const active = isActive(item.href, item.exact);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-2.5 md:px-4 py-1.5 rounded-lg text-xs md:text-sm font-medium transition-all duration-200 ${
                    active
                      ? "bg-white/[0.08] text-white"
                      : "text-white/50 hover:text-white/80 hover:bg-white/[0.04]"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 md:gap-3">
        {!isDashboard && (
          <>
            <Link
              href="/docs"
              className="text-xs md:text-sm text-white/50 transition duration-500 hover:text-white"
            >
              Docs
            </Link>
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs md:text-sm text-white/50 transition duration-500 hover:text-white hidden sm:inline"
            >
              GitHub
            </a>
            <Link
              href="/dashboard"
              className="inline-flex h-7 md:h-8 items-center rounded-full bg-white px-3 md:px-4 text-[10px] font-semibold text-black transition duration-500 hover:bg-white/90"
            >
              Launch App
            </Link>
          </>
        )}

        {isDashboard && wallet && (
          <>
            {!wallet.connected ? (
              <button
                onClick={() => wallet.connect()}
                disabled={wallet.connecting}
                className="inline-flex h-7 md:h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 md:px-4 text-xs font-medium text-white/70 transition-all duration-200 hover:bg-white/[0.08] hover:text-white disabled:opacity-50"
              >
                {wallet.connecting ? (
                  <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                      <line x1="1" y1="10" x2="23" y2="10" />
                    </svg>
                    Connect Wallet
                  </>
                )}
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => wallet.disconnect()}
                  title="Disconnect wallet"
                  className="group flex items-center gap-2 rounded-lg bg-white/[0.04] px-3 py-1.5 transition-colors duration-200 hover:bg-white/[0.08]"
                >
                  <span className="h-2 w-2 rounded-full bg-success shadow-[0_0_6px_rgba(34,197,94,0.5)] group-hover:hidden" />
                  <svg
                    className="hidden h-3 w-3 text-red-400 group-hover:block"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  <span className="font-mono text-xs text-white/70 group-hover:text-white">
                    {wallet.walletOwner ? shortAddress(wallet.walletOwner) : ""}
                  </span>
                </button>
                <Link
                  href="/dashboard/settings"
                  className={`p-1.5 rounded-lg transition-all duration-200 ${
                    pathname === "/dashboard/settings"
                      ? "bg-white/[0.08] text-white"
                      : "text-white/40 hover:text-white/70 hover:bg-white/[0.04]"
                  }`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </nav>
  );
}
