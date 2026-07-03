// Registry of pure-signal quant strategies. Each strategy is a small, deterministic function
// over OHLCV candles — no I/O, no side effects — so it can be unit-tested and evaluated
// synchronously on every scheduler tick. `tick.ts` looks strategies up by `id` here.
import {
  SMA,
  EMA,
  RSI,
  MACD,
  BollingerBands,
  Stochastic,
  ADX,
  WilliamsR,
  CCI,
  ROC,
  ATR,
  PSAR,
  VWAP,
  IchimokuCloud,
  KeltnerChannels,
  TRIX,
  AwesomeOscillator,
  MFI,
  OBV,
  WMA,
} from 'technicalindicators';

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Signal = 'buy' | 'sell' | 'hold';

export interface StrategyDef {
  id: string;
  name: string;
  category: string;
  description: string;
  evaluate(candles: Candle[]): Signal;
}

export interface StrategyMeta {
  id: string;
  name: string;
  category: string;
  description: string;
}

function closes(c: Candle[]) {
  return c.map((x) => x.close);
}
function highs(c: Candle[]) {
  return c.map((x) => x.high);
}
function lows(c: Candle[]) {
  return c.map((x) => x.low);
}
function volumes(c: Candle[]) {
  return c.map((x) => x.volume);
}

function last<T>(arr: T[]): T | undefined {
  return arr.length ? arr[arr.length - 1] : undefined;
}

function crossUp(fast: number[], slow: number[]): boolean {
  if (fast.length < 2 || slow.length < 2) return false;
  const fp = fast[fast.length - 2];
  const fc = fast[fast.length - 1];
  const sp = slow[slow.length - 2];
  const sc = slow[slow.length - 1];
  return fp <= sp && fc > sc;
}

function crossDown(fast: number[], slow: number[]): boolean {
  if (fast.length < 2 || slow.length < 2) return false;
  const fp = fast[fast.length - 2];
  const fc = fast[fast.length - 1];
  const sp = slow[slow.length - 2];
  const sc = slow[slow.length - 1];
  return fp >= sp && fc < sc;
}

function crossSignal(fast: number[], slow: number[]): Signal {
  if (crossUp(fast, slow)) return 'buy';
  if (crossDown(fast, slow)) return 'sell';
  return 'hold';
}

// Align two series of possibly different lengths (indicator libs often trim leading values):
// take the last N of each where N = min length, so index-by-index comparisons line up.
function alignTail(a: number[], b: number[]): [number[], number[]] {
  const n = Math.min(a.length, b.length);
  return [a.slice(a.length - n), b.slice(b.length - n)];
}

// ── SMA cross family ──
function smaCross(fastPeriod: number, slowPeriod: number) {
  return (candles: Candle[]): Signal => {
    const c = closes(candles);
    if (c.length < slowPeriod + 2) return 'hold';
    const fast = SMA.calculate({ period: fastPeriod, values: c });
    const slow = SMA.calculate({ period: slowPeriod, values: c });
    const [af, as] = alignTail(fast, slow);
    return crossSignal(af, as);
  };
}

// ── EMA cross family ──
function emaCross(fastPeriod: number, slowPeriod: number) {
  return (candles: Candle[]): Signal => {
    const c = closes(candles);
    if (c.length < slowPeriod + 2) return 'hold';
    const fast = EMA.calculate({ period: fastPeriod, values: c });
    const slow = EMA.calculate({ period: slowPeriod, values: c });
    const [af, as] = alignTail(fast, slow);
    return crossSignal(af, as);
  };
}

function rsiThreshold(period: number, oversold: number, overbought: number) {
  return (candles: Candle[]): Signal => {
    const c = closes(candles);
    if (c.length < period + 2) return 'hold';
    const values = RSI.calculate({ period, values: c });
    const v = last(values);
    if (v === undefined) return 'hold';
    if (v <= oversold) return 'buy';
    if (v >= overbought) return 'sell';
    return 'hold';
  };
}

function macdCross() {
  return (candles: Candle[]): Signal => {
    const c = closes(candles);
    if (c.length < 40) return 'hold';
    const values = MACD.calculate({
      values: c,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });
    if (values.length < 2) return 'hold';
    const prev = values[values.length - 2];
    const curr = values[values.length - 1];
    if (prev.MACD === undefined || prev.signal === undefined || curr.MACD === undefined || curr.signal === undefined) return 'hold';
    if (prev.MACD <= prev.signal && curr.MACD > curr.signal) return 'buy';
    if (prev.MACD >= prev.signal && curr.MACD < curr.signal) return 'sell';
    return 'hold';
  };
}

function bollingerBreakout(period = 20, stdDev = 2) {
  return (candles: Candle[]): Signal => {
    const c = closes(candles);
    if (c.length < period + 1) return 'hold';
    const bands = BollingerBands.calculate({ period, values: c, stdDev });
    const band = last(bands);
    const price = last(c);
    if (!band || price === undefined) return 'hold';
    if (price > band.upper) return 'buy';
    if (price < band.lower) return 'sell';
    return 'hold';
  };
}

function bollingerMeanReversion(period = 20, stdDev = 2) {
  return (candles: Candle[]): Signal => {
    const c = closes(candles);
    if (c.length < period + 1) return 'hold';
    const bands = BollingerBands.calculate({ period, values: c, stdDev });
    const band = last(bands);
    const price = last(c);
    if (!band || price === undefined) return 'hold';
    // Contrarian: buy when price dips below lower band (expect reversion up), sell when it
    // pokes above the upper band (expect reversion down) — opposite bias to the breakout variant.
    if (price < band.lower) return 'buy';
    if (price > band.upper) return 'sell';
    return 'hold';
  };
}

function stochasticCross(period = 14, signalPeriod = 3) {
  return (candles: Candle[]): Signal => {
    if (candles.length < period + signalPeriod + 1) return 'hold';
    const values = Stochastic.calculate({
      high: highs(candles),
      low: lows(candles),
      close: closes(candles),
      period,
      signalPeriod,
    });
    if (values.length < 2) return 'hold';
    const prev = values[values.length - 2];
    const curr = values[values.length - 1];
    if (prev.k <= prev.d && curr.k > curr.d) return 'buy';
    if (prev.k >= prev.d && curr.k < curr.d) return 'sell';
    return 'hold';
  };
}

function adxTrend(period = 14, threshold = 25) {
  return (candles: Candle[]): Signal => {
    if (candles.length < period * 2) return 'hold';
    const values = ADX.calculate({ high: highs(candles), low: lows(candles), close: closes(candles), period });
    const v = last(values);
    if (!v) return 'hold';
    if (v.adx >= threshold && v.pdi > v.mdi) return 'buy';
    if (v.adx >= threshold && v.mdi > v.pdi) return 'sell';
    return 'hold';
  };
}

function williamsR(period = 14, oversold = -80, overbought = -20) {
  return (candles: Candle[]): Signal => {
    if (candles.length < period + 1) return 'hold';
    const values = WilliamsR.calculate({ high: highs(candles), low: lows(candles), close: closes(candles), period });
    const v = last(values);
    if (v === undefined) return 'hold';
    if (v <= oversold) return 'buy';
    if (v >= overbought) return 'sell';
    return 'hold';
  };
}

function cciThreshold(period = 20, oversold = -100, overbought = 100) {
  return (candles: Candle[]): Signal => {
    if (candles.length < period + 1) return 'hold';
    const values = CCI.calculate({ high: highs(candles), low: lows(candles), close: closes(candles), period });
    const v = last(values);
    if (v === undefined) return 'hold';
    if (v <= oversold) return 'buy';
    if (v >= overbought) return 'sell';
    return 'hold';
  };
}

function rocMomentum(period = 12) {
  return (candles: Candle[]): Signal => {
    const c = closes(candles);
    if (c.length < period + 2) return 'hold';
    const values = ROC.calculate({ period, values: c });
    if (values.length < 2) return 'hold';
    const prev = values[values.length - 2];
    const curr = values[values.length - 1];
    if (prev <= 0 && curr > 0) return 'buy';
    if (prev >= 0 && curr < 0) return 'sell';
    return 'hold';
  };
}

function atrBreakout(period = 14, multiplier = 1.5) {
  return (candles: Candle[]): Signal => {
    if (candles.length < period + 2) return 'hold';
    const atrValues = ATR.calculate({ high: highs(candles), low: lows(candles), close: closes(candles), period });
    const atr = last(atrValues);
    const c = closes(candles);
    if (atr === undefined || c.length < 2) return 'hold';
    const prevClose = c[c.length - 2];
    const currClose = c[c.length - 1];
    if (currClose - prevClose > multiplier * atr) return 'buy';
    if (prevClose - currClose > multiplier * atr) return 'sell';
    return 'hold';
  };
}

function donchianBreakout(period = 20) {
  return (candles: Candle[]): Signal => {
    if (candles.length < period + 1) return 'hold';
    const window = candles.slice(-period - 1, -1);
    const upper = Math.max(...window.map((c) => c.high));
    const lower = Math.min(...window.map((c) => c.low));
    const price = last(candles)?.close;
    if (price === undefined) return 'hold';
    if (price > upper) return 'buy';
    if (price < lower) return 'sell';
    return 'hold';
  };
}

function parabolicSarFlip(step = 0.02, max = 0.2) {
  return (candles: Candle[]): Signal => {
    if (candles.length < 5) return 'hold';
    const values = PSAR.calculate({ high: highs(candles), low: lows(candles), step, max });
    if (values.length < 2) return 'hold';
    const c = closes(candles);
    const prevSar = values[values.length - 2];
    const currSar = values[values.length - 1];
    const prevClose = c[c.length - 2];
    const currClose = c[c.length - 1];
    // A "flip" is the SAR crossing from one side of price to the other between bars.
    if (prevSar > prevClose && currSar < currClose) return 'buy';
    if (prevSar < prevClose && currSar > currClose) return 'sell';
    return 'hold';
  };
}

function vwapReversion() {
  return (candles: Candle[]): Signal => {
    if (candles.length < 5) return 'hold';
    const values = VWAP.calculate({ high: highs(candles), low: lows(candles), close: closes(candles), volume: volumes(candles) });
    const vwap = last(values);
    const price = last(closes(candles));
    if (vwap === undefined || price === undefined) return 'hold';
    const deviation = (price - vwap) / vwap;
    if (deviation < -0.01) return 'buy';
    if (deviation > 0.01) return 'sell';
    return 'hold';
  };
}

function ichimokuCross(conversionPeriod = 9, basePeriod = 26) {
  return (candles: Candle[]): Signal => {
    if (candles.length < basePeriod + 2) return 'hold';
    const values = IchimokuCloud.calculate({
      high: highs(candles),
      low: lows(candles),
      conversionPeriod,
      basePeriod,
      spanPeriod: 52,
      displacement: 26,
    });
    if (values.length < 2) return 'hold';
    const prev = values[values.length - 2];
    const curr = values[values.length - 1];
    if (prev.conversion === undefined || prev.base === undefined || curr.conversion === undefined || curr.base === undefined) return 'hold';
    if (prev.conversion <= prev.base && curr.conversion > curr.base) return 'buy';
    if (prev.conversion >= prev.base && curr.conversion < curr.base) return 'sell';
    return 'hold';
  };
}

function keltnerBreakout(period = 20, multiplier = 2) {
  return (candles: Candle[]): Signal => {
    if (candles.length < period + 2) return 'hold';
    const values = KeltnerChannels.calculate({
      high: highs(candles),
      low: lows(candles),
      close: closes(candles),
      maPeriod: period,
      atrPeriod: period,
      multiplier,
      useSMA: true,
    });
    const band = last(values);
    const price = last(closes(candles));
    if (!band || price === undefined) return 'hold';
    if (price > band.upper) return 'buy';
    if (price < band.lower) return 'sell';
    return 'hold';
  };
}

function trixCross(period = 15) {
  return (candles: Candle[]): Signal => {
    const c = closes(candles);
    if (c.length < period * 3) return 'hold';
    const values = TRIX.calculate({ period, values: c });
    if (values.length < 2) return 'hold';
    const prev = values[values.length - 2];
    const curr = values[values.length - 1];
    if (prev <= 0 && curr > 0) return 'buy';
    if (prev >= 0 && curr < 0) return 'sell';
    return 'hold';
  };
}

function awesomeOscillatorZeroCross() {
  return (candles: Candle[]): Signal => {
    if (candles.length < 36) return 'hold';
    const values = AwesomeOscillator.calculate({ high: highs(candles), low: lows(candles), fastPeriod: 5, slowPeriod: 34 });
    if (values.length < 2) return 'hold';
    const prev = values[values.length - 2];
    const curr = values[values.length - 1];
    if (prev <= 0 && curr > 0) return 'buy';
    if (prev >= 0 && curr < 0) return 'sell';
    return 'hold';
  };
}

function mfiThreshold(period = 14, oversold = 20, overbought = 80) {
  return (candles: Candle[]): Signal => {
    if (candles.length < period + 2) return 'hold';
    const values = MFI.calculate({ high: highs(candles), low: lows(candles), close: closes(candles), volume: volumes(candles), period });
    const v = last(values);
    if (v === undefined) return 'hold';
    if (v <= oversold) return 'buy';
    if (v >= overbought) return 'sell';
    return 'hold';
  };
}

function obvTrendConfirmation(smaPeriod = 20) {
  return (candles: Candle[]): Signal => {
    if (candles.length < smaPeriod + 2) return 'hold';
    const obv = OBV.calculate({ close: closes(candles), volume: volumes(candles) });
    if (obv.length < smaPeriod + 1) return 'hold';
    const obvSma = SMA.calculate({ period: smaPeriod, values: obv });
    const [ao, as] = alignTail(obv, obvSma);
    return crossSignal(ao, as);
  };
}

// Simplified SuperTrend: uses ATR bands around an SMA midline and flags a flip when price
// crosses from one side to the other, mirroring the classic SuperTrend flip signal without
// needing a stateful trailing-stop implementation.
function superTrendFlip(period = 10, multiplier = 3) {
  return (candles: Candle[]): Signal => {
    if (candles.length < period + 2) return 'hold';
    const atrValues = ATR.calculate({ high: highs(candles), low: lows(candles), close: closes(candles), period });
    const smaValues = SMA.calculate({ period, values: closes(candles) });
    const n = Math.min(atrValues.length, smaValues.length, closes(candles).length);
    if (n < 2) return 'hold';
    const c = closes(candles).slice(-n);
    const atr = atrValues.slice(-n);
    const mid = smaValues.slice(-n);
    const prevUpper = mid[n - 2] + multiplier * atr[n - 2];
    const prevLower = mid[n - 2] - multiplier * atr[n - 2];
    const currUpper = mid[n - 1] + multiplier * atr[n - 1];
    const currLower = mid[n - 1] - multiplier * atr[n - 1];
    if (c[n - 2] <= prevUpper && c[n - 1] > currUpper) return 'buy';
    if (c[n - 2] >= prevLower && c[n - 1] < currLower) return 'sell';
    return 'hold';
  };
}

// Chaikin Money Flow — computed inline (not exported by technicalindicators): money flow
// multiplier * volume, summed over the period and normalized by summed volume.
function chaikinMoneyFlow(period = 20) {
  return (candles: Candle[]): Signal => {
    if (candles.length < period + 1) return 'hold';
    const window = candles.slice(-period);
    let mfvSum = 0;
    let volSum = 0;
    for (const c of window) {
      const range = c.high - c.low;
      const mfm = range === 0 ? 0 : ((c.close - c.low) - (c.high - c.close)) / range;
      mfvSum += mfm * c.volume;
      volSum += c.volume;
    }
    const cmf = volSum === 0 ? 0 : mfvSum / volSum;
    if (cmf > 0.1) return 'buy';
    if (cmf < -0.1) return 'sell';
    return 'hold';
  };
}

// technicalindicators has no DEMA/TEMA/Aroon exports — implemented here from their standard
// formulas, built on the library's EMA primitive.
function dema(values: number[], period: number): number[] {
  const ema1 = EMA.calculate({ period, values });
  const ema2 = EMA.calculate({ period, values: ema1 });
  const [e1, e2] = alignTail(ema1, ema2);
  return e1.map((v, i) => 2 * v - e2[i]);
}

function tema(values: number[], period: number): number[] {
  const ema1 = EMA.calculate({ period, values });
  const ema2 = EMA.calculate({ period, values: ema1 });
  const ema3 = EMA.calculate({ period, values: ema2 });
  const n = Math.min(ema1.length, ema2.length, ema3.length);
  const e1 = ema1.slice(-n);
  const e2 = ema2.slice(-n);
  const e3 = ema3.slice(-n);
  return e1.map((v, i) => 3 * v - 3 * e2[i] + e3[i]);
}

function demaCross(fastPeriod: number, slowPeriod: number) {
  return (candles: Candle[]): Signal => {
    const c = closes(candles);
    if (c.length < slowPeriod * 2) return 'hold';
    const fast = dema(c, fastPeriod);
    const slow = dema(c, slowPeriod);
    const [af, as] = alignTail(fast, slow);
    return crossSignal(af, as);
  };
}

function temaCross(fastPeriod: number, slowPeriod: number) {
  return (candles: Candle[]): Signal => {
    const c = closes(candles);
    if (c.length < slowPeriod * 3) return 'hold';
    const fast = tema(c, fastPeriod);
    const slow = tema(c, slowPeriod);
    const [af, as] = alignTail(fast, slow);
    return crossSignal(af, as);
  };
}

// Hull Moving Average, built from WMA per the standard formula:
// HMA(n) = WMA(2*WMA(n/2) - WMA(n), sqrt(n))
function hma(values: number[], period: number): number[] {
  const half = Math.max(1, Math.round(period / 2));
  const sqrtPeriod = Math.max(1, Math.round(Math.sqrt(period)));
  const wmaHalf = WMA.calculate({ period: half, values });
  const wmaFull = WMA.calculate({ period, values });
  const [wh, wf] = alignTail(wmaHalf, wmaFull);
  const diff = wh.map((v, i) => 2 * v - wf[i]);
  return WMA.calculate({ period: sqrtPeriod, values: diff });
}

function hmaCross(fastPeriod: number, slowPeriod: number) {
  return (candles: Candle[]): Signal => {
    const c = closes(candles);
    if (c.length < slowPeriod * 2 + 5) return 'hold';
    const fast = hma(c, fastPeriod);
    const slow = hma(c, slowPeriod);
    const [af, as] = alignTail(fast, slow);
    return crossSignal(af, as);
  };
}

// technicalindicators has no Aroon export — implemented from the standard formula:
// Aroon-Up = 100 * (period - bars since highest high) / period, Aroon-Down likewise for lows.
function aroonAt(candles: Candle[], period: number, endIndex: number): { up: number; down: number } {
  const window = candles.slice(endIndex - period + 1, endIndex + 1);
  let highestIdx = 0;
  let lowestIdx = 0;
  for (let i = 1; i < window.length; i++) {
    if (window[i].high >= window[highestIdx].high) highestIdx = i;
    if (window[i].low <= window[lowestIdx].low) lowestIdx = i;
  }
  const barsSinceHigh = window.length - 1 - highestIdx;
  const barsSinceLow = window.length - 1 - lowestIdx;
  return {
    up: (100 * (period - barsSinceHigh)) / period,
    down: (100 * (period - barsSinceLow)) / period,
  };
}

function aroonCross(period = 14) {
  return (candles: Candle[]): Signal => {
    if (candles.length < period + 2) return 'hold';
    const prev = aroonAt(candles, period, candles.length - 2);
    const curr = aroonAt(candles, period, candles.length - 1);
    if (prev.up <= prev.down && curr.up > curr.down) return 'buy';
    if (prev.up >= prev.down && curr.up < curr.down) return 'sell';
    return 'hold';
  };
}

export const STRATEGIES: StrategyDef[] = [
  { id: 'sma-cross-10-50', name: 'SMA Cross 10/50', category: 'Moving Average', description: 'Buy when the 10-period SMA crosses above the 50-period SMA, sell on cross below.', evaluate: smaCross(10, 50) },
  { id: 'sma-cross-20-100', name: 'SMA Cross 20/100', category: 'Moving Average', description: 'Buy when the 20-period SMA crosses above the 100-period SMA, sell on cross below.', evaluate: smaCross(20, 100) },
  { id: 'ema-cross-12-26', name: 'EMA Cross 12/26', category: 'Moving Average', description: 'Buy when the 12-period EMA crosses above the 26-period EMA, sell on cross below.', evaluate: emaCross(12, 26) },
  { id: 'ema-cross-9-21', name: 'EMA Cross 9/21', category: 'Moving Average', description: 'Buy when the 9-period EMA crosses above the 21-period EMA, sell on cross below.', evaluate: emaCross(9, 21) },
  { id: 'rsi-14', name: 'RSI(14) Overbought/Oversold', category: 'Oscillator', description: 'Buy when RSI(14) drops to 30 or below, sell at 70 or above.', evaluate: rsiThreshold(14, 30, 70) },
  { id: 'macd-cross', name: 'MACD Signal Cross', category: 'Momentum', description: 'Buy when the MACD line crosses above its signal line, sell on cross below.', evaluate: macdCross() },
  { id: 'bb-breakout', name: 'Bollinger Band Breakout', category: 'Volatility', description: 'Buy on a close above the upper Bollinger Band, sell on a close below the lower band.', evaluate: bollingerBreakout() },
  { id: 'bb-mean-reversion', name: 'Bollinger Band Mean Reversion', category: 'Volatility', description: 'Contrarian: buy when price dips below the lower band, sell when it pokes above the upper band.', evaluate: bollingerMeanReversion() },
  { id: 'stochastic-cross', name: 'Stochastic %K/%D Cross', category: 'Oscillator', description: 'Buy when %K crosses above %D, sell on cross below.', evaluate: stochasticCross() },
  { id: 'adx-trend', name: 'ADX + DI Trend Strength', category: 'Trend', description: 'Buy when ADX signals a strong trend (>=25) with +DI above -DI, sell with -DI above +DI.', evaluate: adxTrend() },
  { id: 'williams-r', name: 'Williams %R', category: 'Oscillator', description: 'Buy when %R falls to -80 or below, sell at -20 or above.', evaluate: williamsR() },
  { id: 'cci', name: 'CCI', category: 'Oscillator', description: 'Buy when CCI falls to -100 or below, sell at +100 or above.', evaluate: cciThreshold() },
  { id: 'roc-momentum', name: 'ROC Momentum', category: 'Momentum', description: 'Buy when the rate-of-change crosses above zero, sell on cross below.', evaluate: rocMomentum() },
  { id: 'atr-breakout', name: 'ATR Volatility Breakout', category: 'Volatility', description: 'Buy/sell when the latest close moves more than 1.5x ATR from the prior close.', evaluate: atrBreakout() },
  { id: 'donchian-breakout', name: 'Donchian Channel Breakout', category: 'Trend', description: 'Buy on a breakout above the prior 20-bar high, sell on a breakdown below the prior 20-bar low.', evaluate: donchianBreakout() },
  { id: 'parabolic-sar-flip', name: 'Parabolic SAR Flip', category: 'Trend', description: 'Buy/sell when the Parabolic SAR dot flips from one side of price to the other.', evaluate: parabolicSarFlip() },
  { id: 'vwap-reversion', name: 'VWAP Reversion', category: 'Mean Reversion', description: 'Buy when price is more than 1% below VWAP, sell when more than 1% above.', evaluate: vwapReversion() },
  { id: 'ichimoku-cross', name: 'Ichimoku Tenkan/Kijun Cross', category: 'Trend', description: 'Buy when Tenkan-sen crosses above Kijun-sen, sell on cross below.', evaluate: ichimokuCross() },
  { id: 'keltner-breakout', name: 'Keltner Channel Breakout', category: 'Volatility', description: 'Buy on a close above the upper Keltner Channel, sell on a close below the lower channel.', evaluate: keltnerBreakout() },
  { id: 'trix-cross', name: 'TRIX Signal Cross', category: 'Momentum', description: 'Buy when TRIX crosses above zero, sell on cross below.', evaluate: trixCross() },
  { id: 'awesome-oscillator', name: 'Awesome Oscillator Zero-Cross', category: 'Momentum', description: 'Buy when the Awesome Oscillator crosses above zero, sell on cross below.', evaluate: awesomeOscillatorZeroCross() },
  { id: 'mfi', name: 'MFI Overbought/Oversold', category: 'Oscillator', description: 'Buy when the Money Flow Index falls to 20 or below, sell at 80 or above.', evaluate: mfiThreshold() },
  { id: 'obv-trend', name: 'OBV Trend Confirmation', category: 'Volume', description: 'Buy/sell when On-Balance Volume crosses its own 20-period moving average.', evaluate: obvTrendConfirmation() },
  { id: 'supertrend-flip', name: 'SuperTrend Flip', category: 'Trend', description: 'Buy/sell when price flips across ATR-based trend bands around a moving-average midline.', evaluate: superTrendFlip() },
  { id: 'chaikin-money-flow', name: 'Chaikin Money Flow', category: 'Volume', description: 'Buy when 20-period Chaikin Money Flow is strongly positive, sell when strongly negative.', evaluate: chaikinMoneyFlow() },
  { id: 'dema-cross', name: 'DEMA Cross', category: 'Moving Average', description: 'Buy when the fast DEMA crosses above the slow DEMA, sell on cross below.', evaluate: demaCross(10, 30) },
  { id: 'tema-cross', name: 'TEMA Cross', category: 'Moving Average', description: 'Buy when the fast TEMA crosses above the slow TEMA, sell on cross below.', evaluate: temaCross(10, 30) },
  { id: 'hma-cross', name: 'HMA Cross', category: 'Moving Average', description: 'Buy when the fast Hull Moving Average crosses above the slow HMA, sell on cross below.', evaluate: hmaCross(9, 21) },
  { id: 'aroon-cross', name: 'Aroon Up/Down Cross', category: 'Trend', description: 'Buy when Aroon-Up crosses above Aroon-Down, sell on cross below.', evaluate: aroonCross() },
];

export function getStrategy(id: string): StrategyDef | undefined {
  return STRATEGIES.find((s) => s.id === id);
}

export function listStrategyMeta(): StrategyMeta[] {
  return STRATEGIES.map(({ id, name, category, description }) => ({ id, name, category, description }));
}
