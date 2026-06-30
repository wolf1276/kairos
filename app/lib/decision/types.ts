import { MarketSnapshot } from '../../oracle/types';

export interface WalletContext {
    address?: string;
    balance?: number;
}

export interface TradingProfile {
    goal: string;
    riskTolerance: 'LOW' | 'MODERATE' | 'HIGH' | string;
    investmentHorizon: 'SHORT' | 'MEDIUM' | 'LONG' | string;
    allowedAssets: string[];
    dailyTradeLimit: number;
    maxPositionSize: number;
    stopLossPreference: number;
    takeProfitPreference: number;
}

export interface StrategyConfiguration {
    strategyName: string;
    parameters?: Record<string, unknown>;
}

export interface AgentConfiguration {
    sessionDuration: number;
    delegatedCapital: number;
    maxDailyLoss: number;
    maxTradeSize: number;
    maxTradesPerDay: number;
    allowedAssets: string[];
    allowedProtocols: string[];
    emergencyStop: boolean;
    compoundProfits: boolean;
}

export interface DelegationContext {
    delegatedAddress?: string;
    delegatedAmount?: number;
    automationMode?: 'AI_MANAGED' | 'STRATEGY_MANAGED' | 'AUTONOMOUS_AI';
    tradingProfile?: TradingProfile;
    strategyConfiguration?: StrategyConfiguration;
    agentConfiguration?: AgentConfiguration;
    intentText?: string;
    text?: string;
}

export interface TradingContext {
    walletContext: WalletContext;
    marketSnapshot: MarketSnapshot;
    delegationContext: DelegationContext;
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

