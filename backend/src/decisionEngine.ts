// Backend decision engine for the autonomous multi-agent system. Ports the frontend HfAdvisor
// (apps/web/lib/decision/hfAdvisor.ts) server-side so the scheduler can reason without a
// cross-service hop, and generalizes it into three role-specific decision functions
// (strategic / yield / portfolio-balancer). Every function returns a structured AgentDecision
// with reasoning + confidence and NEVER hardcodes the action: the LLM chooses it, and a
// deterministic indicator-driven heuristic is used only as a graceful fallback when
// HUGGINGFACE_API_KEY is unset or the model call fails.
import { HfInference } from '@huggingface/inference';
import { ADX, ATR, EMA, MACD, RSI, ROC, SMA } from 'technicalindicators';
import { getCandles } from './priceHistory.js';
import { getStrategy, listStrategyMeta } from './strategies/index.js';
import { getHuggingFaceApiKey } from './config.js';
import type { AgentDecision, IndicatorSnapshot, MarketContext, RegimeMetrics } from './types.js';
import type { Candle } from './strategies/index.js';

const MODEL = 'meta-llama/Llama-3.1-8B-Instruct';
const MAX_RETRIES = 2;
const BACKOFF_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function lastOf<T>(a: T[]): T | undefined {
  return a.length ? a[a.length - 1] : undefined;
}

/** Computes the indicator snapshot the engine reasons over from a candle series. */
export function computeIndicators(candles: Candle[]): IndicatorSnapshot {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  const rsi = lastOf(RSI.calculate({ period: 14, values: closes })) ?? 50;
  const macdSeries = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  const macdLast = lastOf(macdSeries);
  const ema20 = lastOf(EMA.calculate({ period: 20, values: closes })) ?? (lastOf(closes) ?? 0);
  const ema50 = lastOf(EMA.calculate({ period: 50, values: closes })) ?? (lastOf(closes) ?? 0);
  const sma20 = lastOf(SMA.calculate({ period: 20, values: closes })) ?? (lastOf(closes) ?? 0);
  const atr = lastOf(ATR.calculate({ period: 14, high: highs, low: lows, close: closes })) ?? 0;

  return {
    rsi,
    macd: {
      MACD: macdLast?.MACD ?? 0,
      signal: macdLast?.signal ?? 0,
      histogram: macdLast?.histogram ?? 0,
    },
    ema20,
    ema50,
    sma20,
    atr,
  };
}

/** Derives market-regime metrics (volatility / momentum / trend / liquidity) used both by the
 *  heuristic fallback and to ground the LLM prompt. */
export function computeRegime(candles: Candle[], indicators: IndicatorSnapshot): RegimeMetrics {
  const closes = candles.map((c) => c.close);
  const price = lastOf(closes) ?? 0;
  const volatilityPct = price > 0 ? (indicators.atr / price) * 100 : 0;
  const momentum = lastOf(ROC.calculate({ period: 12, values: closes })) ?? 0;
  const adxSeries = ADX.calculate({
    period: 14,
    high: candles.map((c) => c.high),
    low: candles.map((c) => c.low),
    close: closes,
  });
  const trendStrength = lastOf(adxSeries)?.adx ?? 0;
  const recentVol = candles.slice(-10).reduce((s, c) => s + c.volume, 0);

  let regime: RegimeMetrics['regime'];
  if (volatilityPct > 4) regime = 'volatile';
  else if (trendStrength >= 25 && indicators.ema20 > indicators.ema50) regime = 'trending_up';
  else if (trendStrength >= 25 && indicators.ema20 < indicators.ema50) regime = 'trending_down';
  else regime = 'ranging';

  return { regime, volatilityPct, momentum, trendStrength, liquidity: recentVol };
}

/** Builds the full market context from the live oracle (Horizon trade aggregations). */
export async function buildMarketContext(pair: string, intervalSeconds: number): Promise<MarketContext | null> {
  const candles = await getCandles(pair, intervalSeconds, 200);
  if (candles.length < 30) return null;
  const indicators = computeIndicators(candles);
  const regime = computeRegime(candles, indicators);
  const price = candles[candles.length - 1].close;
  const first = candles[0].close;
  const change24h = first > 0 ? ((price - first) / first) * 100 : 0;
  const volume24h = candles.reduce((s, c) => s + c.volume, 0);
  return { pair, price, change24h, volume24h, indicators, regime, candles };
}

function hf(): HfInference | null {
  const key = getHuggingFaceApiKey();
  return key ? new HfInference(key) : null;
}

async function chatJson(system: string, user: string): Promise<{ raw: unknown; parsed: Record<string, unknown> } | null> {
  const client = hf();
  if (!client) return null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(BACKOFF_MS * attempt);
    try {
      const res = await client.chatCompletion({
        model: MODEL,
        max_tokens: 700,
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      });
      const content = res.choices?.[0]?.message?.content;
      if (!content) continue;
      const cleaned = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      try {
        return { raw: content, parsed: JSON.parse(cleaned) as Record<string, unknown> };
      } catch {
        continue;
      }
    } catch {
      if (attempt < MAX_RETRIES - 1) continue;
    }
  }
  return null;
}

function clampConfidence(v: unknown, def: number): number {
  return typeof v === 'number' && v >= 0 && v <= 1 ? v : def;
}

function marketBlock(ctx: MarketContext): string {
  const i = ctx.indicators;
  const r = ctx.regime;
  return `Pair: ${ctx.pair}
Price: ${ctx.price.toFixed(5)}
Change (window): ${ctx.change24h.toFixed(2)}%
Volume (window): ${ctx.volume24h.toFixed(0)}
RSI(14): ${i.rsi.toFixed(1)}
MACD: ${i.macd.MACD.toFixed(5)} signal ${i.macd.signal.toFixed(5)} hist ${i.macd.histogram.toFixed(5)}
EMA20/EMA50: ${i.ema20.toFixed(5)} / ${i.ema50.toFixed(5)}
ATR(14): ${i.atr.toFixed(5)}
Regime: ${r.regime}
Volatility: ${r.volatilityPct.toFixed(2)}%  Momentum(ROC): ${r.momentum.toFixed(2)}  TrendStrength(ADX): ${r.trendStrength.toFixed(1)}  Liquidity: ${r.liquidity.toFixed(0)}`;
}

// ── Strategic Agent ──────────────────────────────────────────────────────────────────────
// Picks the optimal strategy for the current regime, then a BUY/SELL/HOLD action. The LLM's
// selected strategy id is validated against the real registry; the chosen strategy's own signal
// on live candles is used to ground the action (the LLM proposes, the deterministic signal
// confirms — never a hardcoded action).
const STRATEGIC_SYSTEM = `You are the Strategic Agent of an autonomous on-chain trading system on Stellar.
Given live market data, a regime classification, and a catalogue of available quant strategies,
choose the single strategy best suited to the CURRENT regime (trend/volatility/momentum/liquidity/risk)
and propose an action. You do NOT size trades — the policy engine does. Output advisory JSON only.
Respond with valid JSON only (no markdown), matching:
{"selectedStrategy":"<strategy id from the catalogue>","action":"buy|sell|hold","confidence":0.0-1.0,"reasoning":"why this strategy fits this regime and why this action"}`;

export async function decideStrategic(ctx: MarketContext): Promise<AgentDecision> {
  const catalogue = listStrategyMeta()
    .map((s) => `- ${s.id} (${s.category}): ${s.name}`)
    .join('\n');
  const user = `${marketBlock(ctx)}\n\nAvailable strategies:\n${catalogue}\n\nSelect the best strategy for this regime and propose an action.`;

  const llm = await chatJson(STRATEGIC_SYSTEM, user);
  if (llm) {
    const p = llm.parsed;
    const selected = typeof p.selectedStrategy === 'string' && getStrategy(p.selectedStrategy) ? p.selectedStrategy : null;
    if (selected) {
      // Ground the LLM's action against the selected strategy's live signal — if they disagree,
      // trust the deterministic signal for the action but keep the LLM's strategy choice/reasoning.
      const signal = getStrategy(selected)!.evaluate(ctx.candles);
      const llmAction = p.action === 'buy' || p.action === 'sell' || p.action === 'hold' ? p.action : 'hold';
      const action = signal !== 'hold' ? signal : llmAction;
      return {
        action,
        confidence: clampConfidence(p.confidence, 0.6),
        reasoning: typeof p.reasoning === 'string' ? p.reasoning : `Selected ${selected} for ${ctx.regime.regime} regime.`,
        selectedStrategy: selected,
        llmModel: MODEL,
        llmPromptSummary: `Strategic decision over ${ctx.pair} (${ctx.regime.regime}), ${listStrategyMeta().length} strategies`,
        llmResponseRaw: llm.raw,
      };
    }
  }
  return strategicFallback(ctx);
}

/** Deterministic regime → strategy mapping when the LLM is unavailable. */
export function strategicFallback(ctx: MarketContext): AgentDecision {
  const r = ctx.regime;
  const byRegime: Record<RegimeMetrics['regime'], string> = {
    trending_up: 'ema-cross-12-26',
    trending_down: 'ema-cross-12-26',
    ranging: 'rsi-14',
    volatile: 'bb-breakout',
  };
  const selected = getStrategy(byRegime[r.regime]) ? byRegime[r.regime] : 'rsi-14';
  const signal = getStrategy(selected)!.evaluate(ctx.candles);
  return {
    action: signal,
    confidence: signal === 'hold' ? 0.4 : 0.55,
    reasoning: `Heuristic (LLM unavailable): ${r.regime} regime → ${selected}; signal=${signal}. RSI ${ctx.indicators.rsi.toFixed(1)}, ADX ${r.trendStrength.toFixed(1)}.`,
    selectedStrategy: selected,
    llmModel: null,
  };
}

// ── Yield Agent ──────────────────────────────────────────────────────────────────────────
// Combines both approaches: a set of simulated yield venues (APYs modulated by live
// volatility, so the environment reacts to the market) AND detection of idle capital that could
// instead back the strategic position. The LLM picks reallocate vs hold and a venue.
export interface YieldVenue {
  id: string;
  name: string;
  baseApyPct: number;
}

const YIELD_VENUES: YieldVenue[] = [
  { id: 'usdc-lend', name: 'USDC Lending Pool', baseApyPct: 4.5 },
  { id: 'xlm-lp', name: 'XLM/USDC LP', baseApyPct: 8.0 },
  { id: 'stable-vault', name: 'Stable Yield Vault', baseApyPct: 3.2 },
];

/** Live-adjusted venue APYs: LP yield scales up with volatility (more fees), lending is stable. */
export function currentYieldVenues(ctx: MarketContext): (YieldVenue & { effectiveApyPct: number })[] {
  const volBoost = 1 + Math.min(ctx.regime.volatilityPct / 100, 0.5);
  return YIELD_VENUES.map((v) => ({
    ...v,
    effectiveApyPct: v.id === 'xlm-lp' ? v.baseApyPct * volBoost : v.baseApyPct,
  }));
}

const YIELD_SYSTEM = `You are the Yield Agent of an autonomous capital-efficiency system on Stellar.
You maximize yield on idle capital while respecting risk. Given idle capital, live market regime, and a
set of yield venues with effective APYs, decide whether to reallocate idle funds into a venue or hold.
Respond with valid JSON only (no markdown):
{"action":"reallocate|hold","yieldVenue":"<venue id or null>","confidence":0.0-1.0,"reasoning":"..."}`;

export async function decideYield(ctx: MarketContext, idleCapitalUsd: number): Promise<AgentDecision> {
  const venues = currentYieldVenues(ctx);
  const venueBlock = venues.map((v) => `- ${v.id} (${v.name}): ${v.effectiveApyPct.toFixed(2)}% APY`).join('\n');
  const user = `${marketBlock(ctx)}\n\nIdle capital: $${idleCapitalUsd.toFixed(2)}\nYield venues:\n${venueBlock}\n\nDecide whether to reallocate idle capital and into which venue.`;

  const llm = await chatJson(YIELD_SYSTEM, user);
  if (llm) {
    const p = llm.parsed;
    const action = p.action === 'reallocate' ? 'reallocate' : 'hold';
    const venue = typeof p.yieldVenue === 'string' && venues.some((v) => v.id === p.yieldVenue) ? p.yieldVenue : null;
    return {
      action,
      confidence: clampConfidence(p.confidence, 0.6),
      reasoning: typeof p.reasoning === 'string' ? p.reasoning : 'Yield reallocation decision.',
      yieldVenue: action === 'reallocate' ? venue : null,
      llmModel: MODEL,
      llmPromptSummary: `Yield decision, idle $${idleCapitalUsd.toFixed(2)}, ${venues.length} venues`,
      llmResponseRaw: llm.raw,
    };
  }
  return yieldFallback(ctx, idleCapitalUsd);
}

export function yieldFallback(ctx: MarketContext, idleCapitalUsd: number): AgentDecision {
  const venues = currentYieldVenues(ctx);
  const best = venues.reduce((a, b) => (b.effectiveApyPct > a.effectiveApyPct ? b : a));
  const reallocate = idleCapitalUsd > 1 && best.effectiveApyPct > 3;
  return {
    action: reallocate ? 'reallocate' : 'hold',
    confidence: reallocate ? 0.6 : 0.4,
    reasoning: `Heuristic (LLM unavailable): idle $${idleCapitalUsd.toFixed(2)}; best venue ${best.id} at ${best.effectiveApyPct.toFixed(2)}% APY.`,
    yieldVenue: reallocate ? best.id : null,
    llmModel: null,
  };
}

// ── Portfolio Balancer Agent ───────────────────────────────────────────────────────────────
const BALANCER_SYSTEM = `You are the Portfolio Balancer Agent of an autonomous system on Stellar.
You keep the portfolio near its target allocation, reduce concentration risk, and avoid churn.
Given current vs target allocation and market regime, decide whether to rebalance.
Respond with valid JSON only (no markdown):
{"action":"rebalance|hold","targetXlmPct":0-100,"targetUsdcPct":0-100,"confidence":0.0-1.0,"reasoning":"..."}`;

export async function decideBalancer(
  ctx: MarketContext,
  current: { xlmPct: number; usdcPct: number },
  target: { xlmPct: number; usdcPct: number },
  driftPct: number
): Promise<AgentDecision> {
  const user = `${marketBlock(ctx)}\n\nCurrent allocation: XLM ${current.xlmPct.toFixed(1)}% / USDC ${current.usdcPct.toFixed(1)}%\nTarget allocation: XLM ${target.xlmPct.toFixed(1)}% / USDC ${target.usdcPct.toFixed(1)}%\nDrift threshold: ${driftPct}%\n\nDecide whether to rebalance toward target.`;

  const llm = await chatJson(BALANCER_SYSTEM, user);
  if (llm) {
    const p = llm.parsed;
    const action = p.action === 'rebalance' ? 'rebalance' : 'hold';
    const tx = typeof p.targetXlmPct === 'number' ? p.targetXlmPct : target.xlmPct;
    return {
      action,
      confidence: clampConfidence(p.confidence, 0.6),
      reasoning: typeof p.reasoning === 'string' ? p.reasoning : 'Rebalance decision.',
      targetAllocation: { xlmPct: tx, usdcPct: 100 - tx },
      llmModel: MODEL,
      llmPromptSummary: `Balancer decision, drift XLM ${(current.xlmPct - target.xlmPct).toFixed(1)}%`,
      llmResponseRaw: llm.raw,
    };
  }
  return balancerFallback(current, target, driftPct);
}

export function balancerFallback(
  current: { xlmPct: number; usdcPct: number },
  target: { xlmPct: number; usdcPct: number },
  driftPct: number
): AgentDecision {
  const drift = Math.abs(current.xlmPct - target.xlmPct);
  const rebalance = drift > driftPct;
  return {
    action: rebalance ? 'rebalance' : 'hold',
    confidence: rebalance ? 0.65 : 0.4,
    reasoning: `Heuristic (LLM unavailable): current XLM ${current.xlmPct.toFixed(1)}% vs target ${target.xlmPct.toFixed(1)}% (drift ${drift.toFixed(1)}% ${rebalance ? '>' : '<='} ${driftPct}%).`,
    targetAllocation: target,
    llmModel: null,
  };
}
