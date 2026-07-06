// Market-condition scenarios: bull, bear, sideways, high/low volatility, conflicting evidence.
import { deepMerge } from '../utils/deepMerge.js';
import { baseAgentContext, baseMemoryPackage, baseUserPolicy } from './baseFixtures.js';
import type { BenchmarkScenario } from './types.js';

const V = '1.0.0';

export const marketScenarios: BenchmarkScenario[] = [
  {
    id: 'bull_trend',
    name: 'Bull market',
    category: 'bull',
    version: V,
    description: 'Strong uptrend: high trend strength, elevated RSI, positive MACD/ROC, breakout confirmed.',
    agentContext: deepMerge(baseAgentContext(), {
      features: { trend: { direction: 'up', trendStrength: 60 }, momentum: { rsi: 68, macdHistogram: 0.01, roc: 0.05 } },
      regime: { label: 'trending_up', breakout: true },
    }),
    memoryPackage: baseMemoryPackage(),
    userPolicy: baseUserPolicy(),
  },
  {
    id: 'bear_trend',
    name: 'Bear market',
    category: 'bear',
    version: V,
    description: 'Strong downtrend: negative momentum, EMA20 below EMA50, breakout confirmed to the downside.',
    agentContext: deepMerge(baseAgentContext(), {
      features: { trend: { direction: 'down', trendStrength: 60, ema20: 0.09, ema50: 0.11 }, momentum: { rsi: 28, macdHistogram: -0.01, roc: -0.05 } },
      regime: { label: 'trending_down', breakout: true },
    }),
    memoryPackage: baseMemoryPackage(),
    userPolicy: baseUserPolicy(),
  },
  {
    id: 'sideways',
    name: 'Sideways market',
    category: 'sideways',
    version: V,
    description: 'Range-bound market: near-zero trend strength, neutral RSI, no breakout.',
    agentContext: deepMerge(baseAgentContext(), {
      features: { trend: { direction: 'flat', trendStrength: 3 }, momentum: { rsi: 50, macdHistogram: 0.0001, roc: 0.001 } },
      regime: { label: 'ranging', breakout: false },
    }),
    memoryPackage: baseMemoryPackage(),
    userPolicy: baseUserPolicy(),
  },
  {
    id: 'high_volatility',
    name: 'High volatility',
    category: 'high_volatility',
    version: V,
    description: 'Elevated ATR and volatility percentage, volatility band flagged high.',
    agentContext: deepMerge(baseAgentContext(), {
      features: { volatility: { atr: 0.02, volatilityPct: 18, band: 'high' } },
      regime: { volatilityBand: 'high' },
    }),
    memoryPackage: baseMemoryPackage(),
    userPolicy: baseUserPolicy(),
  },
  {
    id: 'low_volatility',
    name: 'Low volatility',
    category: 'low_volatility',
    version: V,
    description: 'Minimal ATR and volatility percentage, volatility band flagged low.',
    agentContext: deepMerge(baseAgentContext(), {
      features: { volatility: { atr: 0.0003, volatilityPct: 0.2, band: 'low' } },
      regime: { volatilityBand: 'low' },
    }),
    memoryPackage: baseMemoryPackage(),
    userPolicy: baseUserPolicy(),
  },
  {
    id: 'conflicting_evidence',
    name: 'Conflicting evidence',
    category: 'conflicting_evidence',
    version: V,
    description: 'Trend indicators say up while momentum indicators (RSI, MACD, ROC) say down — deliberately contradictory signal.',
    agentContext: deepMerge(baseAgentContext(), {
      features: { trend: { direction: 'up', trendStrength: 45, ema20: 0.13, ema50: 0.1 }, momentum: { rsi: 25, macdHistogram: -0.008, roc: -0.03 } },
    }),
    memoryPackage: baseMemoryPackage(),
    userPolicy: baseUserPolicy(),
  },
];
