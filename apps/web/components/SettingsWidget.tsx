"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Settings } from "lucide-react";
import { Badge } from "@/app/components/ui/Badge";
import { useWalletContext } from "@/app/contexts/WalletContext";

function shortAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function SettingsWidget() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { wallet, connected, walletOwner, smartWalletAddress, smartWallets } = useWalletContext();

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handle);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggle}
        title="Settings"
        className="flex h-7 w-7 md:h-8 md:w-8 items-center justify-center rounded-lg text-white/40 transition-colors hover:bg-white/[0.04] hover:text-white/70"
      >
        <Settings className="h-3.5 w-3.5 md:h-4 md:w-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-white/[0.06] bg-[#0d0d0f] shadow-[0_16px_48px_-12px_rgba(0,0,0,0.7)] backdrop-blur-xl">
          <div className="border-b border-white/[0.04] px-4 py-2.5">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">Settings</p>
          </div>

          <div className="space-y-2 px-4 py-3">
            <Section label="Wallet">
              {!connected ? (
                <p className="text-xs text-text-muted">Not connected</p>
              ) : (
                <div className="space-y-1.5">
                  <InfoRow label="Status" value={<Badge tone="success" dot>Connected</Badge>} />
                  <InfoRow label="Network" value={<Badge tone="accent">{wallet?.isTestnet ? "Testnet" : "Mainnet"}</Badge>} />
                  <InfoRow label="Owner" value={walletOwner ? shortAddress(walletOwner) : "—"} />
                  {smartWalletAddress && <InfoRow label="Smart Wallet" value={shortAddress(smartWalletAddress)} />}
                  <InfoRow label="Deployed" value={smartWallets.length > 0 ? `${smartWallets.length}` : "None"} />
                </div>
              )}
            </Section>

            <Section label="About">
              <InfoRow label="App" value="Kairos" />
              <InfoRow label="Version" value="0.1.0" />
              <InfoRow label="Env" value={process.env.NODE_ENV ?? "production"} />
            </Section>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 font-mono text-[9px] font-medium uppercase tracking-[0.14em] text-text-muted/50">{label}</p>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-text-secondary">{label}</span>
      <span className="text-[11px] text-text-primary">{value}</span>
    </div>
  );
}
