"use client";

import type { CapitalWalletInfo } from "@/app/hooks/useSmartWallet";

function shortKey(key: string) {
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

/** Lets the user pick which capital wallet an agent/action should delegate from, when more than
 *  one exists. Renders nothing for the common single-wallet case. */
export function WalletPicker({
  wallets,
  value,
  onChange,
  className,
}: {
  wallets: CapitalWalletInfo[];
  value: string | null;
  onChange: (address: string) => void;
  className?: string;
}) {
  if (wallets.length <= 1) return null;
  return (
    <div className={className}>
      <label className="mb-1 block text-[10px] uppercase tracking-widest text-text-muted">Capital wallet</label>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-white/5 bg-bg-elevated px-2.5 py-1.5 font-mono text-xs text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
      >
        {wallets.map((w) => (
          <option key={w.address} value={w.address}>
            {w.label ? `${w.label} — ${shortKey(w.address)}` : shortKey(w.address)}
          </option>
        ))}
      </select>
    </div>
  );
}
