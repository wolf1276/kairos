// Risk-check circuit breakers: volatility ceiling (pre-existing) and cumulative-drawdown ceiling
// (new — an agent must stop trading once it's burned through too much of its allocated capital,
// not just when a single tick looks locally risky).
import { describe, it, expect } from 'vitest';
import { riskChecks } from '../validation.js';
import type { AgentDecision, MarketContext } from '../decisionTypes.js';
import type { RoleStrategyConfig } from '../types.js';

function makeConfig(): RoleStrategyConfig {
  return {
    type: 'role',
    role: 'strategic',
    pair: 'XLM/USDC',
    amountPerTrade: '10000000',
    intervalSeconds: 60,
    minConfidence: 0.5,
    destination: '',
  };
}

function makeDecision(overrides: Partial<AgentDecision> = {}): AgentDecision {
  return { action: 'buy', confidence: 0.9, reasoning: 'test', ...overrides };
}

function makeCtx(volatilityPct = 5): MarketContext {
  return {
    pair: 'XLM/USDC',
    price: 0.4,
    change24h: 0,
    volume24h: 0,
    indicators: { rsi: 50, macd: { MACD: 0, signal: 0, histogram: 0 }, ema20: 0.4, ema50: 0.4, sma20: 0.4, atr: 0 },
    regime: { regime: 'ranging', volatilityPct, momentum: 0, trendStrength: 0, liquidity: 1 },
    candles: [],
  };
}

describe('riskChecks drawdown circuit breaker', () => {
  it('passes when cumulative loss is under the ceiling', () => {
    const result = riskChecks(makeConfig(), makeDecision(), makeCtx(), {
      capital: '1000',
      realizedPnl: '-100',
      unrealizedPnl: '-50',
    });
    expect(result.ok).toBe(true);
    expect(result.metrics.drawdownPct).toBeCloseTo(-15, 5);
  });

  it('blocks once cumulative realized+unrealized loss exceeds the 20% ceiling', () => {
    const result = riskChecks(makeConfig(), makeDecision(), makeCtx(), {
      capital: '1000',
      realizedPnl: '-150',
      unrealizedPnl: '-60',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/drawdown ceiling/);
    expect(result.metrics.drawdownPct).toBeCloseTo(-21, 5);
  });

  it('does not block a profitable agent even with high nominal PnL swing', () => {
    const result = riskChecks(makeConfig(), makeDecision(), makeCtx(), {
      capital: '1000',
      realizedPnl: '500',
      unrealizedPnl: '100',
    });
    expect(result.ok).toBe(true);
  });

  it('stays blocked on the following tick too, since capital/loss do not self-correct', () => {
    const drawdownInputs = { capital: '1000', realizedPnl: '-300', unrealizedPnl: '0' };
    const tick1 = riskChecks(makeConfig(), makeDecision(), makeCtx(), drawdownInputs);
    const tick2 = riskChecks(makeConfig(), makeDecision(), makeCtx(), drawdownInputs);
    expect(tick1.ok).toBe(false);
    expect(tick2.ok).toBe(false);
  });

  it('skips the drawdown check when capital is unset (e.g. legacy agents)', () => {
    const result = riskChecks(makeConfig(), makeDecision(), makeCtx(), {
      capital: null,
      realizedPnl: '-999999',
      unrealizedPnl: '0',
    });
    expect(result.ok).toBe(true);
    expect(result.metrics.drawdownPct).toBeNull();
  });

  it('still enforces the pre-existing volatility ceiling independent of drawdown', () => {
    const result = riskChecks(makeConfig(), makeDecision(), makeCtx(15), {
      capital: '1000',
      realizedPnl: '0',
      unrealizedPnl: '0',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Volatility/);
  });

  it('hold actions are never blocked, regardless of drawdown', () => {
    const result = riskChecks(makeConfig(), makeDecision({ action: 'hold' }), makeCtx(), {
      capital: '1000',
      realizedPnl: '-900',
      unrealizedPnl: '0',
    });
    expect(result.ok).toBe(true);
  });
});
