"use client";

import { useState } from "react";
import DelegationKit from "@/app/components/DelegationKit";

export default function DelegationsPage() {
  // ── SDK delegation state ──
  const [smartWalletAddress, setSmartWalletAddress] = useState<string | null>(
    null
  );
  const [walletOwner] = useState<string | null>(null);
  const [deployingWallet, setDeployingWallet] = useState(false);
  const [delegationHash, setDelegationHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDeployWallet = async () => {
    setDeployingWallet(true);
    setError(null);
    try {
      const res = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "DEPLOY_WALLET",
          owner:
            walletOwner ||
            "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSmartWalletAddress(data.smartWalletAddress);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeployingWallet(false);
    }
  };

  const handleCreateDelegation = async () => {
    if (!smartWalletAddress) return;
    setError(null);
    try {
      const res = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CREATE_DELEGATION",
          delegator: smartWalletAddress,
          delegate:
            walletOwner ||
            "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
          caveats: [],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDelegationHash(data.hash);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* ── Left column ── */}
      <div className="space-y-5">
        <DelegationKit />

        {/* On-chain delegation card */}
        <div className="rounded-2xl border border-border bg-bg-card p-5">
          <h3 className="mb-4 font-display text-base font-semibold">
            On-Chain Delegation
          </h3>
          <div className="space-y-3">
            {!smartWalletAddress ? (
              <div>
                <p className="mb-2 text-xs text-text-muted">
                  Deploy a smart wallet to create on-chain delegations.
                </p>
                <button
                  onClick={handleDeployWallet}
                  disabled={deployingWallet}
                  className="w-full rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
                >
                  {deployingWallet ? "Deploying..." : "Deploy Smart Wallet"}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-xl bg-bg-elevated p-3">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted">
                    Smart Wallet
                  </p>
                  <p className="mt-1 font-mono text-xs">
                    {smartWalletAddress}
                  </p>
                </div>
                <button
                  onClick={handleCreateDelegation}
                  className="w-full rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
                >
                  Create Delegation
                </button>
                {delegationHash && (
                  <div className="rounded-xl bg-success/10 border border-success/20 p-3">
                    <p className="text-[10px] font-mono uppercase tracking-widest text-success">
                      Delegation Hash
                    </p>
                    <p className="mt-1 font-mono text-xs text-success">
                      {delegationHash}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Right column: delegation list & policies ── */}
      <div className="rounded-2xl border border-border bg-bg-card p-5">
        <h3 className="mb-4 font-display text-base font-semibold">
          Active Delegations
        </h3>
        {/* TODO: fetch and list all delegations via /api/delegate-sdk (action: LIST) */}
        {/* TODO: PolicyEditor component — visual form for target-whitelist, spend-limit, time-restriction */}
        <p className="text-sm text-text-muted">
          {smartWalletAddress
            ? "Delegation management and policy configuration will appear here."
            : "Deploy a smart wallet to get started."}
        </p>
      </div>

      {error && (
        <div className="lg:col-span-2 rounded-2xl border border-error/20 bg-error/10 p-4">
          <p className="text-xs text-error">{error}</p>
        </div>
      )}
    </div>
  );
}
