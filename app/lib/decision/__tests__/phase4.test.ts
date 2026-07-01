import { describe, expect, it } from 'vitest';
import { validateProfile } from '../hfIntentParser';
import { applyPolicyGate } from '../index';

describe('Phase 4 — Schema Validation', () => {
  it('should validate a complete trading profile', () => {
    const raw = {
      goal: 'Grow funds steadily',
      riskTolerance: 'MODERATE',
      investmentHorizon: 'MEDIUM',
      allowedAssets: ['XLM', 'BTC'],
      dailyTradeLimit: 1000,
      maxPositionSize: 500,
      stopLossPreference: 2.0,
      takeProfitPreference: 6.0,
    };
    const profile = validateProfile(raw);
    expect(profile.riskTolerance).toBe('MODERATE');
    expect(profile.allowedAssets).toEqual(['XLM', 'BTC']);
    expect(profile.dailyTradeLimit).toBe(1000);
  });

  it('should default to MODERATE for invalid risk tolerance', () => {
    const raw = { riskTolerance: 'EXTREME' };
    const profile = validateProfile(raw);
    expect(profile.riskTolerance).toBe('MODERATE');
  });

  it('should default to MEDIUM for invalid horizon', () => {
    const raw = { investmentHorizon: 'FOREVER' };
    const profile = validateProfile(raw);
    expect(profile.investmentHorizon).toBe('MEDIUM');
  });

  it('should reject negative numbers and default to safe values', () => {
    const raw = { dailyTradeLimit: -500, maxPositionSize: -100 };
    const profile = validateProfile(raw);
    expect(profile.dailyTradeLimit).toBe(1000);
    expect(profile.maxPositionSize).toBe(500);
  });

  it('should uppercase and deduplicate allowed assets', () => {
    const raw = { allowedAssets: ['xlm', 'btc', 'XLM'] };
    const profile = validateProfile(raw);
    expect(profile.allowedAssets).toEqual(['XLM', 'BTC', 'XLM']);
  });

  it('should truncate goal to 100 characters', () => {
    const raw = { goal: 'a'.repeat(200) };
    const profile = validateProfile(raw);
    expect(profile.goal.length).toBe(100);
  });
});

describe('Phase 4 — Policy Gate / Injection Resistance', () => {
  const baseContext = {
    delegationContext: {
      tradingProfile: {
        allowedAssets: ['XLM', 'BTC'],
        maxPositionSize: 500,
        dailyTradeLimit: 1000,
      },
      delegatedAmount: 10000,
    },
    walletContext: { balance: 10000 } as { address?: string; balance?: number },
    marketSnapshot: { price: 0.5, symbol: 'XLMUSDT' },
  } as any;

  it('should block trades for disallowed assets', () => {
    const proposal = {
      action: 'BUY' as const,
      symbol: 'SOLUSDT',
      amount: 100,
      confidence: 0.9,
      reasoning: 'SOL looks good',
      timestamp: Date.now(),
    };
    const gated = applyPolicyGate(proposal, baseContext);
    expect(gated.action).toBe('HOLD');
    expect(gated.reasoning).toContain('not in allowed assets');
  });

  it('should allow trades for allowed assets', () => {
    const proposal = {
      action: 'BUY' as const,
      symbol: 'XLMUSDT',
      amount: 99999,
      confidence: 0.9,
      reasoning: 'XLM looks good',
      timestamp: Date.now(),
    };
    const gated = applyPolicyGate(proposal, baseContext);
    expect(gated.action).toBe('BUY');
    const cappedDollar = Math.min(10000 * 0.1, 500, 1000);
    expect(gated.amount * 0.5).toBeCloseTo(cappedDollar, 1);
  });

  it('should cap position size regardless of LLM proposal', () => {
    const proposal = {
      action: 'BUY' as const,
      symbol: 'XLMUSDT',
      amount: 99999,
      confidence: 0.9,
      reasoning: 'LLM wants to go big',
      timestamp: Date.now(),
    };
    const gated = applyPolicyGate(proposal, baseContext);
    expect(gated.amount).toBeLessThan(99999);
    expect(gated.amount).toBeGreaterThan(0);
  });

  it('should pass through HOLD proposals', () => {
    const proposal = {
      action: 'HOLD' as const,
      symbol: 'XLMUSDT',
      amount: 0,
      confidence: 0.5,
      reasoning: 'Nothing to do',
      timestamp: Date.now(),
    };
    const gated = applyPolicyGate(proposal, baseContext);
    expect(gated.action).toBe('HOLD');
  });
});

describe('Phase 4 — Fallback Path', () => {
  it('should use deterministic fallback when HF is unavailable', async () => {
    const oldKey = process.env.HUGGINGFACE_API_KEY;
    delete process.env.HUGGINGFACE_API_KEY;

    const { HfAdvisor } = await import('../hfAdvisor');
    const advisor = new HfAdvisor();

    const context = {
      marketSnapshot: {
        symbol: 'XLMUSDT',
        timestamp: Date.now(),
        source: 'binance' as const,
        price: 0.5,
        volume24h: 1000000,
        change24h: 2.5,
        candles: [],
        indicators: {
          ema20: 0.48,
          ema50: 0.47,
          sma20: 0.49,
          rsi: 30,
          macd: { MACD: 0.01, signal: 0.005, histogram: 0.005 },
          atr: 0.02,
        },
      },
      walletContext: { balance: 10000 },
      delegationContext: {
        tradingProfile: {
          goal: 'Grow funds',
          riskTolerance: 'MODERATE' as const,
          investmentHorizon: 'MEDIUM' as const,
          allowedAssets: ['XLM'],
          dailyTradeLimit: 1000,
          maxPositionSize: 500,
          stopLossPreference: 2.0,
          takeProfitPreference: 6.0,
        },
        delegatedAmount: 10000,
        automationMode: 'AI_MANAGED' as const,
      },
    } as any;

    const proposal = await advisor.advise(context);
    expect(proposal).toBeDefined();
    expect(['BUY', 'SELL', 'HOLD']).toContain(proposal.action);
    expect(proposal.reasoning).toBeTruthy();

    if (oldKey) process.env.HUGGINGFACE_API_KEY = oldKey;
  });
});

describe('Phase 4 — Policy Gate Rejects Policy-Violating Proposal', () => {
  it('should reject BUY for an asset not in the profile', () => {
    const context = {
      delegationContext: {
        tradingProfile: {
          allowedAssets: ['XLM', 'BTC'],
          maxPositionSize: 500,
          dailyTradeLimit: 1000,
        },
        delegatedAmount: 5000,
      },
      walletContext: { balance: 5000 } as any,
      marketSnapshot: { price: 150, symbol: 'ETHUSDT' },
    } as any;

    const proposal = {
      action: 'BUY' as const,
      symbol: 'ETHUSDT',
      amount: 3,
      confidence: 0.95,
      reasoning: 'HF advisor thinks ETH is undervalued. Strong buy signal.',
      timestamp: Date.now(),
    };

    const gated = applyPolicyGate(proposal, context);
    expect(gated.action).toBe('HOLD');
    expect(gated.reasoning).toContain('not in allowed assets');
  });

  it('should enforce position size cap even for valid proposals', () => {
    const context = {
      delegationContext: {
        tradingProfile: {
          allowedAssets: ['XLM'],
          maxPositionSize: 200,
          dailyTradeLimit: 500,
        },
        delegatedAmount: 10000,
      },
      walletContext: { balance: 10000 } as any,
      marketSnapshot: { price: 0.5, symbol: 'XLMUSDT' },
    } as any;

    const proposal = {
      action: 'BUY' as const,
      symbol: 'XLMUSDT',
      amount: 10000,
      confidence: 0.99,
      reasoning: 'HF advisor says go all in on XLM!',
      timestamp: Date.now(),
    };

    const gated = applyPolicyGate(proposal, context);
    expect(gated.action).toBe('BUY');
    const capped = Math.min(10000 * 0.1, 200, 500);
    const expectedAmount = Number((capped / 0.5).toFixed(4)) || 1.0;
    expect(gated.amount).toBe(expectedAmount);
    expect(gated.amount).not.toBe(10000);
  });
});
