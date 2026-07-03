"use client";

import { Suspense, useState, useCallback, useEffect, useRef } from "react";
import { Asset } from "@stellar/stellar-sdk";
import { AdvancedChart } from "@/app/components/charts/AdvancedChart";
import { Card, CardBody, CardHeader } from "@/app/components/ui/Card";
import { Badge } from "@/app/components/ui/Badge";
import { Spinner } from "@/app/components/ui/Spinner";
import { usePrices } from "@/app/hooks/usePrices";
import { useWalletContext } from "@/app/contexts/WalletContext";
import { useStellarBalances } from "@/app/hooks/useStellarBalances";
import { useSmartWalletBalances } from "@/app/hooks/useSmartWalletBalances";
import {
  formatNumber,
} from "@/app/lib/format";
import { cn } from "@/lib/utils";
import {
  fetchOrderBookQuote,
  executeSwap,
  addTrustline,
  signDelegationHashWithFreighter,
  signAuthEntryWithFreighter,
  delegateXLM,
  TESTNET_USDC_ISSUER,
  type SwapAsset,
  type OrderBookQuote,
} from "@/app/lib/stellar";
import { TokenSearchSelect } from "./components/TokenSearchSelect";
import { TickerTape } from "./components/TickerTape";
import { LiveTradeCard } from "./components/LiveTradeCard";
import {
  createAgentWallet,
  attachAgentDelegation,
  setAgentStrategy,
  startAgentWallet,
  listStrategies,
  listAgentWallets,
  type StrategyMeta,
  type AgentSummary,
} from "@/app/lib/agentsBackend";

type TradeMode = "manual" | "strategy" | "intent" | "agent";

const CHART_SYMBOLS = ["XLMUSDT", "BTCUSDT", "ETHUSDT", "SOLUSDT"];
const TICKER_SYMBOLS = ["XLMUSDT", "BTCUSDT", "ETHUSDT", "SOLUSDT", "USDCUSDT"];

const MODES: { value: TradeMode; label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "strategy", label: "Strategy" },
  { value: "intent", label: "Intent" },
  { value: "agent", label: "Agent Auto" },
];

function TradeInner() {
  const [chartSymbol, setChartSymbol] = useState("XLMUSDT");
  const { tickers } = usePrices(TICKER_SYMBOLS, 10000);
  const ticker = tickers[chartSymbol];

  const { wallet, connected, connecting, connect, disconnect, smartWalletAddress, deploying, deployError } = useWalletContext();
  const { xlmBalance, usdcBalance, hasUsdcTrustline, allBalances, loading: balancesLoading, refresh: refreshBalances } = useStellarBalances(
    wallet?.address ?? null,
    wallet?.networkPassphrase ?? null,
  );
  // The delegation-based modes (Strategy/Intent/Agent) spend from the smart wallet, not the
  // connected EOA — a separate balance poll is needed since that's a different account. Smart
  // wallets are Soroban contracts (C-addresses), so this reads via each token's SAC `balance`
  // entrypoint rather than classic Horizon (which only understands G-addresses and can't read
  // contract balances) — same hook the Overview page uses, kept as one source of truth.
  const { xlmBalance: swXlmBalance, loading: swBalanceLoading, refresh: refreshSwBalance } = useSmartWalletBalances(
    smartWalletAddress,
    wallet?.networkPassphrase ?? null,
    wallet?.sorobanRpcUrl,
  );

  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const flash = useCallback((kind: "ok" | "err", msg: string) => {
    setToast({ kind, msg });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  // ── Mode ──
  const [mode, setMode] = useState<TradeMode>("manual");

  // ── Manual trade ──
  const [sendAsset, setSendAsset] = useState<SwapAsset>({ code: "USDC", issuer: TESTNET_USDC_ISSUER });
  const [destAsset, setDestAsset] = useState<SwapAsset>({ code: "XLM" });
  const [amount, setAmount] = useState("");
  const amountNum = parseFloat(amount) || 0;

  const [dexQuote, setDexQuote] = useState<OrderBookQuote>({ hasLiquidity: false, price: null });
  const [quoteUpdated, setQuoteUpdated] = useState<number>(0);
  const [quoteAge, setQuoteAge] = useState(0);
  const [swapping, setSwapping] = useState(false);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [addingTrustline, setAddingTrustline] = useState(false);

  const networkPassphrase = wallet?.networkPassphrase ?? "Test SDF Network ; September 2015";

  const getBalance = useCallback(
    (asset: SwapAsset): number => {
      if (asset.code === "XLM" && !asset.issuer) return xlmBalance;
      const entry = allBalances.find((b) => b.code === asset.code && b.issuer === asset.issuer);
      return entry ? parseFloat(entry.balance) : 0;
    },
    [allBalances, xlmBalance],
  );

  const sendBalance = getBalance(sendAsset);
  const destBalance = getBalance(destAsset);

  const needsTrustline = useCallback(
    (asset: SwapAsset): boolean => {
      if (!asset.issuer) return false;
      return !allBalances.some((b) => b.code === asset.code && b.issuer === asset.issuer);
    },
    [allBalances],
  );

  const sendNeedsTrustline = needsTrustline(sendAsset);
  const destNeedsTrustline = needsTrustline(destAsset);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const q = await fetchOrderBookQuote(sendAsset, destAsset, networkPassphrase);
        if (!cancelled) { setDexQuote(q); setQuoteUpdated(Date.now()); setQuoteAge(0); }
      } catch {
        if (!cancelled) setDexQuote({ hasLiquidity: false, price: null });
      }
    };
    load();
    const id = setInterval(load, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [sendAsset, destAsset, networkPassphrase]);

  useEffect(() => {
    if (quoteUpdated === 0) return;
    const id = setInterval(() => setQuoteAge((a) => a + 1), 1000);
    return () => clearInterval(id);
  }, [quoteUpdated]);

  const maxAmount = sendBalance;

  const SLIPPAGE = 0.01;

  const flipPair = useCallback(() => {
    setSendAsset(destAsset);
    setDestAsset(sendAsset);
    setAmount("");
    setSwapError(null);
  }, [destAsset, sendAsset]);

  const handleAddTrustline = async (asset: SwapAsset) => {
    if (!wallet || !asset.issuer) return;
    setAddingTrustline(true);
    setSwapError(null);
    try {
      await addTrustline(wallet.address, asset, wallet.networkPassphrase);
      flash("ok", `${asset.code} trustline added`);
      await refreshBalances();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSwapError(msg);
      flash("err", msg);
    } finally {
      setAddingTrustline(false);
    }
  };

  const handleSwap = async () => {
    if (!wallet || amountNum <= 0 || !dexQuote.price) return;
    setSwapping(true);
    setSwapError(null);
    try {
      const destMin = (amountNum * dexQuote.price * (1 - SLIPPAGE)).toFixed(7);
      const result = await executeSwap({
        sourceAddress: wallet.address,
        sendAsset,
        sendAmount: amountNum.toFixed(7),
        destAsset,
        destMin,
        networkPassphrase: wallet.networkPassphrase,
      });
      flash("ok", `Swapped ${formatNumber(amountNum)} ${sendAsset.code} — tx ${result.hash.slice(0, 8)}…`);
      setAmount("");
      await refreshBalances();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSwapError(msg);
      flash("err", msg);
    } finally {
      setSwapping(false);
    }
  };

  // ── Shared delegation creation ──
  const walletOwner = wallet?.address ?? null;
  const [delegating, setDelegating] = useState<string | null>(null);

  // Converts a USD amount into stroops of the given token, for building spend-limit caveats
  // from USD-denominated inputs. Uses the live price feed for the conversion; falls back to
  // a conservative price (higher = fewer stroops = tighter cap) if no live price yet.
  const usdToTokenStroops = useCallback((usd: number, token: "XLM" | "USDC"): bigint => {
    if (token === "USDC") {
      const price = tickers["USDCUSDT"]?.price && tickers["USDCUSDT"].price > 0 ? tickers["USDCUSDT"].price : 1;
      return BigInt(Math.max(0, Math.round((usd / price) * 10_000_000)));
    }
    const price = ticker?.price && ticker.price > 0 ? ticker.price : 0.5;
    return BigInt(Math.max(0, Math.round((usd / price) * 10_000_000)));
  }, [ticker, tickers]);

  // The token the agent will spend on this limit order, based on the Stellar DEX pair (XLM/USDC):
  // buying XLM or selling USDC → agent spends USDC; selling XLM or buying USDC → agent spends XLM.
  const delegationTokenForOrder = useCallback((side: "buy" | "sell", asset: string): "XLM" | "USDC" => {
    return side === "sell" ? (asset as "XLM" | "USDC") : (asset === "XLM" ? "USDC" : "XLM");
  }, []);

  const createTradeDelegation = useCallback(async (
    delegate: string, policies: Record<string, unknown>[]
  ): Promise<{ hash: string; delegation: Record<string, unknown> } | null> => {
    if (!wallet || !smartWalletAddress || !walletOwner) {
      flash("err", "Connect wallet and deploy a smart wallet first.");
      return null;
    }
    try {
      setDelegating("preparing");
      const prepareRes = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "PREPARE_DELEGATION", delegate, delegator: smartWalletAddress, policies }),
      });
      const prepared = await prepareRes.json();
      if (!prepareRes.ok) throw new Error(prepared.error);

      setDelegating("signing");
      const signatureHex = await signDelegationHashWithFreighter(prepared.hashHex, networkPassphrase, walletOwner);

      setDelegating("submitting");
      const submitRes = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SUBMIT_DELEGATION", unsignedDelegation: prepared.unsignedDelegation, signatureHex }),
      });
      const data = await submitRes.json();
      if (!submitRes.ok) throw new Error(data.error);

      return { hash: data.hash as string, delegation: data.delegation as Record<string, unknown> };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      flash("err", msg);
      return null;
    } finally {
      setDelegating(null);
    }
  }, [wallet, smartWalletAddress, walletOwner, networkPassphrase, flash]);

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      flash("ok", "Copied to clipboard");
    } catch {
      flash("err", "Failed to copy");
    }
  }, [flash]);

  // ── Strategy trade — launches a real custodial agent (see /backend) that trades a chosen
  // quant strategy's buy/sell signal live on the Stellar testnet DEX from its own account,
  // funded via a spend-limit delegation from this smart wallet. ──
  const [strategies, setStrategies] = useState<StrategyMeta[]>([]);
  const [loadingStrategies, setLoadingStrategies] = useState(true);
  const [strategiesError, setStrategiesError] = useState<string | null>(null);

  useEffect(() => {
    listStrategies()
      .then(setStrategies)
      .catch((e) => setStrategiesError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingStrategies(false));
  }, []);

  const [selectedStrategy, setSelectedStrategy] = useState<StrategyMeta | null>(null);
  const [quantAmount, setQuantAmount] = useState("10");
  const [quantIntervalMinutes, setQuantIntervalMinutes] = useState("15");
  // Paper by default — live requires explicit opt-in since it submits real Stellar transactions.
  const [tradeMode, setTradeMode] = useState<"paper" | "live">("paper");
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [liveAgentId, setLiveAgentId] = useState<string | null>(null);
  // Overrides the live-feed view to show the picker even when agents are already running.
  const [showStrategyPicker, setShowStrategyPicker] = useState(false);

  // Active strategy agents live in the backend, not local component state — reload them on
  // mount so navigating away and back (or a full refresh) still shows the live feed instead
  // of losing it to a wiped `liveAgentId`.
  const [activeAgents, setActiveAgents] = useState<AgentSummary[]>([]);
  const [loadingActiveAgents, setLoadingActiveAgents] = useState(false);

  const refreshActiveAgents = useCallback(async () => {
    if (!walletOwner) return;
    setLoadingActiveAgents(true);
    try {
      const agents = await listAgentWallets(walletOwner);
      setActiveAgents(
        agents.filter((a) => a.strategy?.type === "quant" && (a.status === "running" || a.status === "error"))
      );
    } catch {
      // Non-fatal — the launch form still works even if this listing fails.
    } finally {
      setLoadingActiveAgents(false);
    }
  }, [walletOwner]);

  useEffect(() => {
    refreshActiveAgents();
  }, [refreshActiveAgents]);

  const strategyGroups = strategies.reduce<Record<string, StrategyMeta[]>>((acc, s) => {
    (acc[s.category] ??= []).push(s);
    return acc;
  }, {});

  const handleLaunchStrategy = async () => {
    if (!selectedStrategy) return;
    const amt = parseFloat(quantAmount) || 0;
    if (amt <= 0) { flash("err", "Enter a valid amount per trade"); return; }
    if (!walletOwner) { flash("err", "Connect your wallet first"); return; }
    if (!smartWalletAddress) { flash("err", "Deploy a smart wallet first"); return; }

    setLaunching(true);
    setLaunchError(null);
    try {
      const agent = await createAgentWallet(walletOwner, { mode: tradeMode });

      // Cap the delegation well above amountPerTrade so the agent can run for a while
      // before needing a fresh delegation — 100 ticks' worth of spend per day.
      const result = await createTradeDelegation(agent.publicKey, [
        {
          type: "spend-limit",
          token: Asset.native().contractId(networkPassphrase),
          spendLimit: (BigInt(Math.round(amt * 10_000_000 * 100))).toString(),
          period: "86400",
        },
        {
          type: "time-restriction",
          start: Math.floor(Date.now() / 1000),
          expiry: Math.floor(Date.now() / 1000) + 30 * 86400,
        },
      ]);
      if (!result) throw new Error("Failed to create delegation");

      await attachAgentDelegation(agent.id, result.delegation);
      await setAgentStrategy(agent.id, {
        type: "quant",
        strategyId: selectedStrategy.id,
        pair: "XLM/USDC",
        amountPerTrade: (BigInt(Math.round(amt * 10_000_000))).toString(),
        intervalSeconds: Math.max(60, Math.round((parseFloat(quantIntervalMinutes) || 15) * 60)),
      });
      await startAgentWallet(agent.id);

      setLiveAgentId(agent.id);
      setSelectedStrategy(null);
      setShowStrategyPicker(false);
      await Promise.all([refreshActiveAgents(), refreshSwBalance()]);
      flash("ok", `${selectedStrategy.name} launched — trading live`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLaunchError(msg);
      flash("err", msg);
    } finally {
      setLaunching(false);
    }
  };

  const handleResetStrategy = () => {
    setLiveAgentId(null);
    setSelectedStrategy(null);
    setLaunchError(null);
    setShowStrategyPicker(false);
  };

  // ── Intent trade ──
  const PROFILE_LABELS: Record<string, string> = {
    goal: "Goal",
    riskTolerance: "Risk Tolerance",
    investmentHorizon: "Horizon",
    allowedAssets: "Assets",
    dailyTradeLimit: "Daily Limit",
    maxPositionSize: "Max Size",
    stopLossPreference: "Stop Loss",
    takeProfitPreference: "Take Profit",
  };

  const [intentText, setIntentText] = useState("");
  const [intentProfile, setIntentProfile] = useState<Record<string, unknown> | null>(null);
  const [intentResult, setIntentResult] = useState<{ hash: string } | null>(null);
  const [parsing, setParsing] = useState(false);

  const handleParseIntent = async () => {
    if (!intentText.trim()) { flash("err", "Describe what you want to do"); return; }
    setParsing(true);
    setIntentResult(null);
    try {
      const res = await fetch("/api/intent/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: intentText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setIntentProfile(data.profile ?? data.extracted);
    } catch (e) {
      flash("err", e instanceof Error ? e.message : String(e));
    } finally {
      setParsing(false);
    }
  };

  const [confirmingIntent, setConfirmingIntent] = useState(false);

  // A specific order (e.g. "buy 5 XLM when price drops to 0.2005") needs to survive the tab
  // being closed and fire exactly when its price condition is met — so it becomes a standing
  // backend 'limit' strategy on a dedicated agent wallet, the same infra Strategy mode uses,
  // rather than something this page polls client-side.
  const handleConfirmOrderIntent = async (order: { side: "buy" | "sell"; asset: string; quantity: number; triggerComparator: "lte" | "gte" | null; triggerPrice: number | null }) => {
    if (!walletOwner) { flash("err", "Connect your wallet first"); return; }
    if (!smartWalletAddress) { flash("err", "Deploy a smart wallet first"); return; }
    if (order.asset !== "XLM" && order.asset !== "USDC") { flash("err", `Only XLM and USDC orders are supported right now (got ${order.asset})`); return; }

    setConfirmingIntent(true);
    try {
      const agent = await createAgentWallet(walletOwner, { mode: tradeMode });

      // Cap the delegation well above the order size so it can also cover the recurring
      // price-check ticks (a 'limit' strategy stops itself after the one fill).
      const spendToken = delegationTokenForOrder(order.side, order.asset);
      const tokenContractId = spendToken === "USDC"
        ? new Asset("USDC", TESTNET_USDC_ISSUER).contractId(networkPassphrase)
        : Asset.native().contractId(networkPassphrase);
      const usdValue = Math.max(order.quantity * (order.triggerPrice ?? ticker?.price ?? 0.1) * 3, 100);
      const result = await createTradeDelegation(agent.publicKey, [
        {
          type: "spend-limit",
          token: tokenContractId,
          spendLimit: usdToTokenStroops(usdValue, spendToken).toString(),
          period: "86400",
        },
        {
          type: "time-restriction",
          start: Math.floor(Date.now() / 1000),
          expiry: Math.floor(Date.now() / 1000) + 30 * 86400,
        },
      ]);
      if (!result) throw new Error("Failed to create delegation");

      await attachAgentDelegation(agent.id, result.delegation);

      const currentPrice = ticker?.price ?? 0.1;
      // No price condition stated ("buy 5 XLM" with no trigger) — fire on the very next tick by
      // setting the trigger to whatever the price already is, in the direction that's immediately true.
      const triggerComparator = order.triggerComparator ?? (order.side === "buy" ? "gte" : "lte");
      const triggerPrice = order.triggerPrice ?? currentPrice;

      await setAgentStrategy(agent.id, {
        type: "limit",
        pair: "XLM/USDC",
        asset: order.asset,
        side: order.side,
        quantity: String(order.quantity),
        triggerComparator,
        triggerPrice: String(triggerPrice),
        intervalSeconds: 60,
      });
      await startAgentWallet(agent.id);

      setLiveAgentId(agent.id);
      setIntentResult({ hash: agent.id });
      await refreshSwBalance();
      flash("ok", order.triggerPrice ? `Order placed — will fire when price ${triggerComparator === "lte" ? "<=" : ">="} ${triggerPrice}` : "Order placed — executing now");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      flash("err", msg);
    } finally {
      setConfirmingIntent(false);
    }
  };

  // Turns the HF-parsed profile into an actual trade: a spend-limit delegation still gets
  // created (so a future automated mode can enforce the same caps), but the concrete action
  // the user asked for — putting capital to work per their stated intent — is an immediate
  // Freighter-signed swap sized off the profile, not just a dormant delegation.
  const handleConfirmIntent = async () => {
    if (!intentProfile) { flash("err", "Parse an intent first"); return; }
    const order = intentProfile.order as { side: "buy" | "sell"; asset: string; quantity: number; triggerComparator: "lte" | "gte" | null; triggerPrice: number | null } | undefined;
    if (order) { await handleConfirmOrderIntent(order); return; }
    if (!wallet) { flash("err", "Connect your wallet first"); return; }

    const dailyLimitUsd = Number(intentProfile.dailyTradeLimit ?? intentProfile.dailyLimit ?? 0) || 0;
    const maxPositionUsd = Number(intentProfile.maxPositionSize ?? 0) || 0;
    const allowedAssets = Array.isArray(intentProfile.allowedAssets) ? (intentProfile.allowedAssets as string[]) : [];

    // Only XLM/USDC has live testnet DEX liquidity in this app — if the intent explicitly
    // wants to hold XLM (and not USDC), buy XLM with USDC; otherwise buy USDC with XLM.
    const buyXlm = allowedAssets.includes("XLM") && !allowedAssets.includes("USDC");
    const tradeSendAsset: SwapAsset = buyXlm ? { code: "USDC", issuer: TESTNET_USDC_ISSUER } : { code: "XLM" };
    const tradeDestAsset: SwapAsset = buyXlm ? { code: "XLM" } : { code: "USDC", issuer: TESTNET_USDC_ISSUER };

    const usdPositionCap = Math.min(maxPositionUsd || dailyLimitUsd || 100, dailyLimitUsd || Infinity);
    const price = ticker?.price && ticker.price > 0 ? ticker.price : 0.1;
    const availableBalance = getBalance(tradeSendAsset);
    const desiredSendAmount = buyXlm ? usdPositionCap : usdPositionCap / price;
    const sendAmountNum = Math.min(desiredSendAmount, availableBalance);

    if (sendAmountNum <= 0) {
      flash("err", `Insufficient ${tradeSendAsset.code} balance to size this trade`);
      return;
    }

    setConfirmingIntent(true);
    try {
      const quote = await fetchOrderBookQuote(tradeSendAsset, tradeDestAsset, networkPassphrase);
      if (!quote.hasLiquidity || !quote.price) throw new Error(`No liquidity for ${tradeSendAsset.code} → ${tradeDestAsset.code}`);

      const destMin = (sendAmountNum * quote.price * (1 - SLIPPAGE)).toFixed(7);
      const swapResult = await executeSwap({
        sourceAddress: wallet.address,
        sendAsset: tradeSendAsset,
        sendAmount: sendAmountNum.toFixed(7),
        destAsset: tradeDestAsset,
        destMin,
        networkPassphrase: wallet.networkPassphrase,
      });

      setIntentResult({ hash: swapResult.hash });
      flash("ok", `Traded ${formatNumber(sendAmountNum)} ${tradeSendAsset.code} → ${tradeDestAsset.code} per your intent — tx ${swapResult.hash.slice(0, 8)}…`);
      await refreshBalances();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      flash("err", msg);
    } finally {
      setConfirmingIntent(false);
    }
  };

  // ── Agent auto ──
  const [riskLevel, setRiskLevel] = useState(5);
  const [agentCapital, setAgentCapital] = useState("1000");
  const [agentPubkey, setAgentPubkey] = useState("");
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentDelegationData, setAgentDelegationData] = useState<{ hash: string; delegation: Record<string, unknown> } | null>(null);

  const [stoppingAgent, setStoppingAgent] = useState(false);

  const handleStopAgent = async () => {
    if (!agentDelegationData || !walletOwner) {
      setAgentRunning(false);
      return;
    }
    setStoppingAgent(true);
    try {
      // "Stop" must actually revoke the on-chain delegation — otherwise the agent's key
      // still has live spend authority regardless of what this page's local state says.
      const prepareRes = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "PREPARE_REVOKE_DELEGATION", delegation: agentDelegationData.delegation }),
      });
      const prepared = await prepareRes.json();
      if (!prepareRes.ok) throw new Error(prepared.error);

      const signedEntryXdr = await signAuthEntryWithFreighter(
        prepared.unsignedEntryXdr,
        prepared.validUntilLedgerSeq,
        networkPassphrase,
        walletOwner
      );

      const submitRes = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SUBMIT_REVOKE_DELEGATION", delegation: agentDelegationData.delegation, signedEntryXdr }),
      });
      const data = await submitRes.json();
      if (!submitRes.ok) throw new Error(data.error);

      flash("ok", "Agent stopped — delegation revoked on-chain");
      setAgentRunning(false);
      setAgentDelegationData(null);
    } catch (e) {
      flash("err", `Failed to revoke delegation: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setStoppingAgent(false);
    }
  };

  const handleToggleAgent = async () => {
    if (agentRunning) {
      await handleStopAgent();
      return;
    }
    if (!walletOwner) { flash("err", "Connect your wallet first"); return; }
    if (!smartWalletAddress) { flash("err", "Deploy a smart wallet first"); return; }
    if (!agentPubkey.trim()) { flash("err", "Enter the agent's public key"); return; }

    const durationDays = riskLevel <= 3 ? 7 : riskLevel <= 7 ? 30 : 90;
    const capitalUsd = parseFloat(agentCapital) || 0;
    const result = await createTradeDelegation(agentPubkey.trim(), [
      {
        type: "spend-limit",
        token: Asset.native().contractId(networkPassphrase),
        spendLimit: usdToTokenStroops(capitalUsd, "XLM").toString(),
        period: "86400",
      },
      {
        type: "time-restriction",
        start: Math.floor(Date.now() / 1000),
        expiry: Math.floor(Date.now() / 1000) + durationDays * 86400,
      },
    ]);

    if (result) {
      setAgentDelegationData(result);
      setAgentRunning(true);
      flash("ok", `Agent delegation created: ${result.hash.slice(0, 8)}…`);
    }
  };

  // ── Fund smart wallet (delegation-based modes spend from here, not the connected EOA) ──
  const [fundAmount, setFundAmount] = useState("");
  const [funding, setFunding] = useState(false);

  const handleFundSmartWallet = async () => {
    if (!wallet || !smartWalletAddress) return;
    const amt = parseFloat(fundAmount) || 0;
    if (amt <= 0) { flash("err", "Enter a valid amount"); return; }
    setFunding(true);
    try {
      await delegateXLM(fundAmount, smartWalletAddress, wallet.networkPassphrase, wallet.sorobanRpcUrl);
      flash("ok", `Sent ${fundAmount} XLM to smart wallet`);
      setFundAmount("");
      await refreshSwBalance();
    } catch (e) {
      flash("err", e instanceof Error ? e.message : String(e));
    } finally {
      setFunding(false);
    }
  };

  const downloadDelegationJson = useCallback(() => {
    if (!agentDelegationData) return;
    const blob = new Blob([JSON.stringify(agentDelegationData.delegation, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `delegation-${agentDelegationData.hash.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [agentDelegationData]);

  return (
    <div className="space-y-5">
      {/* Toast */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`animate-fade-in-up rounded-xl border px-4 py-3 text-xs ${
            toast.kind === "ok"
              ? "border-success/15 bg-success/6 text-success/85"
              : "border-error/15 bg-error/6 text-error/85"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Ticker tape */}
      <TickerTape tickers={tickers} />

      {/* Mode tabs */}
      <div className="inline-flex gap-1 rounded-xl border border-white/5 bg-bg-elevated/50 p-1">
        {MODES.map((m) => (
          <button
            key={m.value}
            onClick={() => setMode(m.value)}
            className={cn(
              "flex cursor-pointer items-center gap-1.5 rounded-[7px] px-4 py-1.5 font-mono text-xs font-medium transition-all duration-300",
              mode === m.value
                ? "bg-white/8 text-text-primary shadow-[0_0_20px_-8px_rgba(120,81,233,0.12)]"
                : "text-text-muted hover:text-text-secondary",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Main layout — bento grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Chart column */}
        <div className="space-y-6 lg:col-span-2">
          <AdvancedChart
            symbol={chartSymbol}
            symbols={CHART_SYMBOLS}
            onSymbolChange={setChartSymbol}
          />
          {mode === "strategy" ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[10px] uppercase tracking-widest text-text-muted">
                  Live policies ({activeAgents.length})
                </p>
                {(activeAgents.length > 0 || liveAgentId) && (
                  <button
                    onClick={() => setShowStrategyPicker((v) => !v)}
                    className="text-xs text-accent/70 hover:text-accent"
                  >
                    {showStrategyPicker ? "← Back to live feed" : "+ Launch another"}
                  </button>
                )}
              </div>
              {loadingActiveAgents && activeAgents.length === 0 ? (
                <Card><CardBody className="flex justify-center py-8"><Spinner className="h-4 w-4" /></CardBody></Card>
              ) : activeAgents.length === 0 && !liveAgentId ? (
                <Card>
                  <CardBody className="py-8 text-center">
                    <p className="text-xs text-text-muted">
                      No strategies running yet — pick one in the panel on the right to start live trading.
                    </p>
                  </CardBody>
                </Card>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {(liveAgentId && !activeAgents.some((a) => a.id === liveAgentId)
                    ? [liveAgentId, ...activeAgents.map((a) => a.id)]
                    : activeAgents.map((a) => a.id)
                  ).map((id) => (
                    <LiveTradeCard key={id} agentId={id} strategies={strategies} />
                  ))}
                </div>
              )}
            </div>
          ) : mode === "intent" && liveAgentId && intentProfile?.order ? (
            <div className="space-y-3">
              <p className="font-mono text-[10px] uppercase tracking-widest text-text-muted">
                Live order — agent activity
              </p>
              <LiveTradeCard agentId={liveAgentId} strategies={strategies} />
            </div>
          ) : null}
        </div>

        {/* Sidebar — form + wallet */}
        <div className="space-y-6">
          {/* Mode-specific form */}
          <Card>
            <CardBody className="space-y-4">
              {/* ── MANUAL ── */}
              {mode === "manual" && (
                <>
                  <span className="mb-2 rounded-full bg-emerald-500/10 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-emerald-400/85 self-start">
                    Real
                  </span>

                  {!connected ? (
                    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5 text-center">
                      <p className="text-xs text-text-secondary">
                        Connect Freighter to trade on Stellar testnet.
                      </p>
                      <button
                        onClick={connect}
                        disabled={connecting}
                        className="mt-3 w-full rounded-xl bg-accent/70 px-4 py-2 text-xs font-semibold text-white transition-all duration-300 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {connecting ? "Connecting…" : "Connect Freighter"}
                      </button>
                    </div>
                  ) : (
                    <>
                      <TokenSearchSelect
                        balances={allBalances}
                        value={sendAsset}
                        onChange={setSendAsset}
                        label="You Pay"
                        otherAsset={destAsset}
                      />

                      <div className="flex justify-center">
                        <button
                          type="button"
                          onClick={flipPair}
                          className="flex h-8 w-8 items-center justify-center rounded-full border border-white/5 bg-white/[0.02] text-text-muted hover:border-accent/30 hover:text-accent transition-all duration-200 cursor-pointer"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <polyline points="17 1 21 5 17 9" />
                            <polyline points="7 15 3 19 7 23" />
                            <line x1="21" y1="5" x2="3" y2="5" />
                            <line x1="15" y1="19" x2="3" y2="19" />
                          </svg>
                        </button>
                      </div>

                      <TokenSearchSelect
                        balances={allBalances}
                        value={destAsset}
                        onChange={setDestAsset}
                        label="You Receive"
                        otherAsset={sendAsset}
                      />

                      <div className="rounded-lg bg-white/[0.02] px-3.5 py-2.5">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
                            DEX Price
                          </span>
                          <span className="font-mono text-sm tabular-nums text-text-primary">
                            {dexQuote.price
                              ? `1 ${sendAsset.code} ≈ ${dexQuote.price.toFixed(4)} ${destAsset.code}`
                              : "No liquidity"}
                          </span>
                        </div>
                        {quoteUpdated > 0 && (
                          <p className="mt-0.5 text-right font-mono text-[9px] text-text-muted">
                            {quoteAge}s ago
                          </p>
                        )}
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-text-muted">
                        <span>Balances</span>
                        <span className="font-mono tabular-nums text-text-secondary">
                          {balancesLoading
                            ? "Loading…"
                            : `${formatNumber(sendBalance)} ${sendAsset.code} | ${formatNumber(destBalance)} ${destAsset.code}`}
                        </span>
                      </div>

                      {(sendNeedsTrustline || destNeedsTrustline) && (
                        <div className="rounded-xl border border-amber-400/15 bg-amber-400/[0.05] p-3.5">
                          <p className="text-xs text-amber-300/85">
                            Need trustline{destNeedsTrustline && sendNeedsTrustline ? "s" : ""}:
                            {sendNeedsTrustline && ` ${sendAsset.code}`}
                            {destNeedsTrustline && ` ${destAsset.code}`}
                          </p>
                          {sendNeedsTrustline && (
                            <button
                              onClick={() => handleAddTrustline(sendAsset)}
                              disabled={addingTrustline}
                              className="mt-2 w-full rounded-lg bg-amber-400/15 px-3 py-2 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {addingTrustline ? "Adding…" : `Add ${sendAsset.code} Trustline`}
                            </button>
                          )}
                          {destNeedsTrustline && (
                            <button
                              onClick={() => handleAddTrustline(destAsset)}
                              disabled={addingTrustline}
                              className="mt-2 w-full rounded-lg bg-amber-400/15 px-3 py-2 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {addingTrustline ? "Adding…" : `Add ${destAsset.code} Trustline`}
                            </button>
                          )}
                        </div>
                      )}

                      <div>
                        <div className="mb-1.5 flex items-center justify-between">
                          <label className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">
                            Amount ({sendAsset.code})
                          </label>
                          <span className="font-mono text-[10px] text-text-muted">
                            Max {formatNumber(maxAmount)}
                          </span>
                        </div>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          placeholder="0.00"
                          className="w-full rounded-xl border border-white/5 bg-white/[0.02] px-3.5 py-2.5 font-mono text-sm text-text-primary placeholder:text-text-muted/50 transition-all duration-300 focus:border-accent/30 focus:outline-none focus:ring-2 focus:ring-accent/15"
                        />
                        <div className="mt-2 flex gap-2">
                          {[0.25, 0.5, 0.75, 1].map((pct) => (
                            <button
                              key={pct}
                              onClick={() => setAmount(maxAmount > 0 ? String(Number((maxAmount * pct).toFixed(6))) : "")}
                              className="flex-1 rounded-lg border border-white/5 bg-white/[0.02] py-1.5 font-mono text-[11px] text-text-muted transition-all duration-200 hover:bg-white/[0.05] hover:text-text-secondary"
                            >
                              {pct * 100}%
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-xs">
                        <span className="text-text-muted">
                          Est. proceeds (1% slippage tolerance)
                        </span>
                        <span className="font-mono tabular-nums text-text-secondary">
                          {dexQuote.price ? `${formatNumber(amountNum * dexQuote.price)} ${destAsset.code}` : "—"}
                        </span>
                      </div>

                      {swapError && (
                        <p className="text-xs text-error/90">{swapError}</p>
                      )}

                      <button
                        onClick={handleSwap}
                        disabled={
                          swapping ||
                          sendNeedsTrustline ||
                          destNeedsTrustline ||
                          !dexQuote.hasLiquidity ||
                          amountNum <= 0 ||
                          amountNum > maxAmount + 1e-9
                        }
                        className="w-full rounded-xl bg-emerald-600/80 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_0_25px_-10px_rgba(52,211,153,0.15)] transition-all duration-300 hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        {swapping ? "Submitting…" : `Swap ${sendAsset.code} → ${destAsset.code}`}
                      </button>
                    </>
                  )}
                </>
              )}

              {/* ── STRATEGY ── */}
              {mode === "strategy" && (
                <>
                  <span className="mb-1 inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-emerald-400/85">
                    Live · {loadingStrategies ? "…" : strategies.length} quant strategies
                  </span>

                  {!connected ? (
                    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5 text-center">
                      <p className="text-xs text-text-secondary">Connect Freighter to launch a strategy.</p>
                      <button
                        onClick={connect}
                        disabled={connecting}
                        className="mt-3 w-full rounded-xl bg-accent/70 px-4 py-2 text-xs font-semibold text-white transition-all duration-300 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {connecting ? "Connecting…" : "Connect Freighter"}
                      </button>
                    </div>
                  ) : !smartWalletAddress ? (
                    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5 text-center">
                      <p className="text-xs text-text-secondary">
                        {deploying ? "Deploying your smart wallet…" : "Deploy a smart wallet to fund a strategy agent."}
                      </p>
                      {deployError && <p className="mt-2 text-xs text-error/90">{deployError}</p>}
                    </div>
                  ) : (activeAgents.length > 0 || liveAgentId) && !selectedStrategy && !showStrategyPicker ? (
                    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5 text-center">
                      <p className="text-xs text-text-secondary">
                        {activeAgents.length} strateg{activeAgents.length === 1 ? "y" : "ies"} live — see the feed below the chart.
                      </p>
                      <button
                        onClick={() => setShowStrategyPicker(true)}
                        className="mt-3 w-full rounded-xl bg-accent/70 px-4 py-2 text-xs font-semibold text-white transition-all duration-300 hover:bg-accent"
                      >
                        + Launch another strategy
                      </button>
                    </div>
                  ) : !selectedStrategy ? (
                    <>
                      <div className="flex items-center justify-between">
                        <p className="font-mono text-[10px] uppercase tracking-widest text-text-muted">Pick a strategy</p>
                        {activeAgents.length > 0 && (
                          <button onClick={() => setShowStrategyPicker(false)} className="text-xs text-accent/70 hover:text-accent">
                            ← Back to live feed
                          </button>
                        )}
                      </div>
                      {strategiesError && (
                        <div className="rounded-xl border border-error/15 bg-error/6 px-3 py-2">
                          <p className="text-xs text-error/90">{strategiesError}</p>
                        </div>
                      )}
                      {loadingStrategies ? (
                        <div className="flex justify-center py-6"><Spinner className="h-4 w-4" /></div>
                      ) : (
                        <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
                          {Object.entries(strategyGroups).map(([category, items]) => (
                            <div key={category} className="space-y-1.5">
                              <p className="font-mono text-[9px] font-medium uppercase tracking-widest text-text-muted">{category}</p>
                              <div className="space-y-1.5">
                                {items.map((s) => (
                                  <button
                                    key={s.id}
                                    onClick={() => setSelectedStrategy(s)}
                                    className="w-full rounded-xl border border-white/5 bg-white/[0.02] px-3.5 py-2.5 text-left transition-all duration-200 hover:border-accent/20 hover:bg-white/[0.04]"
                                  >
                                    <p className="text-xs font-medium text-text-primary">{s.name}</p>
                                    <p className="mt-0.5 truncate text-[10px] text-text-muted">{s.description}</p>
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-text-primary">{selectedStrategy.name}</p>
                        <span className="rounded-full bg-white/5 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted">
                          {selectedStrategy.category}
                        </span>
                      </div>
                      <p className="text-xs text-text-muted">{selectedStrategy.description}</p>

                      <div>
                        <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">Mode</label>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setTradeMode("paper")}
                            className={`flex-1 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                              tradeMode === "paper"
                                ? "border-accent/40 bg-accent/10 text-text-primary"
                                : "border-white/5 bg-white/[0.02] text-text-muted hover:text-text-secondary"
                            }`}
                          >
                            Paper (simulated)
                          </button>
                          <button
                            type="button"
                            onClick={() => setTradeMode("live")}
                            className={`flex-1 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                              tradeMode === "live"
                                ? "border-error/40 bg-error/10 text-text-primary"
                                : "border-white/5 bg-white/[0.02] text-text-muted hover:text-text-secondary"
                            }`}
                          >
                            Live (real funds)
                          </button>
                        </div>
                      </div>

                      {launchError && <p className="text-xs text-error/90">{launchError}</p>}

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">Pair</label>
                          <input value="XLM/USDC" disabled className="w-full rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1.5 font-mono text-xs text-text-muted" />
                        </div>
                        <div>
                          <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">Amount / trade (XLM)</label>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={quantAmount}
                            onChange={(e) => setQuantAmount(e.target.value)}
                            className="w-full rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1.5 font-mono text-xs text-text-primary outline-none transition-all duration-200 focus:border-accent/30 focus:ring-2 focus:ring-accent/15"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">Check interval (minutes)</label>
                        <input
                          type="number"
                          min="1"
                          value={quantIntervalMinutes}
                          onChange={(e) => setQuantIntervalMinutes(e.target.value)}
                          className="w-full rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1.5 font-mono text-xs text-text-primary outline-none transition-all duration-200 focus:border-accent/30 focus:ring-2 focus:ring-accent/15"
                        />
                      </div>

                      <p className="text-[10px] text-text-muted">
                        Creates a dedicated agent wallet, delegates a spend limit from your smart wallet, and
                        starts it trading this strategy's live signal on the Stellar testnet DEX.
                      </p>

                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => setSelectedStrategy(null)}
                          disabled={launching}
                          className="flex-1 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Back
                        </button>
                        <button
                          onClick={handleLaunchStrategy}
                          disabled={launching || delegating !== null}
                          className="flex-[2] rounded-xl bg-emerald-600/80 px-4 py-2 text-xs font-semibold text-white shadow-[0_0_25px_-10px_rgba(52,211,153,0.15)] transition-all duration-300 hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {launching || delegating ? (
                            <span className="flex items-center justify-center gap-2">
                              <Spinner className="h-3 w-3" />
                              {delegating ? `Delegation ${delegating}…` : "Starting agent…"}
                            </span>
                          ) : (
                            "Launch Strategy"
                          )}
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}

              {/* ── INTENT ── */}
              {mode === "intent" && (
                intentResult ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 rounded-xl border border-success/15 bg-success/6 px-4 py-3">
                      <span className="text-sm text-success">✓</span>
                      <p className="text-xs font-medium text-success/85">
                        {intentProfile?.order ? "Order placed — live on the backend scheduler" : "Trade executed"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5">
                      {intentProfile && Object.entries(intentProfile).filter(([key]) => key !== "order" && key !== "confidence").map(([key, val]) => (
                        <div key={key} className="flex items-center justify-between py-0.5">
                          <span className="font-mono text-[10px] text-text-muted">{PROFILE_LABELS[key] ?? key}</span>
                          <span className="font-mono text-xs text-text-secondary">{Array.isArray(val) ? val.join(", ") : String(val)}</span>
                        </div>
                      ))}
                      <div className="mt-2 flex items-center justify-between border-t border-white/5 pt-2">
                        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
                          {intentProfile?.order ? "Agent" : "Tx"}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-text-secondary">{intentResult.hash.slice(0, 8)}…</span>
                          <button onClick={() => copyToClipboard(intentResult.hash)} className="text-[10px] text-accent/70 hover:text-accent">Copy</button>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <a href={intentProfile?.order ? "/dashboard/agents" : "/dashboard/delegations"} className="flex-1 rounded-xl bg-accent/70 px-3 py-2 text-center text-xs font-semibold text-white transition-all duration-300 hover:bg-accent">
                        {intentProfile?.order ? "View Agent →" : "View Delegations →"}
                      </a>
                      <button onClick={() => { setIntentResult(null); setIntentProfile(null); setIntentText(""); setLiveAgentId(null); }} className="flex-1 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-text-muted transition-all duration-200 hover:bg-white/[0.05] hover:text-text-secondary">Create Another</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">
                        What do you want to do?
                      </label>
                      <textarea
                        value={intentText}
                        onChange={(e) => setIntentText(e.target.value)}
                        placeholder='e.g. "buy XLM if it drops to $0.11"'
                        rows={3}
                        className="w-full resize-none rounded-xl border border-white/5 bg-white/[0.02] px-3.5 py-2.5 font-mono text-sm text-text-primary placeholder:text-text-muted/50 transition-all duration-300 focus:border-accent/30 focus:outline-none focus:ring-2 focus:ring-accent/15"
                      />
                    </div>

                    {!intentProfile ? (
                      <button
                        onClick={handleParseIntent}
                        disabled={parsing || delegating !== null}
                        className="w-full rounded-xl bg-white/8 px-5 py-2.5 text-sm font-semibold text-text-primary transition-all duration-300 hover:bg-white/10 hover:shadow-[0_0_25px_-8px_rgba(120,81,233,0.1)] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {parsing ? "Parsing…" : "Parse Intent"}
                      </button>
                    ) : (
                      <div className="space-y-3">
                        <div className="rounded-xl border border-accent/10 bg-accent-muted/50 p-3.5">
                          <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-accent/70">
                            {intentProfile.order ? "Order" : "Trading Profile"}
                          </p>
                          {intentProfile.order != null && (
                            <>
                              {(() => {
                                const order = intentProfile.order as { side: string; asset: string; quantity: number; triggerComparator: "lte" | "gte" | null; triggerPrice: number | null };
                                return (
                                  <>
                                    <div className="flex items-center justify-between py-0.5">
                                      <span className="font-mono text-[10px] text-text-muted">Order</span>
                                      <span className="font-mono text-xs text-text-secondary">{order.side.toUpperCase()} {order.quantity} {order.asset}</span>
                                    </div>
                                    <div className="flex items-center justify-between py-0.5">
                                      <span className="font-mono text-[10px] text-text-muted">Trigger</span>
                                      <span className="font-mono text-xs text-text-secondary">
                                        {order.triggerPrice ? `Price ${order.triggerComparator === "lte" ? "<=" : ">="} ${order.triggerPrice}` : "Immediate"}
                                      </span>
                                    </div>
                                  </>
                                );
                              })()}
                            </>
                          )}
                          {Object.entries(intentProfile).filter(([key]) => key !== "order" && key !== "confidence").map(([key, val]) => (
                            <div key={key} className="flex items-center justify-between py-0.5">
                              <span className="font-mono text-[10px] text-text-muted">{PROFILE_LABELS[key] ?? key}</span>
                              <span className="font-mono text-xs text-text-secondary">{Array.isArray(val) ? val.join(", ") : String(val)}</span>
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => { setIntentProfile(null); setIntentText(""); }}
                            disabled={delegating !== null}
                            className="flex-1 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-text-muted transition-all duration-200 hover:bg-white/[0.05] hover:text-text-secondary disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleConfirmIntent}
                            disabled={confirmingIntent || delegating !== null}
                            className="flex-1 rounded-xl bg-accent/70 px-3 py-2 text-xs font-semibold text-white transition-all duration-300 hover:bg-accent hover:shadow-[0_0_25px_-8px_rgba(120,81,233,0.2)] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {confirmingIntent ? "Trading…" : delegating ? `Delegation ${delegating}…` : "Confirm & Trade"}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )
              )}

              {/* ── AGENT AUTO ── */}
              {mode === "agent" && (
                agentDelegationData ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 rounded-xl border border-success/15 bg-success/6 px-4 py-3">
                      <span className="text-sm text-success">✓</span>
                      <p className="text-xs font-medium text-success/85">Agent started</p>
                    </div>
                    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">Delegate</span>
                        <span className="font-mono text-xs text-text-secondary">{agentPubkey.slice(0, 6)}…{agentPubkey.slice(-4)}</span>
                      </div>
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">Risk</span>
                        <span className="font-mono text-xs capitalize text-text-secondary">{riskLevel <= 3 ? "Conservative" : riskLevel <= 7 ? "Moderate" : "Aggressive"}</span>
                      </div>
                      <div className="flex items-center justify-between border-t border-white/5 pt-2">
                        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">Delegation</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-text-secondary">{agentDelegationData.hash.slice(0, 8)}…</span>
                          <button onClick={() => copyToClipboard(agentDelegationData.hash)} className="text-[10px] text-accent/70 hover:text-accent">Copy</button>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-xl border border-amber-400/15 bg-amber-400/[0.05] p-3.5">
                      <p className="text-xs text-amber-300/85">
                        Save this delegation to <code className="rounded bg-white/5 px-1 py-0.5 font-mono text-[10px]">~/.kairos/delegations/</code> for the MCP agent to pick it up.
                      </p>
                      <button
                        onClick={downloadDelegationJson}
                        className="mt-2.5 w-full rounded-lg bg-amber-400/15 px-3 py-2 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-400/20"
                      >
                        Download Delegation JSON
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <a href="/dashboard/delegations" className="flex-1 rounded-xl bg-accent/70 px-3 py-2 text-center text-xs font-semibold text-white transition-all duration-300 hover:bg-accent">View Delegations →</a>
                      <button
                        onClick={handleStopAgent}
                        disabled={stoppingAgent}
                        className="flex-1 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-text-muted transition-all duration-200 hover:bg-white/[0.05] hover:text-text-secondary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {stoppingAgent ? "Revoking…" : "Stop (Revoke)"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">
                        Risk Level
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min="1"
                          max="10"
                          value={riskLevel}
                          onChange={(e) => setRiskLevel(Number(e.target.value))}
                          className="flex-1 accent-accent"
                        />
                        <span className="w-6 text-center font-mono text-sm text-text-primary">{riskLevel}</span>
                      </div>
                      <p className="mt-1 font-mono text-[10px] text-text-muted">
                        {riskLevel <= 3 ? "Conservative (7d)" : riskLevel <= 7 ? "Moderate (30d)" : "Aggressive (90d)"}
                      </p>
                    </div>

                    <div>
                      <label className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">
                        Allocated Capital (USD)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={agentCapital}
                        onChange={(e) => setAgentCapital(e.target.value)}
                        className="w-full rounded-xl border border-white/5 bg-white/[0.02] px-3.5 py-2.5 font-mono text-sm text-text-primary outline-none transition-all duration-300 focus:border-accent/30 focus:ring-2 focus:ring-accent/15"
                      />
                    </div>

                    <div>
                      <label className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">
                        Agent Public Key
                      </label>
                      <input
                        type="text"
                        value={agentPubkey}
                        onChange={(e) => setAgentPubkey(e.target.value)}
                        placeholder="G…"
                        className="w-full rounded-xl border border-white/5 bg-white/[0.02] px-3.5 py-2.5 font-mono text-xs text-text-primary placeholder:text-text-muted/50 transition-all duration-300 focus:border-accent/30 focus:outline-none focus:ring-2 focus:ring-accent/15"
                      />
                    </div>

                    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] text-text-muted">Status</span>
                        <span className="font-mono text-[10px] font-medium text-text-muted">Stopped</span>
                      </div>
                    </div>

                    <button
                      onClick={handleToggleAgent}
                      disabled={delegating !== null}
                      className="w-full rounded-xl bg-emerald-600/80 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_0_25px_-10px_rgba(52,211,153,0.15)] transition-all duration-300 hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      {delegating ? `Delegation ${delegating}…` : "Start Agent"}
                    </button>
                  </>
                )
              )}
            </CardBody>
          </Card>

          {/* Wallet status */}
          <Card>
            <CardBody className="space-y-3">
              <p className="font-display text-sm font-medium text-text-primary">Wallet</p>
              {!connected ? (
                <div className="text-center">
                  <p className="mb-3 text-xs text-text-muted">Connect Freighter to trade and manage your smart wallet.</p>
                  <button
                    onClick={connect}
                    disabled={connecting}
                    className="w-full rounded-xl bg-accent/70 px-4 py-2 text-xs font-semibold text-white transition-all duration-300 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {connecting ? "Connecting…" : "Connect Freighter"}
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">Wallet</span>
                    <span className="font-mono text-xs text-text-secondary">
                      {wallet?.address.slice(0, 6)}...{wallet?.address.slice(-4)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
                      Wallet Balance
                    </span>
                    <span className="font-mono text-xs text-text-secondary">
                      {balancesLoading ? "Loading…" : `${formatNumber(xlmBalance)} XLM`}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">Smart Wallet</span>
                    <span className="font-mono text-xs text-text-secondary">
                      {smartWalletAddress
                        ? `${smartWalletAddress.slice(0, 6)}...${smartWalletAddress.slice(-4)}`
                        : deploying
                          ? "Deploying…"
                          : "Not deployed"}
                    </span>
                  </div>
                  {deployError && (
                    <p className="text-xs text-error/90">{deployError}</p>
                  )}

                  {smartWalletAddress && (
                    <div className="space-y-2 rounded-xl border border-white/5 bg-white/[0.02] p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
                          Smart Wallet Balance
                        </span>
                        <span className="font-mono text-xs text-text-secondary">
                          {swBalanceLoading ? "Loading…" : `${formatNumber(swXlmBalance)} XLM`}
                        </span>
                      </div>
                      <p className="text-[10px] text-text-muted">
                        Strategy/Intent/Agent modes spend from here, not your connected wallet —
                        fund it before creating a delegation.
                      </p>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={fundAmount}
                          onChange={(e) => setFundAmount(e.target.value)}
                          placeholder="Amount (XLM)"
                          className="w-full rounded-lg border border-white/5 bg-bg-elevated px-2.5 py-1.5 font-mono text-xs text-text-primary placeholder:text-text-muted/50 transition-all duration-200 focus:border-accent/30 focus:outline-none focus:ring-2 focus:ring-accent/15"
                        />
                        <button
                          onClick={handleFundSmartWallet}
                          disabled={funding || !fundAmount}
                          className="shrink-0 rounded-lg bg-white/8 px-3 py-1.5 text-[11px] font-semibold text-text-primary transition-all duration-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {funding ? "Sending…" : "Fund"}
                        </button>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={disconnect}
                    className="w-full rounded-xl border border-white/5 bg-white/[0.02] px-4 py-2 text-xs text-text-muted transition-all duration-200 hover:bg-white/[0.05] hover:text-text-secondary"
                  >
                    Disconnect
                  </button>
                </>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function TradePage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-bg-card" />}>
      <TradeInner />
    </Suspense>
  );
}
