"use client";

import { useEffect, useState } from "react";
import { kitListWallets, type KitWalletOption } from "@/app/lib/walletKit";

interface ConnectWalletModalProps {
  open: boolean;
  connecting: boolean;
  error: string | null;
  onClose: () => void;
  onPick: (walletId: string) => void;
}

/** Custom two-panel connect-wallet picker — the kit's own built-in modal only shows one panel at
 *  a time (wallet list, or "Learn more" after clicking the (?) icon); this always shows both side
 *  by side. Wallet connect/sign itself is still entirely driven by the kit (see walletKit.ts) —
 *  this component only replaces the picker's presentation. */
export function ConnectWalletModal({ open, connecting, error, onClose, onPick }: ConnectWalletModalProps) {
  const [wallets, setWallets] = useState<KitWalletOption[] | null>(null);
  // Wallet the user clicked but hasn't confirmed the data-access consent screen for yet.
  const [pendingWallet, setPendingWallet] = useState<KitWalletOption | null>(null);
  // Wallet actually mid-connect (spinner target) — cleared by the parent flipping `open` false,
  // or by an error coming back through `error`.
  const [activeWalletId, setActiveWalletId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setWallets(null);
    setPendingWallet(null);
    setActiveWalletId(null);
    kitListWallets()
      .then(setWallets)
      .catch(() => setWallets([]));
  }, [open]);

  useEffect(() => {
    if (error) setActiveWalletId(null);
  }, [error]);

  if (!open) return null;

  const confirmPick = (w: KitWalletOption) => {
    setPendingWallet(null);
    setActiveWalletId(w.id);
    onPick(w.id);
  };

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex w-full max-w-3xl overflow-hidden rounded-2xl border border-white/10 bg-[#0b0b0f] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Learn more panel */}
        <div className="hidden w-1/2 border-r border-white/5 p-6 sm:block">
          <h2 className="mb-4 text-sm font-semibold text-white uppercase">Learn more</h2>
          <div className="space-y-5">
            <div>
              <h3 className="mb-1 text-xs font-medium text-white/90">What is a Wallet?</h3>
              <p className="text-xs leading-relaxed text-white/50">
                Wallets are used to send, receive, and store the keys you use to sign blockchain transactions.
              </p>
            </div>
            <div>
              <h3 className="mb-1 text-xs font-medium text-white/90">What is Stellar?</h3>
              <p className="text-xs leading-relaxed text-white/50">
                Stellar is a decentralized, public blockchain that gives developers the tools to
                create experiences that are more like cash than crypto.
              </p>
            </div>
          </div>
        </div>

        {/* Wallet list panel */}
        <div className="w-full p-6 sm:w-1/2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Connect a Wallet</h2>
            <button
              onClick={onClose}
              className="text-white/40 transition-colors hover:text-white"
              aria-label="Close"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {error && (
            <p className="mb-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}

          {pendingWallet ? (
            <div>
              <div className="mb-4 flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={pendingWallet.icon} alt="" className="h-8 w-8 rounded-full" />
                <div>
                  <p className="text-sm font-semibold text-white">Connect to {pendingWallet.name}</p>
                  <p className="text-[11px] text-white/40">Kairos will request:</p>
                </div>
              </div>
              <ul className="mb-5 space-y-2 text-xs text-white/60">
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 text-white/30">•</span>
                  Your Stellar public address (to display balances and identify your account)
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 text-white/30">•</span>
                  A signature to verify you own that address (no funds move)
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 text-white/30">•</span>
                  Approval prompts before any transaction or delegation is signed
                </li>
              </ul>
              <p className="mb-4 text-[11px] text-white/30">
                Kairos never sees or stores your secret key — {pendingWallet.name} keeps it and signs locally.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPendingWallet(null)}
                  className="flex-1 rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-white/60 transition-colors hover:bg-white/[0.04]"
                >
                  Back
                </button>
                <button
                  onClick={() => confirmPick(pendingWallet)}
                  className="flex-1 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-black transition-colors hover:bg-white/90"
                >
                  Continue
                </button>
              </div>
            </div>
          ) : wallets === null ? (
            <div className="flex h-40 items-center justify-center">
              <span className="h-4 w-4 animate-spin rounded-full border border-white/30 border-t-transparent" />
            </div>
          ) : (
            <ul className="space-y-1">
              {wallets.map((w) => {
                const isActive = connecting && activeWalletId === w.id;
                return (
                  <li key={w.id}>
                    <button
                      disabled={!w.isAvailable || connecting}
                      onClick={() => setPendingWallet(w)}
                      className="flex w-full items-center justify-between rounded-lg px-2 py-2.5 transition-colors duration-150 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="flex items-center gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={w.icon} alt="" className="h-6 w-6 rounded-full" />
                        <span className="text-sm font-medium text-white">{w.name}</span>
                      </span>
                      {isActive ? (
                        <span className="flex items-center gap-1.5 text-[10px] text-white/50">
                          <span className="h-3 w-3 animate-spin rounded-full border border-white/30 border-t-transparent" />
                          Connecting…
                        </span>
                      ) : !w.isAvailable ? (
                        <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/40">
                          Not available
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="mt-5 text-center text-[10px] text-white/30">
            Powered by{" "}
            <a
              href="https://stellarwalletskit.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-white/50"
            >
              Stellar Wallets Kit
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
