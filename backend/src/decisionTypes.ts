export interface IndicatorSnapshot {
  rsi: number;
  macd: { MACD: number; signal: number; histogram: number };
  ema20: number;
  ema50: number;
  sma20: number;
  atr: number;
}

export interface RegimeMetrics {
  regime: 'trending_up' | 'trending_down' | 'ranging' | 'volatile';
  volatilityPct: number;
  momentum: number;
  trendStrength: number;
  liquidity: number;
}

export interface MarketContext {
  pair: string;
  price: number;
  change24h: number;
  volume24h: number;
  indicators: IndicatorSnapshot;
  regime: RegimeMetrics;
  candles: { time: number; open: number; high: number; low: number; close: number; volume: number }[];
}

export interface AgentDecision {
  action: 'buy' | 'sell' | 'hold' | 'reallocate' | 'rebalance';
  confidence: number;
  reasoning: string;
  selectedStrategy?: string | null;
  targetAllocation?: { xlmPct: number; usdcPct: number };
  yieldVenue?: string | null;
  llmModel?: string | null;
  llmPromptSummary?: string | null;
  llmResponseRaw?: unknown;
}
