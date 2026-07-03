"use client";

import { useState } from "react";
import { useWalletContext } from "@/app/contexts/WalletContext";
import { useSmartWalletBalances } from "@/app/hooks/useSmartWalletBalances";
import { fetchAccountBalances, delegateXLM, withdrawFromSmartWallet } from "@/app/lib/stellar";
import { useEffect } from "react";

function shortAddress(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export default function DashboardOverview() {
  const {
    wallet,
    connected,
    connecting,
    connect,
    checked,
    walletOwner,
    smartWalletAddress,
    deploySmartWallet,
    deploying,
    deployError,
  } = useWalletContext();

  const [userXlmBalance, setUserXlmBalance] = useState<number | null>(null);
  const [userBalanceError, setUserBalanceError] = useState<string | null>(null);

  const {
    xlmBalance: capitalXlmBalance,
    usdcBalance: capitalUsdcBalance,
    refresh: refreshCapitalBalance,
  } = useSmartWalletBalances(smartWalletAddress, wallet?.networkPassphrase ?? null, wallet?.sorobanRpcUrl);

  useEffect(() => {
    if (!walletOwner || !wallet) return;
    let cancelled = false;
    fetchAccountBalances(walletOwner, wallet.networkPassphrase)
      .then((balances) => {
        if (cancelled) return;
        const native = balances.find((b) => b.code === "XLM");
        setUserXlmBalance(native ? parseFloat(native.balance) : 0);
      })
      .catch((e) => !cancelled && setUserBalanceError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [walletOwner, wallet]);

  const [amount, setAmount] = useState("");
  const [txPending, setTxPending] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);

  const handleFund = async () => {
    if (!smartWalletAddress || !wallet || !amount) return;
    setTxPending(true);
    setTxError(null);
    try {
      await delegateXLM(amount, smartWalletAddress, wallet.networkPassphrase, wallet.sorobanRpcUrl);
      setAmount("");
      await refreshCapitalBalance();
    } catch (e) {
      setTxError(e instanceof Error ? e.message : String(e));
    } finally {
      setTxPending(false);
    }
  };

  const handleWithdraw = async () => {
    if (!smartWalletAddress || !wallet || !amount) return;
    setTxPending(true);
    setTxError(null);
    try {
      await withdrawFromSmartWallet(smartWalletAddress, amount, wallet.networkPassphrase, wallet.sorobanRpcUrl);
      setAmount("");
      await refreshCapitalBalance();
    } catch (e) {
      setTxError(e instanceof Error ? e.message : String(e));
    } finally {
      setTxPending(false);
    }
  };

  if (!checked) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="max-w-sm rounded-2xl border border-white/[0.06] bg-bg-card p-8 text-center">
          <h2 className="font-display text-base font-medium text-text-primary">Connect your wallet</h2>
          <p className="mt-2 text-xs text-text-muted">
            Connect Freighter to view your portfolio, delegations, and agents.
          </p>
          <button
            onClick={() => connect()}
            disabled={connecting}
            className="mt-5 w-full rounded-xl bg-accent/80 px-4 py-2.5 text-xs font-semibold text-white transition-all duration-300 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            {connecting ? "Connecting…" : "Connect Freighter"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="font-display text-lg font-medium text-text-primary">Wallets</h1>

      <div className="rounded-2xl border border-white/[0.06] bg-bg-card p-5">
        <h3 className="font-display text-sm font-medium text-text-primary">User Wallet</h3>
        <p className="mt-1 text-xs text-text-muted">{walletOwner ? shortAddress(walletOwner) : "—"}</p>
        <p className="mt-3 text-2xl font-semibold text-text-primary">
          {userXlmBalance != null ? `${userXlmBalance.toFixed(4)} XLM` : userBalanceError ? "—" : "Loading…"}
        </p>
      </div>

      <div className="rounded-2xl border border-white/[0.06] bg-bg-card p-5">
        <h3 className="font-display text-sm font-medium text-text-primary">Capital Wallet</h3>
        {smartWalletAddress ? (
          <>
            <p className="mt-1 text-xs text-text-muted">{shortAddress(smartWalletAddress)}</p>
            <p className="mt-3 text-2xl font-semibold text-text-primary">
              {capitalXlmBalance.toFixed(4)} XLM
            </p>
            <p className="mt-1 text-xs text-text-muted">{capitalUsdcBalance.toFixed(2)} USDC</p>

            <div className="mt-5 flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="0.0001"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Amount (XLM)"
                className="w-full rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:outline-none"
              />
              <button
                onClick={handleFund}
                disabled={txPending || !amount}
                className="whitespace-nowrap rounded-xl bg-accent/80 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                {txPending ? "Processing…" : "Add Funds"}
              </button>
              <button
                onClick={handleWithdraw}
                disabled={txPending || !amount}
                className="whitespace-nowrap rounded-xl border border-white/5 bg-white/[0.02] px-4 py-2 text-xs text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                {txPending ? "Processing…" : "Withdraw"}
              </button>
            </div>
            {txError && <p className="mt-2 text-xs text-error/90">{txError}</p>}
          </>
        ) : (
          <>
            <p className="mt-2 text-xs text-text-muted">No capital wallet deployed yet.</p>
            <button
              onClick={() => deploySmartWallet()}
              disabled={deploying}
              className="mt-4 rounded-xl bg-accent/80 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              {deploying ? "Creating…" : "Create Capital Wallet"}
            </button>
            {deployError && <p className="mt-2 text-xs text-error/90">{deployError}</p>}
          </>
        )}
      </div>
    </div>
  );
}
