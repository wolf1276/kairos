"use client";

import { useCallback, useEffect, useState } from "react";
import { Asset } from "@stellar/stellar-sdk";
import { Card, CardHeader, CardBody } from "@/app/components/ui/Card";
import { Badge } from "@/app/components/ui/Badge";
import { Spinner } from "@/app/components/ui/Spinner";
import { useSmartWallet } from "@/app/hooks/useSmartWallet";
import { signDelegationHashWithFreighter } from "@/app/lib/stellar";
import {
  createAgentWallet,
  attachAgentDelegation,
  setAgentStrategy,
  startAgentWallet,
  listStrategies,
  type StrategyMeta,
} from "@/app/lib/agentsBackend";
import { LiveTradeCard } from "./components/LiveTradeCard";

const INPUT_CLS =
  "w-full rounded-lg border border-white/5 bg-bg-elevated px-2.5 py-1.5 font-mono text-xs text-text-primary transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30";

function shortKey(key: string) {
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

type WizardStep = "pick-strategy" | "configure" | "delegation" | "starting" | "live";

export default function StrategyModePage() {
  const {
    wallet,
    connected,
    connecting,
    connect,
    walletOwner,
    smartWallets,
    deploying,
    deployError,
    deployAnotherSmartWallet,
  } = useSmartWallet();
  const networkPassphrase = wallet?.networkPassphrase ?? "Test SDF Network ; September 2015";

  const [strategies, setStrategies] = useState<StrategyMeta[]>([]);
  const [loadingStrategies, setLoadingStrategies] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    listStrategies()
      .then(setStrategies)
      .catch((e) => setListError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingStrategies(false));
  }, []);

  const [selectedStrategy, setSelectedStrategy] = useState<StrategyMeta | null>(null);
  const [step, setStep] = useState<WizardStep>("pick-strategy");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveAgentId, setLiveAgentId] = useState<string | null>(null);

  // ── Config form state ──
  const [amountPerTrade, setAmountPerTrade] = useState("10");
  const [intervalMinutes, setIntervalMinutes] = useState("15");
  const [selectedWallet, setSelectedWallet] = useState(smartWallets[0] ?? "");

  useEffect(() => {
    if (!selectedWallet && smartWallets.length > 0) setSelectedWallet(smartWallets[0]);
  }, [smartWallets, selectedWallet]);

  const grouped = strategies.reduce<Record<string, StrategyMeta[]>>((acc, s) => {
    (acc[s.category] ??= []).push(s);
    return acc;
  }, {});

  const handlePickStrategy = (s: StrategyMeta) => {
    setSelectedStrategy(s);
    setStep("configure");
  };

  const handleDeployAnother = async () => {
    setBusy(true);
    setError(null);
    const address = await deployAnotherSmartWallet();
    if (address) setSelectedWallet(address);
    else setError("Failed to deploy a new smart wallet");
    setBusy(false);
  };

  // Creates the agent, attaches a delegation from the selected smart wallet, configures the
  // quant strategy, and starts it — mirrors the same create/attach flow used by
  // app/dashboard/agents/page.tsx, collapsed into one continuous action for Strategy Mode.
  const handleLaunch = async () => {
    if (!walletOwner || !selectedStrategy || !selectedWallet) return;
    const amt = parseFloat(amountPerTrade) || 0;
    if (amt <= 0) {
      setError("Enter a valid amount per trade");
      return;
    }
    setBusy(true);
    setError(null);
    setStep("delegation");
    try {
      const agent = await createAgentWallet(walletOwner);

      const prepareRes = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "PREPARE_DELEGATION",
          delegate: agent.publicKey,
          delegator: selectedWallet,
          policies: [
            {
              type: "spend-limit",
              token: Asset.native().contractId(networkPassphrase),
              spendLimit: BigInt(Math.round(amt * 10_000_000 * 100)).toString(),
              period: String(86400),
            },
          ],
        }),
      });
      const prepared = await prepareRes.json();
      if (!prepareRes.ok) throw new Error(prepared.error);

      const signatureHex = await signDelegationHashWithFreighter(prepared.hashHex, networkPassphrase, walletOwner);

      const submitRes = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SUBMIT_DELEGATION", unsignedDelegation: prepared.unsignedDelegation, signatureHex }),
      });
      const submitted = await submitRes.json();
      if (!submitRes.ok) throw new Error(submitted.error);

      await attachAgentDelegation(agent.id, submitted.delegation);

      setStep("starting");
      await setAgentStrategy(agent.id, {
        type: "quant",
        strategyId: selectedStrategy.id,
        pair: "XLM/USDC",
        amountPerTrade: (BigInt(Math.round(amt * 10_000_000))).toString(),
        intervalSeconds: Math.max(60, Math.round((parseFloat(intervalMinutes) || 15) * 60)),
      });
      await startAgentWallet(agent.id);

      setLiveAgentId(agent.id);
      setStep("live");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("configure");
    } finally {
      setBusy(false);
    }
  };

  const handleReset = () => {
    setLiveAgentId(null);
    setSelectedStrategy(null);
    setStep("pick-strategy");
    setError(null);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-lg font-medium text-text-primary">Strategy Mode</h1>
        <p className="mt-1 text-xs text-text-muted">
          Pick one of {strategies.length || "25+"} quant strategies, launch it as a live on-chain
          agent trading XLM/USDC on the Stellar testnet DEX from its own account, and watch its
          trades, P&L, and audit trail in real time.
        </p>
      </div>

      {!connected ? (
        <Card>
          <CardBody className="text-center">
            <p className="mb-3 text-xs text-text-muted">Connect Freighter to launch a strategy.</p>
            <button
              onClick={connect}
              disabled={connecting}
              className="rounded-xl bg-accent/70 px-4 py-2 text-xs font-semibold text-white transition-all duration-300 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {connecting ? "Connecting…" : "Connect Freighter"}
            </button>
          </CardBody>
        </Card>
      ) : smartWallets.length === 0 ? (
        <Card>
          <CardBody className="text-center">
            <p className="text-xs text-text-muted">
              {deploying ? "Deploying your smart wallet…" : "Your smart wallet hasn't finished deploying yet."}
            </p>
            {deployError && <p className="mt-2 text-xs text-error/90">{deployError}</p>}
          </CardBody>
        </Card>
      ) : step === "live" && liveAgentId ? (
        <div className="space-y-3">
          <button onClick={handleReset} className="text-xs text-accent/70 hover:text-accent">
            ← Launch another strategy
          </button>
          <LiveTradeCard agentId={liveAgentId} strategies={strategies} />
        </div>
      ) : step === "pick-strategy" ? (
        <>
          {listError && (
            <div className="rounded-xl border border-error/15 bg-error/6 px-4 py-3">
              <p className="text-xs text-error/90">{listError}</p>
            </div>
          )}
          {loadingStrategies ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-2xl bg-bg-elevated/60" />
              ))}
            </div>
          ) : (
            Object.entries(grouped).map(([category, items]) => (
              <div key={category} className="space-y-2">
                <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted">{category}</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((s) => (
                    <button key={s.id} onClick={() => handlePickStrategy(s)} className="text-left">
                      <Card className="h-full transition-colors hover:bg-white/[0.03]">
                        <CardBody className="space-y-1.5 p-4">
                          <p className="text-sm font-medium text-text-primary">{s.name}</p>
                          <p className="text-xs text-text-muted">{s.description}</p>
                        </CardBody>
                      </Card>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </>
      ) : (
        <Card>
          <CardHeader
            title={selectedStrategy?.name ?? ""}
            action={<Badge tone="accent">{selectedStrategy?.category}</Badge>}
          />
          <CardBody className="space-y-4 pt-4">
            {error && (
              <div className="rounded-xl border border-error/15 bg-error/6 px-3 py-2">
                <p className="text-xs text-error/90">{error}</p>
              </div>
            )}
            <p className="text-xs text-text-muted">{selectedStrategy?.description}</p>

            <div>
              <label className="mb-1 block text-[10px] text-text-muted">Wallet this agent trades for</label>
              <select value={selectedWallet} onChange={(e) => setSelectedWallet(e.target.value)} className={INPUT_CLS}>
                {smartWallets.map((w) => (
                  <option key={w} value={w}>{shortKey(w)}</option>
                ))}
              </select>
              <button
                onClick={handleDeployAnother}
                disabled={busy}
                className="mt-1.5 text-[10px] text-accent/70 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                + Deploy another smart wallet
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[10px] text-text-muted">Pair</label>
                <input value="XLM/USDC" disabled className={INPUT_CLS} />
              </div>
              <div>
                <label className="mb-1 block text-[10px] text-text-muted">Amount per trade (XLM)</label>
                <input
                  value={amountPerTrade}
                  onChange={(e) => setAmountPerTrade(e.target.value)}
                  className={INPUT_CLS}
                  type="number"
                  min="0"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-text-muted">Check interval (minutes)</label>
              <input
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(e.target.value)}
                className={INPUT_CLS}
                type="number"
                min="1"
              />
            </div>

            <p className="text-[10px] text-text-muted">
              This creates a dedicated agent wallet, delegates a spend limit from{" "}
              <span className="font-mono">{selectedWallet ? shortKey(selectedWallet) : "your wallet"}</span>, and
              starts it trading on this strategy's signal immediately.
            </p>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setStep("pick-strategy")}
                disabled={busy}
                className="flex-1 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                Back
              </button>
              <button
                onClick={handleLaunch}
                disabled={busy || !selectedWallet}
                className="flex-[2] rounded-xl bg-accent/80 px-4 py-2 text-xs font-semibold text-white transition-all duration-300 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? (
                  <span className="flex items-center justify-center gap-2">
                    <Spinner className="h-3 w-3" />
                    {step === "delegation" ? "Signing delegation…" : "Starting agent…"}
                  </span>
                ) : (
                  "Launch Strategy"
                )}
              </button>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
