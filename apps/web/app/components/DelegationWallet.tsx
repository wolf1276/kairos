"use client";

import { useState } from "react";

const WALLET_ICON = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="1" y="5" width="22" height="14" rx="2" ry="2" />
    <circle cx="17" cy="12" r="1.5" fill="currentColor" />
  </svg>
);

const PLUS_ICON = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export default function DelegationWallet() {
  const [balance, setBalance] = useState(0);
  const [inputAmount, setInputAmount] = useState("");
  const [transactions, setTransactions] = useState<
    { type: "deposit" | "delegation"; amount: number; timestamp: Date }[]
  >([]);

  const handleDelegate = () => {
    const amount = parseFloat(inputAmount);
    if (isNaN(amount) || amount <= 0) return;

    setBalance((prev) => prev + amount);
    setTransactions((prev) => [
      { type: "deposit", amount, timestamp: new Date() },
      ...prev,
    ]);
    setInputAmount("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleDelegate();
  };

  const formatTime = (date: Date) =>
    date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      {/* Header */}
      <div className="mb-5 flex items-center gap-2">
        <span className="rounded-lg bg-emerald-100 p-2 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400">
          {WALLET_ICON}
        </span>
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Delegation Wallet
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Fund your paper trading agent
          </p>
        </div>
      </div>

      {/* Balance Display */}
      <div className="mb-5 rounded-xl border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-800/50">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Available Balance
        </p>
        <p className="mt-1 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          ${balance.toFixed(2)}
        </p>
        <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
          {transactions.length > 0
            ? `${transactions.length} delegation${transactions.length === 1 ? "" : "s"} made`
            : "No funds delegated yet"}
        </p>
      </div>

      {/* Delegate Input */}
      <div className="mb-5">
        <label
          htmlFor="delegate-amount"
          className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Delegate Funds
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-zinc-400">
              $
            </span>
            <input
              id="delegate-amount"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={inputAmount}
              onChange={(e) => setInputAmount(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full rounded-lg border border-zinc-200 bg-white py-2.5 pl-7 pr-3 text-sm text-zinc-900 placeholder-zinc-400 transition-colors focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:border-emerald-400 dark:focus:ring-emerald-400/20"
            />
          </div>
          <button
            onClick={handleDelegate}
            disabled={!inputAmount || parseFloat(inputAmount) <= 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-emerald-500 dark:hover:bg-emerald-600"
          >
            {PLUS_ICON}
            Delegate
          </button>
        </div>
        {/* Quick-amount chips */}
        <div className="mt-2 flex gap-1.5">
          {[5, 10, 25, 100].map((amt) => (
            <button
              key={amt}
              onClick={() => setInputAmount(amt.toString())}
              className="rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors hover:border-emerald-300 hover:text-emerald-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-emerald-600 dark:hover:text-emerald-400"
            >
              ${amt}
            </button>
          ))}
        </div>
      </div>

      {/* Transaction History */}
      {transactions.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Recent Delegations
          </p>
          <div className="space-y-1">
            {transactions.slice(0, 5).map((tx, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
              >
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  <span className="text-zinc-700 dark:text-zinc-300">
                    Delegate
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    +${tx.amount.toFixed(2)}
                  </span>
                  <span className="text-xs text-zinc-400">
                    {formatTime(tx.timestamp)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
