import { EMA } from 'technicalindicators';
import { MarketSnapshot } from '../../oracle/types';

export class StrategyEngine {
    /**
     * Evaluates EMA 20 / EMA 50 crossover strategy.
     * Returns:
     * - BUY: If EMA 20 crossed above EMA 50 (Golden Cross)
     * - SELL: If EMA 20 crossed below EMA 50 (Death Cross)
     * - HOLD: Otherwise
     */
    evaluate(snapshot: MarketSnapshot): 'BUY' | 'SELL' | 'HOLD' {
        const candles = snapshot.candles;
        if (!candles || candles.length < 52) {
            // Need enough history to compute current and previous EMAs (at least 50 + 2)
            return 'HOLD';
        }

        const closes = candles.map(c => c.close);
        const ema20Array = EMA.calculate({ period: 20, values: closes });
        const ema50Array = EMA.calculate({ period: 50, values: closes });

        if (ema20Array.length < 2 || ema50Array.length < 2) {
            return 'HOLD';
        }

        const currentEma20 = ema20Array[ema20Array.length - 1];
        const currentEma50 = ema50Array[ema50Array.length - 1];
        const prevEma20 = ema20Array[ema20Array.length - 2];
        const prevEma50 = ema50Array[ema50Array.length - 2];

        // Golden Cross: EMA 20 crosses above EMA 50
        if (prevEma20 <= prevEma50 && currentEma20 > currentEma50) {
            return 'BUY';
        }

        // Death Cross: EMA 20 crosses below EMA 50
        if (prevEma20 >= prevEma50 && currentEma20 < currentEma50) {
            return 'SELL';
        }

        return 'HOLD';
    }
}
