// Breakout: price breaking above/below its EMA50 (a proxy resistance/support level, since no raw
// range/high-low series reaches this layer) on a volume spike + high-volatility band —
// confirmation-heavy so it doesn't fire on ordinary trend drift.
import { normalizeConfidence } from '../util.js';
import type { Strategy, StrategyInput, StrategySignal } from '../types.js';

export const BREAKOUT_STRATEGY_ID = 'breakout';

const VOLUME_SPIKE_PCT = 20;

export const breakoutStrategy: Strategy = {
  id: BREAKOUT_STRATEGY_ID,
  version: '1.0.0',
  evaluate(input: StrategyInput): StrategySignal {
    const { price } = input.features;
    const { ema50 } = input.features.trend;
    const { changePct } = input.features.volume;
    const { band, atr } = input.features.volatility;

    const volumeSpike = changePct >= VOLUME_SPIKE_PCT;
    const highVol = band === 'high';

    let signal: StrategySignal['signal'] = 'HOLD';
    if (price > ema50 && volumeSpike && highVol) signal = 'BUY';
    else if (price < ema50 && volumeSpike && highVol) signal = 'SELL';

    const confidence = normalizeConfidence(signal === 'HOLD' ? 0.15 : 0.5 + Math.min(changePct, 100) / 200);

    return {
      strategyId: BREAKOUT_STRATEGY_ID,
      signal,
      confidence,
      reasoning:
        signal === 'HOLD'
          ? `No confirmed breakout: price ${price > ema50 ? 'above' : 'below'} EMA50, volume spike ${volumeSpike}, high volatility ${highVol}.`
          : `Price broke ${signal === 'BUY' ? 'above' : 'below'} EMA50 (${ema50.toFixed(6)}) with a ${changePct.toFixed(1)}% volume spike during a high-volatility regime.`,
      indicatorsUsed: ['features.price', 'trend.ema50', 'volume.changePct', 'volatility.band'],
      entry: signal === 'HOLD' ? null : price,
      exit: null,
      stopLoss: signal === 'BUY' ? price - atr : signal === 'SELL' ? price + atr : null,
      takeProfit: signal === 'BUY' ? price + atr * 2.5 : signal === 'SELL' ? price - atr * 2.5 : null,
      risk: 'high',
      metadata: { volumeSpike, highVol, changePct },
    };
  },
};
