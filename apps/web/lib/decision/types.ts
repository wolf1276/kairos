export interface TradingProfile {
  goal: string;
  riskTolerance: 'LOW' | 'MODERATE' | 'HIGH' | string;
  investmentHorizon: 'SHORT' | 'MEDIUM' | 'LONG' | string;
  allowedAssets: string[];
  dailyTradeLimit: number;
  maxPositionSize: number;
  stopLossPreference: number;
  takeProfitPreference: number;
  order?: {
    side: 'buy' | 'sell';
    asset: string;
    quantity: number;
    triggerComparator: 'lte' | 'gte' | null;
    triggerPrice: number | null;
  };
}

export interface TradingContext {
  walletContext: { address?: string; balance?: number };
  marketSnapshot: { symbol: string; price: number; change24h: number; volume24h: number; indicators: { rsi: number; ema20: number; ema50: number; sma20: number; macd: { MACD: number; signal: number; histogram: number }; atr: number } };
  delegationContext?: {
    delegatedAddress?: string;
    delegatedAmount?: number;
    automationMode?: string;
    tradingProfile?: TradingProfile;
    strategyConfiguration?: { strategyName: string; parameters?: Record<string, unknown> };
    agentConfiguration?: { sessionDuration: number; delegatedCapital: number; maxDailyLoss: number; maxTradeSize: number; allowedAssets: string[]; emergencyStop: boolean };
  };
}

export interface TradeProposal {
  action: 'BUY' | 'SELL' | 'HOLD';
  symbol: string;
  amount: number;
  confidence: number;
  reasoning: string;
  stopLoss?: number;
  takeProfit?: number;
  timestamp: number;
}
