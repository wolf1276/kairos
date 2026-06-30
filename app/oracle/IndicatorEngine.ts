import { EMA, SMA, RSI, MACD, ATR } from 'technicalindicators';
import { Candle } from './types';

export class IndicatorEngine {
    /**
     * Calculates indicators (EMA20, EMA50, SMA20, RSI, MACD, ATR) for a given series of candles.
     * Uses the latest value from every indicator.
     */
    calculate(candles: Candle[]) {
        if (!candles || candles.length < 50) {
            throw new Error(`IndicatorEngine.calculate: Insufficient candles. Need at least 50 candles, got ${candles?.length ?? 0}`);
        }

        const closes = candles.map((c) => c.close);
        const highs = candles.map((c) => c.high);
        const lows = candles.map((c) => c.low);

        const ema20Array = EMA.calculate({ period: 20, values: closes });
        const ema50Array = EMA.calculate({ period: 50, values: closes });
        const sma20Array = SMA.calculate({ period: 20, values: closes });
        const rsiArray = RSI.calculate({ period: 14, values: closes });
        const macdArray = MACD.calculate({
            values: closes,
            fastPeriod: 12,
            slowPeriod: 26,
            signalPeriod: 9,
            SimpleMAOscillator: false,
            SimpleMASignal: false
        });
        const atrArray = ATR.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: 14
        });

        const ema20 = ema20Array[ema20Array.length - 1];
        const ema50 = ema50Array[ema50Array.length - 1];
        const sma20 = sma20Array[sma20Array.length - 1];
        const rsi = rsiArray[rsiArray.length - 1];
        const macdLatest = macdArray[macdArray.length - 1];
        const atr = atrArray[atrArray.length - 1];

        if (
            ema20 === undefined ||
            ema50 === undefined ||
            sma20 === undefined ||
            rsi === undefined ||
            macdLatest === undefined ||
            macdLatest.MACD === undefined ||
            macdLatest.signal === undefined ||
            macdLatest.histogram === undefined ||
            atr === undefined
        ) {
            throw new Error('IndicatorEngine.calculate: Calculated indicator value is undefined due to insufficient history or invalid candle data');
        }

        return {
            ema20,
            ema50,
            sma20,
            rsi,
            macd: {
                MACD: macdLatest.MACD,
                signal: macdLatest.signal,
                histogram: macdLatest.histogram
            },
            atr
        };
    }
}
