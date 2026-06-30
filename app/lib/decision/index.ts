import { TradingContext, TradeProposal } from './types';
import { StrategyEngine } from '../strategy';
import { parseIntent } from './intentParser';

export interface DecisionProvider {
    decide(context: TradingContext): Promise<TradeProposal>;
}

export class LLMDecisionProvider implements DecisionProvider {
    async decide(context: TradingContext): Promise<TradeProposal> {
        const { marketSnapshot, delegationContext, walletContext } = context;
        const price = marketSnapshot.price;
        const symbol = marketSnapshot.symbol;
        const indicators = marketSnapshot.indicators;

        // Retrieve trading profile, or parse it if only text is present
        let profile = delegationContext?.tradingProfile;
        if (!profile) {
            // For backward compatibility or fallback, try to parse from context/defaults
            const text = delegationContext?.intentText || delegationContext?.text || "Grow funds with moderate risk and allow all assets";
            const parsed = parseIntent({ text });
            profile = parsed.profile || {
                goal: "Autonomous Management",
                riskTolerance: "MODERATE",
                investmentHorizon: "MEDIUM",
                allowedAssets: ["BTC", "ETH", "XLM"],
                dailyTradeLimit: 1000,
                maxPositionSize: 500,
                stopLossPreference: 2.0,
                takeProfitPreference: 6.0
            };
        }

        // Enforce allowed assets limit (e.g. check if symbol starts with any of the allowed assets)
        const isAssetAllowed = profile.allowedAssets.some(
            asset => symbol.toUpperCase().includes(asset.toUpperCase())
        );

        if (!isAssetAllowed) {
            return {
                action: 'HOLD',
                symbol,
                amount: 0,
                confidence: 1.0,
                reasoning: `Trade blocked: Symbol ${symbol} is not in the list of allowed assets: ${profile.allowedAssets.join(', ')}.`,
                timestamp: Date.now()
            };
        }

        // Determine proposal amount (capped by maxPositionSize and dailyTradeLimit)
        const funds = delegationContext?.delegatedAmount ?? walletContext?.balance ?? 1000;
        const baseAmount = funds * 0.1; // Standard 10%
        const targetValue = Math.min(baseAmount, profile.maxPositionSize, profile.dailyTradeLimit);
        const amount = Number((targetValue / price).toFixed(4)) || 1.0;

        // Decision logic based on indicators and risk tolerance
        const rsi = indicators.rsi;
        const macdHist = indicators.macd?.histogram ?? 0;
        const ema20 = indicators.ema20;
        const ema50 = indicators.ema50;

        let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
        let reasoning = '';
        let confidence = 0.5;

        // Adjust thresholds based on riskTolerance
        let rsiBuyThreshold = 35;
        let rsiSellThreshold = 65;
        if (profile.riskTolerance === 'LOW') {
            rsiBuyThreshold = 30; // More conservative
            rsiSellThreshold = 70;
        } else if (profile.riskTolerance === 'HIGH') {
            rsiBuyThreshold = 40; // More aggressive
            rsiSellThreshold = 60;
        }

        if (rsi < rsiBuyThreshold && macdHist > 0) {
            action = 'BUY';
            confidence = Number((0.7 + (rsiBuyThreshold - rsi) * 0.01).toFixed(2));
            reasoning = `AI analysis identified an oversold condition (RSI: ${rsi.toFixed(2)}) for ${symbol} with positive MACD histogram shift (${macdHist.toFixed(4)}). Risk tolerance: ${profile.riskTolerance}. Goal: ${profile.goal}.`;
        } else if (rsi > rsiSellThreshold && macdHist < 0) {
            action = 'SELL';
            confidence = Number((0.7 + (rsi - rsiSellThreshold) * 0.01).toFixed(2));
            reasoning = `AI analysis identified an overbought condition (RSI: ${rsi.toFixed(2)}) for ${symbol} combined with a bearish MACD histogram crossover (${macdHist.toFixed(4)}). Risk tolerance: ${profile.riskTolerance}. Goal: ${profile.goal}.`;
        } else {
            action = 'HOLD';
            confidence = 0.6;
            reasoning = `Market indicators are neutral for ${symbol}. RSI is stable at ${rsi.toFixed(2)}. EMA 20 (${ema20.toFixed(2)}) remains in close proximity to EMA 50 (${ema50.toFixed(2)}). Risk tolerance: ${profile.riskTolerance}. Goal: ${profile.goal}.`;
        }

        // Apply custom stopLoss and takeProfit percentages from the profile
        const stopLoss = action === 'BUY' ? Number((price * (1 - profile.stopLossPreference / 100)).toFixed(2)) : action === 'SELL' ? Number((price * (1 + profile.stopLossPreference / 100)).toFixed(2)) : undefined;
        const takeProfit = action === 'BUY' ? Number((price * (1 + profile.takeProfitPreference / 100)).toFixed(2)) : action === 'SELL' ? Number((price * (1 - profile.takeProfitPreference / 100)).toFixed(2)) : undefined;

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
                reasoning = `Strategy triggered a Golden Cross: EMA 20 (${indicators.ema20.toFixed(2)}) crossed above EMA 50 (${indicators.ema50.toFixed(2)}) indicating the start of a new bullish trend.`;
            } else if (action === 'SELL') {
                confidence = 0.85;
                reasoning = `Strategy triggered a Death Cross: EMA 20 (${indicators.ema20.toFixed(2)}) crossed below EMA 50 (${indicators.ema50.toFixed(2)}) indicating the start of a bearish trend.`;
            } else {
                confidence = 0.5;
                reasoning = `Strategy Engine evaluated EMA 20 (${indicators.ema20.toFixed(2)}) and EMA 50 (${indicators.ema50.toFixed(2)}) - no crossover detected.`;
            }
        } else {
            // Placeholder/simulated logic for other strategies like Momentum, Mean Reversion, Breakout
            const rsi = indicators.rsi;
            if (strategyName === 'Mean Reversion') {
                if (rsi < 30) {
                    action = 'BUY';
                    reasoning = `Mean Reversion Strategy: RSI (${rsi.toFixed(2)}) is extremely low, expecting return to mean.`;
                    confidence = 0.80;
                } else if (rsi > 70) {
                    action = 'SELL';
                    reasoning = `Mean Reversion Strategy: RSI (${rsi.toFixed(2)}) is extremely high, expecting return to mean.`;
                    confidence = 0.80;
                }
            } else if (strategyName === 'Momentum') {
                const macdHist = indicators.macd?.histogram ?? 0;
                if (macdHist > 0.5) {
                    action = 'BUY';
                    reasoning = `Momentum Strategy: MACD Histogram is positive and growing (${macdHist.toFixed(4)}), indicating strong upward momentum.`;
                    confidence = 0.75;
                } else if (macdHist < -0.5) {
                    action = 'SELL';
                    reasoning = `Momentum Strategy: MACD Histogram is negative and falling (${macdHist.toFixed(4)}), indicating strong downward momentum.`;
                    confidence = 0.75;
                }
            } else {
                action = 'HOLD';
                reasoning = `Strategy ${strategyName} is active but has not triggered a signal.`;
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
            timestamp: Date.now()
        };
    }
}

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

        // 1. Enforce Emergency Stop
        if (config.emergencyStop) {
            return {
                action: 'HOLD',
                symbol,
                amount: 0,
                confidence: 1.0,
                reasoning: 'Trade blocked: Emergency Stop policy is currently active.',
                timestamp: Date.now()
            };
        }

        // 2. Enforce Allowed Assets
        const isAssetAllowed = config.allowedAssets.some(
            asset => symbol.toUpperCase().includes(asset.toUpperCase())
        );
        if (!isAssetAllowed) {
            return {
                action: 'HOLD',
                symbol,
                amount: 0,
                confidence: 1.0,
                reasoning: `Trade blocked: Symbol ${symbol} is not allowed by runtime policy. Allowed: ${config.allowedAssets.join(', ')}.`,
                timestamp: Date.now()
            };
        }

        // 3. Enforce Allowed Protocols/Exchanges (Optional/Warning)
        // Here we just accept or note it in reasoning

        // 4. Calculate Trade Size and check limits
        const funds = config.delegatedCapital;
        const targetValue = Math.min(config.maxTradeSize, config.maxDailyLoss, funds);
        const amount = Number((targetValue / price).toFixed(4)) || 1.0;

        // AI decision logic
        const rsi = indicators.rsi;
        const macdHist = indicators.macd?.histogram ?? 0;
        let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
        let reasoning = '';
        let confidence = 0.5;

        if (rsi < 35 && macdHist > 0) {
            action = 'BUY';
            confidence = 0.9;
            reasoning = `Autonomous AI running on runtime policy triggered BUY for ${symbol}. RSI: ${rsi.toFixed(2)}, MACD Hist: ${macdHist.toFixed(4)}. Max Daily Loss: ${config.maxDailyLoss}.`;
        } else if (rsi > 65 && macdHist < 0) {
            action = 'SELL';
            confidence = 0.9;
            reasoning = `Autonomous AI running on runtime policy triggered SELL for ${symbol}. RSI: ${rsi.toFixed(2)}, MACD Hist: ${macdHist.toFixed(4)}. Max Daily Loss: ${config.maxDailyLoss}.`;
        } else {
            action = 'HOLD';
            confidence = 0.6;
            reasoning = `Autonomous AI policy evaluated neutral indicators for ${symbol}. RSI: ${rsi.toFixed(2)}. No action taken.`;
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

export class DecisionEngine {
    private llmProvider = new LLMDecisionProvider();
    private strategyProvider = new StrategyDecisionProvider();
    private autonomousProvider = new AutonomousAIDecisionProvider();

    async decide(context: TradingContext): Promise<TradeProposal> {
        const mode = context.delegationContext?.automationMode;
        if (mode === 'AI_MANAGED') {
            return this.llmProvider.decide(context);
        } else if (mode === 'AUTONOMOUS_AI') {
            return this.autonomousProvider.decide(context);
        } else {
            return this.strategyProvider.decide(context);
        }
    }
}
