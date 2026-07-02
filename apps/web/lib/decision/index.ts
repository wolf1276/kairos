import { TradingContext, TradeProposal } from './types';
import { StrategyEngine } from '../strategy';
import { HfAdvisor } from './hfAdvisor';

export interface DecisionProvider {
    decide(context: TradingContext): Promise<TradeProposal>;
}

export { HfAdvisor } from './hfAdvisor';

// ── Policy Gate ──
// Enforces trading profile constraints on any proposed trade.
// The LLM never sizes or authorizes fund-moving actions — this gate does.
export function applyPolicyGate(proposal: TradeProposal, context: TradingContext): TradeProposal {
    const profile = context.delegationContext?.tradingProfile;
    if (!profile) return proposal;

    const symbol = proposal.symbol.toUpperCase();

    // Enforce allowed assets
    if (proposal.action !== 'HOLD' && profile.allowedAssets.length > 0) {
        const isAllowed = profile.allowedAssets.some(
            asset => symbol.includes(asset.toUpperCase())
        );
        if (!isAllowed) {
            return {
                action: 'HOLD',
                symbol,
                amount: 0,
                confidence: 1.0,
                reasoning: `Policy gate blocked: ${symbol} is not in allowed assets (${profile.allowedAssets.join(', ')}). The advisor proposed ${proposal.action} but the policy prevents trading unauthorized assets.`,
                timestamp: Date.now(),
            };
        }
    }

    // Cap position size — LLM never determines position size
    const maxSize = profile.maxPositionSize;
    const dailyLimit = profile.dailyTradeLimit;
    const funds = context.delegationContext?.delegatedAmount ?? context.walletContext?.balance ?? 1000;
    const cappedAmount = Math.min(
        funds * 0.1,
        maxSize,
        dailyLimit
    );
    const price = context.marketSnapshot.price;
    const amount = Number((cappedAmount / price).toFixed(4)) || 1.0;

    return {
        ...proposal,
        amount,
    };
}

// ── Strategy Decision Provider (deterministic, no AI buzzwords) ──

export class StrategyDecisionProvider implements DecisionProvider {
    private strategyEngine = new StrategyEngine();

    async decide(context: TradingContext): Promise<TradeProposal> {
        const { marketSnapshot, delegationContext, walletContext } = context;
        const price = marketSnapshot.price;
        const symbol = marketSnapshot.symbol;
        const indicators = marketSnapshot.indicators;

        const strategyConfig = delegationContext?.strategyConfiguration;
        const strategyName = strategyConfig?.strategyName || 'EMA Crossover';

        const funds = delegationContext?.delegatedAmount ?? walletContext?.balance ?? 1000;
        const amount = Number((funds * 0.1 / price).toFixed(4)) || 1.0;

        let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
        let reasoning = '';
        let confidence = 0.5;

        if (strategyName === 'EMA Crossover') {
            action = this.strategyEngine.evaluate(marketSnapshot);
            if (action === 'BUY') {
                confidence = 0.85;
                reasoning = `EMA Crossover strategy: EMA 20 (${indicators.ema20.toFixed(2)}) crossed above EMA 50 (${indicators.ema50.toFixed(2)}).`;
            } else if (action === 'SELL') {
                confidence = 0.85;
                reasoning = `EMA Crossover strategy: EMA 20 (${indicators.ema20.toFixed(2)}) crossed below EMA 50 (${indicators.ema50.toFixed(2)}).`;
            } else {
                confidence = 0.5;
                reasoning = `EMA Crossover strategy: EMA 20 (${indicators.ema20.toFixed(2)}) and EMA 50 (${indicators.ema50.toFixed(2)}) show no crossover.`;
            }
        } else {
            const rsi = indicators.rsi;
            if (strategyName === 'Mean Reversion') {
                if (rsi < 30) {
                    action = 'BUY';
                    reasoning = `Mean Reversion: RSI (${rsi.toFixed(2)}) indicates oversold.`;
                    confidence = 0.80;
                } else if (rsi > 70) {
                    action = 'SELL';
                    reasoning = `Mean Reversion: RSI (${rsi.toFixed(2)}) indicates overbought.`;
                    confidence = 0.80;
                }
            } else if (strategyName === 'Momentum') {
                const macdHist = indicators.macd?.histogram ?? 0;
                if (macdHist > 0.5) {
                    action = 'BUY';
                    reasoning = `Momentum: MACD histogram positive (${macdHist.toFixed(4)}).`;
                    confidence = 0.75;
                } else if (macdHist < -0.5) {
                    action = 'SELL';
                    reasoning = `Momentum: MACD histogram negative (${macdHist.toFixed(4)}).`;
                    confidence = 0.75;
                }
            } else {
                action = 'HOLD';
                reasoning = `Strategy ${strategyName}: no signal triggered.`;
                confidence = 0.5;
            }
        }

        const atr = indicators.atr || (price * 0.01);
        const stopLoss = action === 'BUY' ? Number((price - 2 * atr).toFixed(2)) : action === 'SELL' ? Number((price + 2 * atr).toFixed(2)) : undefined;
        const takeProfit = action === 'BUY' ? Number((price + 3 * atr).toFixed(2)) : action === 'SELL' ? Number((price - 3 * atr).toFixed(2)) : undefined;

        return {
            action,
            symbol,
            amount,
            confidence,
            reasoning,
            stopLoss,
            takeProfit,
            timestamp: Date.now(),
        };
    }
}

// ── Daily loss tracker ──

const dailyLossTracker = new Map<string, { date: string; loss: number }>();

function getDailyLoss(symbol: string): number {
    const today = new Date().toISOString().split('T')[0];
    const entry = dailyLossTracker.get(symbol);
    if (entry && entry.date === today) return entry.loss;
    return 0;
}

// ── Autonomous AI Provider ──

export class AutonomousAIDecisionProvider implements DecisionProvider {
    async decide(context: TradingContext): Promise<TradeProposal> {
        const { marketSnapshot, delegationContext } = context;
        const price = marketSnapshot.price;
        const symbol = marketSnapshot.symbol;
        const indicators = marketSnapshot.indicators;

        const config = delegationContext?.agentConfiguration;
        if (!config) {
            return {
                action: 'HOLD',
                symbol,
                amount: 0,
                confidence: 0.5,
                reasoning: 'Autonomous AI configuration is missing.',
                timestamp: Date.now()
            };
        }

        if (config.emergencyStop) {
            return {
                action: 'HOLD',
                symbol,
                amount: 0,
                confidence: 1.0,
                reasoning: 'Emergency Stop policy is active.',
                timestamp: Date.now()
            };
        }

        const isAssetAllowed = config.allowedAssets.some(
            asset => symbol.toUpperCase().includes(asset.toUpperCase())
        );
        if (!isAssetAllowed) {
            return {
                action: 'HOLD',
                symbol,
                amount: 0,
                confidence: 1.0,
                reasoning: `Symbol ${symbol} is not allowed. Allowed: ${config.allowedAssets.join(', ')}.`,
                timestamp: Date.now()
            };
        }

        const currentDailyLoss = getDailyLoss(symbol);
        if (currentDailyLoss >= config.maxDailyLoss) {
            return {
                action: 'HOLD',
                symbol,
                amount: 0,
                confidence: 1.0,
                reasoning: `Daily loss cap of $${config.maxDailyLoss} reached for ${symbol}.`,
                timestamp: Date.now()
            };
        }

        const funds = config.delegatedCapital;
        const targetValue = Math.min(config.maxTradeSize, funds);
        const amount = Number((targetValue / price).toFixed(4)) || 1.0;

        const rsi = indicators.rsi;
        const macdHist = indicators.macd?.histogram ?? 0;
        let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
        let reasoning = '';
        let confidence = 0.5;

        if (rsi < 35 && macdHist > 0) {
            action = 'BUY';
            confidence = 0.9;
            reasoning = `Oversold signal: RSI ${rsi.toFixed(2)} with positive MACD. Max daily loss: $${config.maxDailyLoss}.`;
        } else if (rsi > 65 && macdHist < 0) {
            action = 'SELL';
            confidence = 0.9;
            reasoning = `Overbought signal: RSI ${rsi.toFixed(2)} with negative MACD. Max daily loss: $${config.maxDailyLoss}.`;
        } else {
            action = 'HOLD';
            confidence = 0.6;
            reasoning = `Neutral indicators: RSI ${rsi.toFixed(2)}.`;
        }

        const atr = indicators.atr || (price * 0.01);
        const stopLoss = action === 'BUY' ? Number((price - 2 * atr).toFixed(2)) : action === 'SELL' ? Number((price + 2 * atr).toFixed(2)) : undefined;
        const takeProfit = action === 'BUY' ? Number((price + 3 * atr).toFixed(2)) : action === 'SELL' ? Number((price - 3 * atr).toFixed(2)) : undefined;

        return {
            action,
            symbol,
            amount,
            confidence,
            reasoning,
            stopLoss,
            takeProfit,
            timestamp: Date.now()
        };
    }
}

// ── Decision Engine ──

export class DecisionEngine {
    private hfAdvisor = new HfAdvisor();
    private strategyProvider = new StrategyDecisionProvider();
    private autonomousProvider = new AutonomousAIDecisionProvider();

    async decide(context: TradingContext): Promise<TradeProposal> {
        const mode = context.delegationContext?.automationMode;

        let proposal: TradeProposal;

        if (mode === 'AI_MANAGED') {
            proposal = await this.hfAdvisor.advise(context);
        } else if (mode === 'AUTONOMOUS_AI') {
            proposal = await this.autonomousProvider.decide(context);
        } else {
            proposal = await this.strategyProvider.decide(context);
        }

        // Apply policy gate — the only place that determines position size and enforces caveats
        return applyPolicyGate(proposal, context);
    }
}
