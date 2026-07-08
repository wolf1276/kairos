"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/app/components/ui/Badge";
import { useWalletContext } from "@/app/contexts/WalletContext";
import { useSmartWalletBalances } from "@/app/hooks/useSmartWalletBalances";
import { withdrawFromSmartWallet } from "@/app/lib/stellar";

function shortAddress(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function explorerUrl(address: string, isTestnet: boolean) {
  return `https://stellar.expert/explorer/${isTestnet ? "testnet" : "public"}/contract/${address}`;
}

/** Real-data replacement for the old static Smart Wallet card: address, balance, network,
 *  deployment status, and wired Copy/Explorer/Deposit/Withdraw actions. Deploy-if-missing
 *  reuses the same `deploySmartWallet` onboarding path other pages already call — no new
 *  backend surface. */
export function SmartWalletPanel() {
  const { connected, wallet, smartWalletAddress, deploying, deployError, deploySmartWallet } = useWalletContext();
  const { xlmBalance, usdcBalance, loading: balanceLoading, error: balanceError, refresh } = useSmartWalletBalances(
    smartWalletAddress,
    wallet?.networkPassphrase ?? null,
    wallet?.sorobanRpcUrl
  );

  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const refreshAll = useCallback(() => {
    if (smartWalletAddress) refresh();
  }, [smartWalletAddress, refresh]);

  // Refresh whenever another part of the app deploys/funds/delegates against this wallet —
  // agents/delegation pages dispatch this after their own mutations settle.
  useEffect(() => {
    window.addEventListener("kairos:smart-wallet-changed", refreshAll);
    return () => window.removeEventListener("kairos:smart-wallet-changed", refreshAll);
  }, [refreshAll]);

  const copyAddress = async () => {
    if (!smartWalletAddress) return;
    await navigator.clipboard.writeText(smartWalletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!connected) {
    return (
      <div className="flex h-full flex-col p-6">
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">Smart Wallet</p>
        <p className="mt-2 font-display text-2xl font-bold text-text-primary">Connect Wallet</p>
      </div>
    );
  }

  if (!smartWalletAddress) {
    return (
      <div className="flex h-full flex-col p-6">
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">Smart Wallet</p>
        <p className="mt-2 text-sm text-text-muted">No Smart Wallet Found</p>
        {deployError && <p className="mt-2 text-xs text-red-400">{deployError}</p>}
        <button
          onClick={() => deploySmartWallet().then(refreshAll)}
          disabled={deploying}
          className="mt-auto rounded-lg bg-accent-hover px-3 py-2 text-xs font-semibold text-black transition-colors hover:bg-accent-hover/90 disabled:opacity-50"
        >
          {deploying ? "Deploying…" : "Create Smart Wallet"}
        </button>
      </div>
    );
  }

  if (balanceError && xlmBalance === 0 && usdcBalance === 0) {
    return (
      <div className="flex h-full flex-col p-6">
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">Smart Wallet</p>
        <p className="mt-2 text-sm text-red-400">Failed to load smart wallet balance.</p>
        <button
          onClick={refreshAll}
          className="mt-auto rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-white/[0.04]"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-6">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">Smart Wallet</p>
        <Badge tone="success">Active</Badge>
      </div>

      {balanceLoading && xlmBalance === 0 && usdcBalance === 0 ? (
        <div className="mt-2 flex flex-col gap-2">
          <div className="h-8 w-32 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-3 w-20 animate-pulse rounded bg-white/[0.06]" />
        </div>
      ) : (
        <>
          <p className="mt-2 font-display text-3xl font-bold tabular-nums text-text-primary">
            {`${xlmBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })} XLM`}
          </p>
          <p className="text-xs text-text-muted">
            {`${usdcBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`}
          </p>
        </>
      )}

      <div className="mt-3 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="font-mono text-text-secondary">{shortAddress(smartWalletAddress)}</span>
          <button onClick={copyAddress} className="text-text-muted transition-colors hover:text-text-primary" aria-label="Copy address">
            {copied ? "Copied" : "Copy"}
          </button>
          <a
            href={explorerUrl(smartWalletAddress, !!wallet?.isTestnet)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-text-muted transition-colors hover:text-text-primary"
          >
            Explorer
          </a>
        </div>
        <Badge tone="accent">{wallet?.isTestnet ? "Testnet" : "Mainnet"}</Badge>
      </div>

      <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
        <button
          onClick={() => setDepositOpen(true)}
          className="rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-white/[0.04]"
        >
          Deposit
        </button>
        <button
          onClick={() => setWithdrawOpen(true)}
          className="rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-white/[0.04]"
        >
          Withdraw
        </button>
      </div>

      {depositOpen && (
        <DepositModal
          address={smartWalletAddress}
          onClose={() => setDepositOpen(false)}
          onRefresh={refreshAll}
        />
      )}
      {withdrawOpen && wallet && (
        <WithdrawModal
          smartWalletAddress={smartWalletAddress}
          destination={wallet.address}
          networkPassphrase={wallet.networkPassphrase}
          sorobanRpcUrl={wallet.sorobanRpcUrl}
          onClose={() => setWithdrawOpen(false)}
          onSuccess={() => {
            setWithdrawOpen(false);
            refreshAll();
            window.dispatchEvent(new Event("kairos:smart-wallet-changed"));
          }}
        />
      )}
    </div>
  );
}

function DepositModal({
  address,
  onClose,
  onRefresh,
}: {
  address: string;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0b0b0f] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-semibold text-white">Deposit</h2>
        <p className="mb-2 text-xs text-white/50">Send XLM or USDC to your smart wallet address:</p>
        <div className="mb-4 break-all rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-xs text-white/80">
          {address}
        </div>
        <div className="flex gap-2">
          <button
            onClick={copy}
            className="flex-1 rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-white/70 transition-colors hover:bg-white/[0.04]"
          >
            {copied ? "Copied" : "Copy Address"}
          </button>
          <button
            onClick={() => {
              onRefresh();
              onClose();
            }}
            className="flex-1 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-black transition-colors hover:bg-white/90"
          >
            Refresh Balance
          </button>
        </div>
      </div>
    </div>
  );
}

function WithdrawModal({
  smartWalletAddress,
  destination,
  networkPassphrase,
  sorobanRpcUrl,
  onClose,
  onSuccess,
}: {
  smartWalletAddress: string;
  destination: string;
  networkPassphrase: string;
  sorobanRpcUrl?: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [to, setTo] = useState(destination);
  const [amount, setAmount] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await withdrawFromSmartWallet(smartWalletAddress, amount, networkPassphrase, sorobanRpcUrl, to);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0b0b0f] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-semibold text-white">Withdraw</h2>

        {error && (
          <p className="mb-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>
        )}

        {!confirming ? (
          <>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-white/40">Destination</label>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mb-3 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-xs text-white/80"
            />
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-white/40">Amount (XLM)</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              type="number"
              min="0"
              className="mb-4 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-xs text-white/80"
            />
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-white/60 transition-colors hover:bg-white/[0.04]"
              >
                Cancel
              </button>
              <button
                onClick={() => setConfirming(true)}
                disabled={!to || !amount || parseFloat(amount) <= 0}
                className="flex-1 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-black transition-colors hover:bg-white/90 disabled:opacity-50"
              >
                Continue
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mb-4 text-xs text-white/60">
              Send <span className="font-mono text-white">{amount} XLM</span> to{" "}
              <span className="font-mono text-white">{to.slice(0, 6)}…{to.slice(-6)}</span>?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirming(false)}
                disabled={submitting}
                className="flex-1 rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-white/60 transition-colors hover:bg-white/[0.04] disabled:opacity-50"
              >
                Back
              </button>
              <button
                onClick={submit}
                disabled={submitting}
                className="flex-1 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-black transition-colors hover:bg-white/90 disabled:opacity-50"
              >
                {submitting ? "Confirming…" : "Confirm Withdraw"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
