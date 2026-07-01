"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import DelegationKit from "@/app/components/DelegationKit";
import TerminalTicker from "@/app/components/TerminalTicker";

type Tab = "trade" | "portfolio" | "delegations";
type AutomationMode = "AI_MANAGED" | "STRATEGY_MANAGED" | "AUTONOMOUS_AI";

interface Proposal {
  action: string; symbol: string; amount: number; confidence: number;
  reasoning: string; stopLoss?: number; takeProfit?: number; timestamp: number;
}

interface PortfolioData {
  balance: number;
  positions: { symbol: string; amount: number; entryPrice: number }[];
  totalValue: number; unrealizedPnL: number;
}

interface TradeRecord {
  id: string; symbol: string; action: string; amount: number;
  price: number; timestamp: number; pnl?: number;
}

interface IntentProfile {
  goal?: string; riskTolerance?: string; investmentHorizon?: string;
  allowedAssets?: string[]; dailyTradeLimit?: number;
}

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "XLMUSDT", "SOLUSDT", "ADAUSDT"];

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<Tab>("trade");
  const [symbol, setSymbol] = useState("XLMUSDT");
  const [automationMode, setAutomationMode] = useState<AutomationMode>("AI_MANAGED");
  const [intentText, setIntentText] = useState("");
  const [parsedIntent, setParsedIntent] = useState<IntentProfile | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [proposalLoading, setProposalLoading] = useState(false);
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null);
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [executing, setExecuting] = useState(false);
  const [execResult, setExecResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // SDK delegation state
  const [smartWalletAddress, setSmartWalletAddress] = useState<string | null>(null);
  const [walletOwner] = useState<string | null>(null);
  const [deployingWallet, setDeployingWallet] = useState(false);
  const [delegationHash, setDelegationHash] = useState<string | null>(null);
  const [onchainMode, setOnchainMode] = useState(false);

  const fetchPortfolio = useCallback(async () => {
    try {
      const res = await fetch("/api/portfolio");
      if (res.ok) { const d = await res.json(); setPortfolio(d); }
    } catch {}
  }, []);

  const fetchTrades = useCallback(async () => {
    try {
      const res = await fetch("/api/trades");
      if (res.ok) { const d = await res.json(); setTrades(d.slice(0, 10)); }
    } catch {}
  }, []);

  useEffect(() => {
    const init = async () => { await Promise.all([fetchPortfolio(), fetchTrades()]); };
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const interval = setInterval(fetchPortfolio, 30000);
    return () => clearInterval(interval);
  }, [fetchPortfolio]);

  const handleParseIntent = useCallback(async () => {
    if (!intentText.trim()) return;
    try {
      const res = await fetch("/api/intent/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: intentText }),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.profile) setParsedIntent(d.profile);
      }
    } catch {}
  }, [intentText]);

  const handleDeployWallet = async () => {
    setDeployingWallet(true); setError(null);
    try {
      const res = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "DEPLOY_WALLET", owner: walletOwner || "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSmartWalletAddress(data.smartWalletAddress);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setDeployingWallet(false); }
  };

  const handleCreateDelegation = async () => {
    if (!smartWalletAddress) return; setError(null);
    try {
      const res = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CREATE_DELEGATION",
          delegator: smartWalletAddress,
          delegate: walletOwner || "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
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

  const handleAnalyze = async () => {
    setProposalLoading(true); setError(null); setProposal(null);
    if (intentText.trim()) await handleParseIntent();
    const body: Record<string, unknown> = { symbol, automationMode };
    if (parsedIntent) body.tradingProfile = parsedIntent;
    else if (intentText.trim()) body.tradingProfile = { intentText };

    try {
      const res = await fetch("/api/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))).error) || "Analysis failed");
      setProposal(await res.json());
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setProposalLoading(false); }
  };

  const handleExecute = async () => {
    if (!proposal || proposal.action === "HOLD") return;
    setExecuting(true); setExecResult(null); setError(null);

    const tradeAmount = Math.abs(proposal.amount);
    try {
      if (onchainMode && smartWalletAddress) {
        const res = await fetch("/api/delegate-sdk", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "EXECUTE",
            delegation: { delegate: walletOwner, delegator: smartWalletAddress, caveats: [], salt: 0, nonce: 0, signature: "00".repeat(64) },
            redeemer: walletOwner,
            target: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
            function: "transfer",
            args: [],
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setExecResult(`On-chain ${proposal.action} executed. Tx: ${data.txHash?.slice(0, 16)}...`);
      } else {
        const res = await fetch("/api/paper-trade", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: proposal.action, symbol: proposal.symbol, amount: tradeAmount, price: undefined }),
        });
        if (!res.ok) throw new Error(((await res.json().catch(() => ({}))).error) || "Execution failed");
        const data = await res.json();
        setExecResult(`${proposal.action} ${tradeAmount.toFixed(4)} ${proposal.symbol} at $${data.trade?.price?.toFixed(4) || "market"}`);
        await Promise.all([fetchPortfolio(), fetchTrades()]);
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setExecuting(false); }
  };

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <header className="sticky top-0 z-50 border-b border-border bg-bg-primary/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <Image src="/logo.png" alt="Kairos" width={28} height={28} className="opacity-80" />
            <span className="text-sm font-medium tracking-[0.3em] uppercase text-white/80">Kairos</span>
          </div>
          <nav className="flex items-center gap-1">
            {(["trade", "portfolio", "delegations"] as Tab[]).map((tab) => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                  activeTab === tab ? "bg-accent-muted text-accent" : "text-text-muted hover:text-text-secondary"
                }`}>{tab}</button>
            ))}
          </nav>
        </div>
      </header>
      <TerminalTicker />
      <main className="mx-auto max-w-7xl px-6 py-6">

        {activeTab === "trade" && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-1"><DelegationKit /></div>
            <div className="lg:col-span-2 space-y-5">
              <div className="rounded-2xl border border-border bg-bg-card p-5">
                <h3 className="mb-4 font-display text-base font-semibold">Trading Terminal</h3>

                {/* Execution mode toggle */}
                <div className="mb-4 flex items-center gap-3 rounded-xl bg-bg-elevated p-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={onchainMode} onChange={() => setOnchainMode(!onchainMode)}
                      className="h-4 w-4 rounded border-border bg-bg-elevated accent-accent" />
                    <span className="text-xs font-medium text-text-secondary">On-chain mode</span>
                  </label>
                  {onchainMode && !smartWalletAddress && (
                    <button onClick={handleDeployWallet} disabled={deployingWallet}
                      className="ml-auto rounded-lg bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50">
                      {deployingWallet ? "Deploying..." : "Deploy Smart Wallet"}
                    </button>
                  )}
                  {smartWalletAddress && (
                    <span className="ml-auto font-mono text-[10px] text-text-muted">
                      SW: {smartWalletAddress.slice(0, 6)}...{smartWalletAddress.slice(-4)}
                    </span>
                  )}
                </div>

                <div className="mb-4 flex flex-wrap gap-2">
                  {SYMBOLS.map((s) => (
                    <button key={s} onClick={() => setSymbol(s)}
                      className={`rounded-lg px-3 py-1.5 font-mono text-xs font-medium transition-colors ${
                        symbol === s ? "bg-accent text-white" : "border border-border bg-bg-elevated text-text-secondary hover:border-accent/40"
                      }`}>{s.replace("USDT", "")}</button>
                  ))}
                </div>
                <div className="mb-4">
                  <label className="mb-1.5 block font-mono text-[11px] font-medium uppercase tracking-widest text-text-muted">Mode</label>
                  <div className="flex gap-2">
                    {([{value:"AI_MANAGED",label:"AI Managed"},{value:"STRATEGY_MANAGED",label:"Strategy"},{value:"AUTONOMOUS_AI",label:"Autonomous"}] as {value:AutomationMode;label:string}[]).map((m) => (
                      <button key={m.value} onClick={() => setAutomationMode(m.value)}
                        className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                          automationMode === m.value ? "bg-accent text-white" : "border border-border bg-bg-elevated text-text-secondary hover:border-accent/40"
                        }`}>{m.label}</button>
                    ))}
                  </div>
                </div>
                <div className="mb-4">
                  <label className="mb-1.5 block font-mono text-[11px] font-medium uppercase tracking-widest text-text-muted">Trading Intent</label>
                  <textarea value={intentText} onChange={(e) => setIntentText(e.target.value)}
                    onBlur={handleParseIntent}
                    placeholder="e.g., Grow funds with moderate risk, trade XLM and BTC..."
                    rows={3}
                    className="w-full resize-none rounded-xl border border-border bg-bg-elevated p-3 font-mono text-xs text-text-primary placeholder-text-muted transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" />
                  {parsedIntent && (
                    <div className="mt-2 rounded-lg bg-bg-elevated px-3 py-2">
                      <p className="text-[10px] text-text-muted">Profile: {parsedIntent.riskTolerance} risk, {parsedIntent.investmentHorizon} horizon{parsedIntent.allowedAssets?.length ? `, assets: ${parsedIntent.allowedAssets.join(", ")}` : ""}</p>
                    </div>
                  )}
                </div>
                <button onClick={handleAnalyze} disabled={proposalLoading}
                  className="w-full rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50">
                  {proposalLoading ? "Analyzing..." : "Analyze Market"}
                </button>
              </div>

              {proposal && (
                <div className="rounded-2xl border border-border bg-bg-card p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="font-display text-base font-semibold">{proposal.action === "BUY" ? "🟢 Buy Signal" : proposal.action === "SELL" ? "🔴 Sell Signal" : "⚪ Hold"}</h3>
                    <span className="font-mono text-xs text-text-muted">Confidence: {(proposal.confidence * 100).toFixed(0)}%</span>
                  </div>
                  <div className="mb-3 space-y-2 rounded-xl bg-bg-elevated p-4">
                    <div className="flex justify-between"><span className="text-xs text-text-muted">Symbol</span><span className="font-mono text-xs font-medium">{proposal.symbol}</span></div>
                    <div className="flex justify-between"><span className="text-xs text-text-muted">Amount</span><span className="font-mono text-xs font-medium">{proposal.amount.toFixed(4)}</span></div>
                    {proposal.stopLoss && <div className="flex justify-between"><span className="text-xs text-text-muted">Stop Loss</span><span className="font-mono text-xs font-medium text-error">${proposal.stopLoss.toFixed(2)}</span></div>}
                    {proposal.takeProfit && <div className="flex justify-between"><span className="text-xs text-text-muted">Take Profit</span><span className="font-mono text-xs font-medium text-success">${proposal.takeProfit.toFixed(2)}</span></div>}
                  </div>
                  <p className="mb-4 text-xs leading-relaxed text-text-secondary">{proposal.reasoning}</p>
                  {proposal.action !== "HOLD" && (
                    <button onClick={handleExecute} disabled={executing}
                      className={`w-full rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50 ${
                        proposal.action === "BUY" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"
                      }`}>
                      {executing ? "Executing..." : `${onchainMode ? "On-chain " : ""}Execute ${proposal.action}`}
                    </button>
                  )}
                  {execResult && <div className="mt-3 animate-fade-in-up rounded-xl border border-success/20 bg-success/10 px-4 py-3"><p className="text-xs text-success">{execResult}</p></div>}
                </div>
              )}
              {error && <div className="rounded-2xl border border-error/20 bg-error/10 p-4"><p className="text-xs text-error">{error}</p></div>}
            </div>
          </div>
        )}

        {activeTab === "portfolio" && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-border bg-bg-card p-5">
              <h3 className="mb-4 font-display text-base font-semibold">Portfolio</h3>
              {portfolio ? (
                <div className="space-y-3">
                  <div className="rounded-xl bg-bg-elevated p-4">
                    <p className="font-mono text-[11px] font-medium uppercase tracking-widest text-text-muted">Balance</p>
                    <p className="mt-1 font-display text-3xl font-bold tracking-tight">${portfolio.balance.toFixed(2)}</p>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1 rounded-xl bg-bg-elevated p-4">
                      <p className="font-mono text-[10px] uppercase tracking-widest text-text-muted">Total Value</p>
                      <p className="mt-1 font-display text-xl font-bold">${portfolio.totalValue.toFixed(2)}</p>
                    </div>
                    <div className="flex-1 rounded-xl bg-bg-elevated p-4">
                      <p className="font-mono text-[10px] uppercase tracking-widest text-text-muted">Unrealized PnL</p>
                      <p className={`mt-1 font-display text-xl font-bold ${portfolio.unrealizedPnL >= 0 ? "text-success" : "text-error"}`}>
                        {portfolio.unrealizedPnL >= 0 ? "+" : ""}{portfolio.unrealizedPnL.toFixed(2)}</p>
                    </div>
                  </div>
                  {portfolio.positions.length > 0 && (
                    <div>
                      <p className="mb-2 font-mono text-[11px] font-medium uppercase tracking-widest text-text-muted">Positions</p>
                      <div className="space-y-1">{portfolio.positions.map((pos, i) => (
                        <div key={i} className="flex items-center justify-between rounded-lg bg-bg-elevated px-4 py-2.5">
                          <span className="font-mono text-xs font-medium">{pos.symbol}</span>
                          <span className="text-xs text-text-secondary">{pos.amount.toFixed(4)} @ ${pos.entryPrice.toFixed(4)}</span>
                        </div>
                      ))}</div>
                    </div>
                  )}
                </div>
              ) : <p className="text-sm text-text-muted">Loading portfolio...</p>}
            </div>
            <div className="rounded-2xl border border-border bg-bg-card p-5">
              <h3 className="mb-4 font-display text-base font-semibold">Trade History</h3>
              {trades.length > 0 ? (
                <div className="space-y-1">{trades.map((trade) => (
                  <div key={trade.id} className="flex items-center justify-between rounded-lg bg-bg-elevated px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${trade.action === "BUY" ? "bg-emerald-400" : "bg-red-400"}`} />
                      <span className="font-mono text-xs font-medium">{trade.symbol}</span>
                      <span className={`text-xs ${trade.action === "BUY" ? "text-emerald-400" : "text-red-400"}`}>{trade.action}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-text-secondary">{trade.amount.toFixed(4)} @ ${trade.price.toFixed(4)}</span>
                      {trade.pnl !== undefined && <span className={`text-xs font-medium ${trade.pnl >= 0 ? "text-success" : "text-error"}`}>
                        {trade.pnl >= 0 ? "+" : ""}{trade.pnl.toFixed(2)}</span>}
                      <span className="text-[10px] text-text-muted">{new Date(trade.timestamp).toLocaleTimeString()}</span>
                    </div>
                  </div>
                ))}</div>
              ) : <p className="text-sm text-text-muted">No trades yet</p>}
            </div>
          </div>
        )}

        {activeTab === "delegations" && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="space-y-5">
              <DelegationKit />
              <div className="rounded-2xl border border-border bg-bg-card p-5">
                <h3 className="mb-4 font-display text-base font-semibold">On-Chain Delegation</h3>
                <div className="space-y-3">
                  {!smartWalletAddress ? (
                    <div>
                      <p className="mb-2 text-xs text-text-muted">Deploy a smart wallet to create on-chain delegations.</p>
                      <button onClick={handleDeployWallet} disabled={deployingWallet}
                        className="w-full rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50">
                        {deployingWallet ? "Deploying..." : "Deploy Smart Wallet"}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="rounded-xl bg-bg-elevated p-3">
                        <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted">Smart Wallet</p>
                        <p className="mt-1 font-mono text-xs">{smartWalletAddress}</p>
                      </div>
                      <button onClick={handleCreateDelegation}
                        className="w-full rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover">
                        Create Delegation
                      </button>
                      {delegationHash && (
                        <div className="rounded-xl bg-success/10 border border-success/20 p-3">
                          <p className="text-[10px] font-mono uppercase tracking-widest text-success">Delegation Hash</p>
                          <p className="mt-1 font-mono text-xs text-success">{delegationHash}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-bg-card p-5">
              <h3 className="mb-4 font-display text-base font-semibold">Active Delegations</h3>
              <p className="text-sm text-text-muted">Delegation management and policy configuration will appear here once your wallet is deployed.</p>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
