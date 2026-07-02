"use client";

import { useState } from "react";
import { Asset } from "@stellar/stellar-sdk";
import DelegationKit from "@/app/components/DelegationKit";
import {
  fetchSmartWalletBalance,
  signAuthEntryWithFreighter,
  type WalletState,
} from "@/app/lib/stellar";

export default function DelegationsPage() {
  // ── Connected Freighter wallet (owns any smart wallet we deploy) ──
  const [connectedWallet, setConnectedWallet] = useState<WalletState | null>(
    null
  );
  const walletOwner = connectedWallet?.address ?? null;

  // ── SDK delegation state ──
  const [smartWalletAddress, setSmartWalletAddress] = useState<string | null>(
    null
  );
  const [smartWalletBalance, setSmartWalletBalance] = useState<string | null>(
    null
  );
  const [deployingWallet, setDeployingWallet] = useState(false);
  const [delegationHash, setDelegationHash] = useState<string | null>(null);
  const [delegationDisabled, setDelegationDisabled] = useState<boolean | null>(
    null
  );
  const [creatingDelegation, setCreatingDelegation] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Policy (caveat) builder state ──
  const [targetWhitelistEnabled, setTargetWhitelistEnabled] = useState(false);
  const [targetWhitelistAddress, setTargetWhitelistAddress] = useState("");
  const [spendLimitEnabled, setSpendLimitEnabled] = useState(false);
  const [spendLimitToken, setSpendLimitToken] = useState("");
  const [spendLimitAmount, setSpendLimitAmount] = useState("");
  const [spendLimitPeriod, setSpendLimitPeriod] = useState("86400");
  const [timeRestrictionEnabled, setTimeRestrictionEnabled] = useState(false);
  const [timeStart, setTimeStart] = useState("");
  const [timeExpiry, setTimeExpiry] = useState("");

  const checkSmartWalletBalance = async (address: string) => {
    if (!connectedWallet) return;
    try {
      const balance = await fetchSmartWalletBalance(
        address,
        connectedWallet.networkPassphrase,
        connectedWallet.sorobanRpcUrl
      );
      setSmartWalletBalance(balance);
    } catch {
      // Balance check is best-effort; deployment already succeeded.
    }
  };

  const handleDeployWallet = async () => {
    if (!walletOwner || !connectedWallet) {
      setError("Connect your Freighter wallet before deploying a smart wallet.");
      return;
    }
    setDeployingWallet(true);
    setError(null);
    try {
      // 1. Server builds the sponsored deploy (funder pays fees) and returns the
      // unsigned authorization entry the owner address must sign.
      const prepareRes = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "PREPARE_WALLET_DEPLOY",
          owner: walletOwner,
        }),
      });
      const prepared = await prepareRes.json();
      if (!prepareRes.ok) throw new Error(prepared.error);

      // 2. Freighter signs just the auth entry — the connected wallet authorizes its
      // own participation but pays nothing; the funder still covers all fees.
      const signedEntryXdr = await signAuthEntryWithFreighter(
        prepared.unsignedEntryXdr,
        prepared.validUntilLedgerSeq,
        connectedWallet.networkPassphrase,
        walletOwner
      );

      // 3. Server splices the signed entry back in and submits (funder-signed tx).
      const submitRes = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "SUBMIT_WALLET_DEPLOY",
          owner: walletOwner,
          saltHex: prepared.saltHex,
          signedEntryXdr,
        }),
      });
      const data = await submitRes.json();
      if (!submitRes.ok) throw new Error(data.error);
      setSmartWalletAddress(data.smartWalletAddress);
      await checkSmartWalletBalance(data.smartWalletAddress);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeployingWallet(false);
    }
  };

  const handleCreateDelegation = async () => {
    if (!smartWalletAddress) return;
    setError(null);
    setCreatingDelegation(true);
    setDelegationDisabled(null);
    try {
      const policies: Record<string, unknown>[] = [];
      if (targetWhitelistEnabled && targetWhitelistAddress) {
        policies.push({ type: "target-whitelist", target: targetWhitelistAddress });
      }
      if (spendLimitEnabled && spendLimitAmount) {
        policies.push({
          type: "spend-limit",
          token:
            spendLimitToken ||
            Asset.native().contractId(
              connectedWallet?.networkPassphrase ?? "Test SDF Network ; September 2015"
            ),
          spendLimit: spendLimitAmount,
          period: spendLimitPeriod,
        });
      }
      if (timeRestrictionEnabled && timeStart && timeExpiry) {
        policies.push({ type: "time-restriction", start: timeStart, expiry: timeExpiry });
      }

      const res = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CREATE_DELEGATION",
          // The delegate is the entity permitted to redeem this delegation on-chain
          // (the smart wallet just deployed). The delegator is derived server-side
          // from FUNDER_SECRET_KEY, since that's the only key that can produce a
          // signature the DelegationManager contract will accept.
          delegate: smartWalletAddress,
          policies,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDelegationHash(data.hash);
      await checkDelegationStatus(data.hash);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingDelegation(false);
    }
  };

  const checkDelegationStatus = async (hash: string) => {
    try {
      const res = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "DELEGATION_STATUS", hash }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDelegationDisabled(Boolean(data.disabled));
    } catch {
      // Status check is best-effort; delegation creation already succeeded.
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* ── Left column ── */}
      <div className="space-y-5">
        <DelegationKit
          onWalletChange={setConnectedWallet}
          defaultDestination={smartWalletAddress ?? undefined}
        />

        {/* On-chain delegation card */}
        <div className="rounded-2xl border border-border bg-bg-card p-5">
          <h3 className="mb-4 font-display text-base font-semibold">
            On-Chain Delegation
          </h3>
          <div className="space-y-3">
            {!smartWalletAddress ? (
              <div>
                <p className="mb-2 text-xs text-text-muted">
                  {walletOwner
                    ? "Deploy a smart wallet to create on-chain delegations."
                    : "Connect your Freighter wallet above, then deploy a smart wallet to create on-chain delegations."}
                </p>
                <button
                  onClick={handleDeployWallet}
                  disabled={deployingWallet || !walletOwner}
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
                  <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-text-muted">
                      Balance
                    </span>
                    <span className="flex items-center gap-2 font-mono text-xs">
                      {smartWalletBalance !== null
                        ? `${smartWalletBalance} XLM`
                        : "—"}
                      <button
                        onClick={() => checkSmartWalletBalance(smartWalletAddress)}
                        className="text-accent hover:text-accent-hover"
                      >
                        Refresh
                      </button>
                    </span>
                  </div>
                </div>
                {/* Policy (caveat) builder */}
                <div className="space-y-2 rounded-xl bg-bg-elevated p-3">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted">
                    Policies
                  </p>

                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={targetWhitelistEnabled}
                      onChange={(e) => setTargetWhitelistEnabled(e.target.checked)}
                    />
                    Target whitelist
                  </label>
                  {targetWhitelistEnabled && (
                    <input
                      type="text"
                      placeholder="Allowed target address (G... or C...)"
                      value={targetWhitelistAddress}
                      onChange={(e) => setTargetWhitelistAddress(e.target.value)}
                      className="w-full rounded-lg border border-border bg-bg-card px-2 py-1.5 font-mono text-xs"
                    />
                  )}

                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={spendLimitEnabled}
                      onChange={(e) => setSpendLimitEnabled(e.target.checked)}
                    />
                    Spend limit
                  </label>
                  {spendLimitEnabled && (
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="text"
                        placeholder="Token (default: XLM)"
                        value={spendLimitToken}
                        onChange={(e) => setSpendLimitToken(e.target.value)}
                        className="col-span-3 rounded-lg border border-border bg-bg-card px-2 py-1.5 font-mono text-xs"
                      />
                      <input
                        type="text"
                        placeholder="Limit (stroops)"
                        value={spendLimitAmount}
                        onChange={(e) => setSpendLimitAmount(e.target.value)}
                        className="col-span-2 rounded-lg border border-border bg-bg-card px-2 py-1.5 font-mono text-xs"
                      />
                      <input
                        type="text"
                        placeholder="Period (s)"
                        value={spendLimitPeriod}
                        onChange={(e) => setSpendLimitPeriod(e.target.value)}
                        className="rounded-lg border border-border bg-bg-card px-2 py-1.5 font-mono text-xs"
                      />
                    </div>
                  )}

                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={timeRestrictionEnabled}
                      onChange={(e) => setTimeRestrictionEnabled(e.target.checked)}
                    />
                    Time restriction
                  </label>
                  {timeRestrictionEnabled && (
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        placeholder="Start (unix)"
                        value={timeStart}
                        onChange={(e) => setTimeStart(e.target.value)}
                        className="rounded-lg border border-border bg-bg-card px-2 py-1.5 font-mono text-xs"
                      />
                      <input
                        type="text"
                        placeholder="Expiry (unix)"
                        value={timeExpiry}
                        onChange={(e) => setTimeExpiry(e.target.value)}
                        className="rounded-lg border border-border bg-bg-card px-2 py-1.5 font-mono text-xs"
                      />
                    </div>
                  )}
                </div>

                <button
                  onClick={handleCreateDelegation}
                  disabled={creatingDelegation}
                  className="w-full rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
                >
                  {creatingDelegation ? "Creating..." : "Create Delegation"}
                </button>
                {delegationHash && (
                  <div className="rounded-xl bg-success/10 border border-success/20 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-mono uppercase tracking-widest text-success">
                        Delegation Hash
                      </p>
                      {delegationDisabled !== null && (
                        <span
                          className={`text-[10px] font-mono uppercase tracking-widest ${
                            delegationDisabled ? "text-error" : "text-success"
                          }`}
                        >
                          {delegationDisabled ? "Disabled" : "Active"}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 font-mono text-xs text-success">
                      {delegationHash}
                    </p>
                    <button
                      onClick={() => checkDelegationStatus(delegationHash)}
                      className="mt-1 text-[11px] text-accent hover:text-accent-hover"
                    >
                      Refresh status
                    </button>
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
