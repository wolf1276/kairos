"use client";

import { useState, useEffect, useCallback } from "react";
import {
  connectWallet,
  delegateXLM,
  type WalletState,
  tryCheckConnection,
} from "@/app/lib/stellar";

interface DelegationKitProps {
  /** Called whenever the connected wallet changes (connect/disconnect/refresh). */
  onWalletChange?: (wallet: WalletState | null) => void;
  /** Prefills the destination field, e.g. with a freshly deployed smart wallet address. */
  defaultDestination?: string;
}

// ── Simple SVG icons ──

const WalletIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="5" width="22" height="14" rx="2" ry="2" />
    <circle cx="17" cy="12" r="1.5" fill="currentColor" />
  </svg>
);

const ArrowRight = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
);

const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const Spinner = () => (
  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
);

type TxStatus = "idle" | "pending" | "confirmed" | "error";

export default function DelegationKit({ onWalletChange, defaultDestination }: DelegationKitProps = {}) {
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [txStatus, setTxStatus] = useState<TxStatus>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  useEffect(() => {
    onWalletChange?.(wallet);
  }, [wallet, onWalletChange]);

  // ── Connect ──
  const handleConnect = useCallback(async () => {
    setConnecting(true);
    setConnectError(null);

    const result = await connectWallet();

    if (result.success && result.wallet) {
      setWallet(result.wallet);
    } else {
      const kind = result.error?.kind;
      const msg = result.error?.message ?? "Unknown error";

      if (kind === "no-extension") {
        setConnectError("Freighter extension not found. Install it from freighter.app");
      } else if (kind === "user-rejected") {
        setConnectError("Connection cancelled in Freighter");
      } else {
        setConnectError(msg);
      }
    }

    setConnecting(false);
  }, []);

  // ── Auto-reconnect on mount if Freighter already authorized ──
  useEffect(() => {
    let cancelled = false;
    tryCheckConnection().then((ok) => {
      if (ok && !cancelled) handleConnect();
    });
    return () => { cancelled = true; };
  }, [handleConnect]);

  // ── Disconnect ──
  const handleDisconnect = () => {
    setWallet(null);
    setTxStatus("idle");
    setTxHash(null);
    setTxError(null);
    setAmount("");
    setDestination("");
    setConnectError(null);
  };

  // ── Delegate ──
  const handleDelegate = async () => {
    if (!wallet || !amount || parseFloat(amount) <= 0 || !destination) return;

    setTxStatus("pending");
    setTxError(null);

    try {
      const result = await delegateXLM(
        amount,
        destination,
        wallet.networkPassphrase,
        wallet.sorobanRpcUrl
      );
      setTxHash(result.hash);
      setTxStatus("confirmed");

      // Refresh balance
      const refresh = await connectWallet();
      if (refresh.success && refresh.wallet) setWallet(refresh.wallet);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setTxError(errMsg || "Transaction failed");
      setTxStatus("error");
    }
  };

  const shortAddress = (addr: string) => `${addr.slice(0, 4)}\u2026${addr.slice(-4)}`;

  // ── Disconnected: Show connect prompt ──
  if (!wallet) {
    return (
      <div className="rounded-2xl card-glass card-glow p-6">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-muted/60 text-accent">
            <WalletIcon />
          </span>
          <div>
            <h2 className="font-display text-sm font-medium text-text-primary">
              Delegation Wallet
            </h2>
            <p className="text-xs text-text-muted">
              Connect Freighter to fund your agent
            </p>
          </div>
        </div>

        {/* Connect button */}
        <button
          onClick={handleConnect}
          disabled={connecting}
          className="group relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-accent/80 px-5 py-3 text-sm font-semibold text-white transition-all duration-300 hover:bg-accent hover:shadow-[0_0_25px_-10px_rgba(120,81,233,0.2)] disabled:opacity-40"
        >
          {connecting ? (
            <>
              <Spinner />
              Connecting\u2026
            </>
          ) : (
            <>
              <WalletIcon />
              Connect Freighter Wallet
            </>
          )}
        </button>

        {/* Error feedback */}
        {connectError && (
          <div className="mt-4 animate-fade-in-up rounded-xl border border-error/15 bg-error/6 px-4 py-3">
            <p className="text-xs leading-relaxed text-error/90">{connectError}</p>
          </div>
        )}

        {/* Install hint */}
        <p className="mt-4 text-xs text-text-muted">
          First time?{" "}
          <a
            href="https://freighter.app"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-accent underline underline-offset-2 hover:text-accent-hover"
          >
            Install Freighter \u2192
          </a>
        </p>
      </div>
    );
  }

  // ── Connected: Show wallet & delegate form ──
  return (
    <div className="rounded-2xl card-glass card-glow p-6">
      {/* Header row */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-muted/60 text-accent">
            <WalletIcon />
          </span>
          <div>
            <h2 className="font-display text-sm font-medium text-text-primary">
              Delegation Wallet
            </h2>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider ${
                wallet.isTestnet
                  ? "bg-amber-500/8 text-amber-400/85"
                  : "bg-emerald-500/8 text-emerald-400/85"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  wallet.isTestnet ? "bg-amber-400" : "bg-emerald-400"
                }`}
              />
              {wallet.network}
            </span>
          </div>
        </div>
        <button
          onClick={handleDisconnect}
          className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-text-muted transition-colors duration-200 hover:bg-white/[0.03] hover:text-text-secondary"
        >
          Disconnect
        </button>
      </div>

      {/* Account & Balance */}
      <div className="mb-5 rounded-xl border border-white/5 bg-white/[0.02] p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">
              Account
            </p>
            <p className="mt-0.5 font-mono text-sm text-text-primary">
              {shortAddress(wallet.address)}
            </p>
          </div>
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-muted/50 text-accent">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </span>
        </div>
        <div className="mt-3 border-t border-white/5 pt-3">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">
            Balance
          </p>
          <p className="mt-1 font-display text-2xl font-bold tracking-tight text-text-primary">
            {parseFloat(wallet.balance).toFixed(2)}{" "}
            <span className="text-base font-medium text-text-muted">XLM</span>
          </p>
        </div>
      </div>

      {/* Delegate form */}
      <div className="space-y-3.5">
        {/* Amount input */}
        <div>
          <label
            htmlFor="del-amount"
            className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted"
          >
            Amount (XLM)
          </label>
          <div className="relative">
            <input
              id="del-amount"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-xl border border-white/5 bg-white/[0.02] py-2.5 pl-3.5 pr-14 font-mono text-sm text-text-primary placeholder:text-text-muted/50 transition-all duration-300 focus:border-accent/30 focus:outline-none focus:ring-2 focus:ring-accent/15"
            />
            <button
              onClick={() => setAmount(wallet.balance)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-0.5 font-mono text-[11px] font-medium text-accent/80 transition-colors duration-200 hover:bg-accent-muted/50 hover:text-accent"
            >
              MAX
            </button>
          </div>
        </div>

        {/* Destination input */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label
              htmlFor="del-dest"
              className="block font-mono text-[11px] font-medium uppercase tracking-widest text-text-secondary"
            >
              Destination
            </label>
            {defaultDestination && (
              <button
                onClick={() => setDestination(defaultDestination)}
                className="font-mono text-[11px] font-medium text-accent transition-colors hover:text-accent-hover"
              >
                Use smart wallet
              </button>
            )}
          </div>
          <input
            id="del-dest"
            type="text"
            placeholder="G\u2026 or C\u2026"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            className="w-full rounded-xl border border-white/5 bg-white/[0.02] py-2.5 pl-3.5 pr-3.5 font-mono text-sm text-text-primary placeholder:text-text-muted/50 transition-all duration-300 focus:border-accent/30 focus:outline-none focus:ring-2 focus:ring-accent/15"
          />
        </div>

        {/* Quick chips */}
        <div className="flex gap-2">
          {[5, 10, 25, 50].map((amt) => (
            <button
              key={amt}
              onClick={() => setAmount(amt.toString())}
              className="flex-1 rounded-lg border border-white/5 bg-white/[0.02] px-2 py-1.5 font-mono text-xs font-medium text-text-muted transition-all duration-200 hover:bg-white/[0.05] hover:text-text-secondary"
            >
              {amt}
            </button>
          ))}
        </div>

        {/* Submit */}
        <button
          onClick={handleDelegate}
          disabled={
            !amount ||
            parseFloat(amount) <= 0 ||
            !destination ||
            txStatus === "pending"
          }
          className="group relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-accent/80 px-5 py-3 text-sm font-semibold text-white transition-all duration-300 hover:bg-accent hover:shadow-[0_0_25px_-10px_rgba(120,81,233,0.2)] disabled:cursor-not-allowed disabled:opacity-30"
        >
          {txStatus === "pending" ? (
            <>
              <Spinner />
              Signing &amp; Sending\u2026
            </>
          ) : (
            <>
              <ArrowRight />
              Delegate {amount ? `${amount} XLM` : "Funds"}
            </>
          )}
        </button>
      </div>

      {/* Success banner */}
      {txStatus === "confirmed" && (
        <div className="mt-4 animate-fade-in-up flex items-center gap-2.5 rounded-xl border border-emerald-500/15 bg-emerald-500/6 px-4 py-3">
          <span className="text-emerald-400/80"><CheckIcon /></span>
          <span className="text-sm font-medium text-emerald-300/90">
            Delegation confirmed
          </span>
          {txHash && (
            <span className="ml-auto font-mono text-[11px] text-emerald-400/60">
              {shortAddress(txHash)}
            </span>
          )}
        </div>
      )}

      {/* Error banner */}
      {txStatus === "error" && txError && (
        <div className="mt-4 animate-fade-in-up rounded-xl border border-error/15 bg-error/6 px-4 py-3">
          <p className="text-xs text-error/90">{txError}</p>
        </div>
      )}
    </div>
  );
}
