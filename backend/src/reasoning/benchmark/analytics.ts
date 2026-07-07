// Pure, synchronous statistics helpers for the Benchmark Center (Phase 7). Every function is a
// direct, textbook aggregation over the numbers it is given — never an inference or estimate.
// Returns `null` whenever there isn't enough real data for the statistic to be meaningful (never
// fabricated as 0), same convention as `learningEngine/analytics.ts::computeAverageFromSemanticPrefix`.

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

/** Population standard deviation (divides by n, not n-1) — this describes the observed sample
 *  itself, not an estimate of a wider population, so the population formula is the honest one. */
export function populationStdDev(values: number[]): number | null {
  if (values.length === 0) return null;
  const m = mean(values) as number;
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Nearest-rank percentile over a copy of `values` (never mutates the input). */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

/** Maximum peak-to-trough decline over a cumulative-PnL walk, in the order `pnlSeries` is given
 *  (callers must pass runs in chronological order). `null` when there is no series to walk. */
export function maxDrawdown(pnlSeries: number[]): number | null {
  if (pnlSeries.length === 0) return null;
  let cumulative = 0;
  let peak = 0;
  let worstDrawdown = 0;
  for (const pnl of pnlSeries) {
    cumulative += pnl;
    peak = Math.max(peak, cumulative);
    worstDrawdown = Math.max(worstDrawdown, peak - cumulative);
  }
  return worstDrawdown;
}

/** Mean/populationStdDev of a per-run PnL series — `null` when there are fewer than two samples
 *  or the series has zero variance (a Sharpe ratio is undefined, not zero, in either case). */
export function sharpeRatio(pnlSeries: number[]): number | null {
  if (pnlSeries.length < 2) return null;
  const m = mean(pnlSeries) as number;
  const sd = populationStdDev(pnlSeries) as number;
  if (sd === 0) return null;
  return m / sd;
}
