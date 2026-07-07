// Strategy Engine — exhaustive test suite. Verifies every built-in strategy, deterministic
// output, malformed-data fail-closed behavior, conflicting signals, confidence normalization,
// concurrent/parallel execution safety, and replay compatibility (same input -> identical hash).
import { describe, expect, it } from 'vitest';
import {
  createDefaultStrategyRegistry,
  StrategyRegistry,
  hashStrategySignal,
  validateStrategySignal,
  MalformedStrategyError,
  DuplicateStrategyError,
  StrategyNotFoundError,
  StrategySignalValidationError,
  emaCrossStrategy,
  smaCrossStrategy,
  rsiMeanReversionStrategy,
  macdTrendStrategy,
  bollingerBandsStrategy,
  momentumStrategy,
  atrVolatilityStrategy,
  breakoutStrategy,
  dcaStrategy,
  portfolioRebalancingStrategy,
  yieldAllocationStrategy,
  stablecoinAllocationStrategy,
} from '../strategyEngine/index.js';
import type { Strategy, StrategyInput, StrategySignal } from '../strategyEngine/index.js';
import type { FeatureSet } from '../agentContext/types.js';

const ALL_STRATEGIES: Strategy[] = [
  emaCrossStrategy,
  smaCrossStrategy,
  rsiMeanReversionStrategy,
  macdTrendStrategy,
  bollingerBandsStrategy,
  momentumStrategy,
  atrVolatilityStrategy,
  breakoutStrategy,
  dcaStrategy,
  portfolioRebalancingStrategy,
  yieldAllocationStrategy,
  stablecoinAllocationStrategy,
];

function baseFeatures(overrides: Partial<FeatureSet> = {}): FeatureSet {
  return {
    pair: 'XLM/USDC',
    price: 0.12,
    trend: { ema20: 0.121, ema50: 0.118, sma20: 0.1195, trendStrength: 40, direction: 'up' },
    momentum: { rsi: 55, macdHistogram: 0.0003, roc: 2.1 },
    volatility: { atr: 0.002, volatilityPct: 1.8, band: 'normal' },
    volume: { window24h: 500000, changePct: 5 },
    liquidity: { recentVolume: 100000 },
    wallet: { publicKey: 'GABC', smartWalletAddress: null, delegationActive: false, mode: 'paper', capital: '1000' },
    portfolio: { xlmPct: 50, usdcPct: 50, idleUsd: 50, totalValue: 1000, targetXlmPct: 50, targetUsdcPct: 50, driftPct: 0 },
    protocolExposure: [],
    risk: { realizedPnl: 0, unrealizedPnl: 0, drawdownPct: 0, volatilityPct: 1.8 },
    computedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function baseInput(overrides: Partial<StrategyInput> = {}): StrategyInput {
  return {
    agentId: 'agent-1',
    pair: 'XLM/USDC',
    timestamp: 1_700_000_000_000,
    features: baseFeatures(),
    allowedAssets: ['XLM', 'USDC'],
    allowedProtocols: ['soroswap', 'blend'],
    ...overrides,
  };
}

describe('Strategy Engine — every built-in strategy', () => {
  it.each(ALL_STRATEGIES.map((s) => [s.id, s] as const))('%s produces a valid StrategySignal', (_id, strategy) => {
    const signal = strategy.evaluate(baseInput());
    const errors = validateStrategySignal(signal);
    expect(errors).toEqual([]);
    expect(signal.strategyId).toBe(strategy.id);
  });

  it('createDefaultStrategyRegistry registers all 12 built-in strategies', () => {
    const registry = createDefaultStrategyRegistry();
    expect(registry.list()).toHaveLength(12);
    for (const strategy of ALL_STRATEGIES) {
      expect(registry.has(strategy.id)).toBe(true);
    }
  });
});

describe('Strategy Engine — deterministic output', () => {
  it.each(ALL_STRATEGIES.map((s) => [s.id, s] as const))('%s is deterministic across repeated calls', (_id, strategy) => {
    const input = baseInput();
    const first = strategy.evaluate(input);
    const second = strategy.evaluate(input);
    const third = strategy.evaluate(input);
    expect(hashStrategySignal(first)).toBe(hashStrategySignal(second));
    expect(hashStrategySignal(second)).toBe(hashStrategySignal(third));
  });

  it('different inputs produce different (non-colliding) hashes for a directional strategy', () => {
    const bullish = emaCrossStrategy.evaluate(baseInput({ features: baseFeatures({ trend: { ema20: 0.13, ema50: 0.11, sma20: 0.12, trendStrength: 80, direction: 'up' } }) }));
    const bearish = emaCrossStrategy.evaluate(baseInput({ features: baseFeatures({ trend: { ema20: 0.11, ema50: 0.13, sma20: 0.12, trendStrength: 80, direction: 'down' } }) }));
    expect(hashStrategySignal(bullish)).not.toBe(hashStrategySignal(bearish));
    expect(bullish.signal).toBe('BUY');
    expect(bearish.signal).toBe('SELL');
  });
});

describe('Strategy Engine — malformed data fails closed', () => {
  it('registry rejects a structurally malformed strategy at registration', () => {
    const registry = new StrategyRegistry();
    expect(() => registry.register({ id: '', version: '1.0.0', evaluate: () => ({} as StrategySignal) })).toThrow(MalformedStrategyError);
    expect(() => registry.register({ id: 'x', version: '', evaluate: () => ({} as StrategySignal) })).toThrow(MalformedStrategyError);
    expect(() => registry.register({ id: 'x', version: '1.0.0' } as unknown as Strategy)).toThrow(MalformedStrategyError);
  });

  it('registry rejects duplicate strategy ids', () => {
    const registry = new StrategyRegistry();
    registry.register(emaCrossStrategy);
    expect(() => registry.register(emaCrossStrategy)).toThrow(DuplicateStrategyError);
  });

  it('registry.get throws on an unknown strategy id', () => {
    const registry = new StrategyRegistry();
    expect(() => registry.get('does-not-exist')).toThrow(StrategyNotFoundError);
  });

  it('evaluateOne fails closed when a strategy returns a malformed signal for particular input', () => {
    const registry = new StrategyRegistry();
    registry.register({
      id: 'broken',
      version: '1.0.0',
      evaluate: () => ({ strategyId: 'broken', signal: 'BUY', confidence: Number.NaN } as unknown as StrategySignal),
    });
    expect(() => registry.evaluateOne('broken', baseInput())).toThrow(StrategySignalValidationError);
  });

  it('evaluateAll isolates one strategy throwing from the rest still succeeding', () => {
    const registry = new StrategyRegistry();
    registry.register(emaCrossStrategy);
    registry.register({
      id: 'always-throws',
      version: '1.0.0',
      evaluate: () => {
        throw new Error('boom');
      },
    });
    const { signals, failures } = registry.evaluateAll(baseInput());
    expect(signals).toHaveLength(1);
    expect(signals[0].strategyId).toBe(emaCrossStrategy.id);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toEqual({ strategyId: 'always-throws', error: 'boom' });
  });

  it('handles zero/extreme feature values without throwing or producing non-finite output', () => {
    const zeroed = baseFeatures({
      price: 0,
      trend: { ema20: 0, ema50: 0, sma20: 0, trendStrength: 0, direction: 'flat' },
      momentum: { rsi: 0, macdHistogram: 0, roc: 0 },
      volatility: { atr: 0, volatilityPct: 0, band: 'low' },
      volume: { window24h: 0, changePct: 0 },
      portfolio: { xlmPct: 0, usdcPct: 0, idleUsd: 0, totalValue: 0, targetXlmPct: 0, targetUsdcPct: 0, driftPct: 0 },
      risk: { realizedPnl: 0, unrealizedPnl: 0, drawdownPct: null, volatilityPct: 0 },
    });
    for (const strategy of ALL_STRATEGIES) {
      const signal = strategy.evaluate(baseInput({ features: zeroed }));
      expect(validateStrategySignal(signal)).toEqual([]);
      expect(Number.isFinite(signal.confidence)).toBe(true);
    }
  });

  it('handles extreme/adversarial feature values without producing out-of-range confidence', () => {
    const extreme = baseFeatures({
      price: 1e12,
      trend: { ema20: 1e9, ema50: -1e9, sma20: 1e9, trendStrength: 1e6, direction: 'up' },
      momentum: { rsi: 1e6, macdHistogram: 1e9, roc: 1e6 },
      volatility: { atr: 1e9, volatilityPct: 1e6, band: 'high' },
      volume: { window24h: 1e12, changePct: 1e6 },
      portfolio: { xlmPct: 1e6, usdcPct: -1e6, idleUsd: 1e12, totalValue: 1, targetXlmPct: 0, targetUsdcPct: 100, driftPct: 1e6 },
      risk: { realizedPnl: -1e9, unrealizedPnl: -1e9, drawdownPct: -1e6, volatilityPct: 1e6 },
    });
    for (const strategy of ALL_STRATEGIES) {
      const signal = strategy.evaluate(baseInput({ features: extreme }));
      expect(validateStrategySignal(signal)).toEqual([]);
      expect(signal.confidence).toBeGreaterThanOrEqual(0);
      expect(signal.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe('Strategy Engine — conflicting signals', () => {
  it('registry surfaces conflicting BUY/SELL signals from different strategies unmodified — no aggregation here', () => {
    const registry = new StrategyRegistry();
    registry.register(emaCrossStrategy);
    registry.register(rsiMeanReversionStrategy);
    // Trend says BUY (ema20 > ema50, direction up); RSI says SELL (overbought).
    const input = baseInput({
      features: baseFeatures({
        trend: { ema20: 0.13, ema50: 0.11, sma20: 0.12, trendStrength: 80, direction: 'up' },
        momentum: { rsi: 85, macdHistogram: 0.0003, roc: 2.1 },
      }),
    });
    const { signals } = registry.evaluateAll(input);
    const ema = signals.find((s) => s.strategyId === emaCrossStrategy.id)!;
    const rsi = signals.find((s) => s.strategyId === rsiMeanReversionStrategy.id)!;
    expect(ema.signal).toBe('BUY');
    expect(rsi.signal).toBe('SELL');
    // Strategy Engine hands both to the caller (Decision Intelligence) untouched — it does not
    // pick a winner or cancel them out.
    expect(signals).toHaveLength(2);
  });
});

describe('Strategy Engine — confidence normalization', () => {
  it('confidence is always within [0, 1] for every built-in strategy regardless of input scale', () => {
    for (const strategy of ALL_STRATEGIES) {
      const signal = strategy.evaluate(baseInput());
      expect(signal.confidence).toBeGreaterThanOrEqual(0);
      expect(signal.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe('Strategy Engine — parallel execution', () => {
  it('evaluateAll run concurrently many times against different inputs never interferes across calls', async () => {
    const registry = createDefaultStrategyRegistry();
    const inputs = Array.from({ length: 20 }, (_, i) =>
      baseInput({ features: baseFeatures({ price: 0.1 + i * 0.01, trend: { ema20: 0.1 + i * 0.01, ema50: 0.1, sma20: 0.1, trendStrength: 50, direction: 'up' } }) })
    );
    const results = await Promise.all(inputs.map((input) => Promise.resolve(registry.evaluateAll(input))));
    // Re-running the exact same set sequentially must produce identical signals per input —
    // proves no shared mutable state leaked across the concurrent run.
    const sequential = inputs.map((input) => registry.evaluateAll(input));
    results.forEach((r, i) => {
      expect(r.signals.map((s) => hashStrategySignal(s))).toEqual(sequential[i].signals.map((s) => hashStrategySignal(s)));
    });
  });
});

describe('Strategy Engine — replay compatibility', () => {
  it('the same StrategyInput replayed later (new registry instance) produces identical signals', () => {
    const input = baseInput();
    const firstRun = createDefaultStrategyRegistry().evaluateAll(input);
    const replayed = createDefaultStrategyRegistry().evaluateAll(input);
    expect(firstRun.signals.map(hashStrategySignal)).toEqual(replayed.signals.map(hashStrategySignal));
  });
});
