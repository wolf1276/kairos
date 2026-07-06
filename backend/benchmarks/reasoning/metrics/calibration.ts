// Confidence calibration checks — detects overconfidence, underconfidence, and confidence
// collapse from a model's confidence distribution. Not a statistical calibration curve (that
// needs ground-truth outcomes, which a live LLM benchmark doesn't have) — a set of heuristic
// flags on the distribution shape itself.
import type { ModelAggregate } from './aggregate.js';

export interface CalibrationFlag {
  modelId: string;
  flags: string[];
  avgConfidence: number | null;
  confidenceStdDev: number | null;
}

/** Below this stddev, confidence is considered "collapsed" — the model outputs nearly the same
 *  confidence regardless of scenario, which defeats the purpose of per-decision confidence. */
const COLLAPSE_STDDEV_THRESHOLD = 0.03;
/** Above this average, flag possible overconfidence — every decision claiming near-certainty
 *  across a deliberately varied scenario set (including conflicting-evidence scenarios) is a
 *  smell, not proof, of overconfidence. */
const OVERCONFIDENCE_MEAN_THRESHOLD = 0.9;
/** Below this average, flag possible underconfidence/excessive hedging. */
const UNDERCONFIDENCE_MEAN_THRESHOLD = 0.4;

export function checkCalibration(agg: ModelAggregate): CalibrationFlag {
  const flags: string[] = [];

  if (agg.avgConfidence !== null) {
    if (agg.avgConfidence >= OVERCONFIDENCE_MEAN_THRESHOLD) {
      flags.push(`overconfidence: avg confidence ${agg.avgConfidence.toFixed(2)} >= ${OVERCONFIDENCE_MEAN_THRESHOLD}`);
    }
    if (agg.avgConfidence <= UNDERCONFIDENCE_MEAN_THRESHOLD) {
      flags.push(`underconfidence: avg confidence ${agg.avgConfidence.toFixed(2)} <= ${UNDERCONFIDENCE_MEAN_THRESHOLD}`);
    }
  }

  if (agg.confidenceStdDev !== null && agg.confidenceStdDev < COLLAPSE_STDDEV_THRESHOLD) {
    flags.push(`confidence collapse: stddev ${agg.confidenceStdDev.toFixed(3)} < ${COLLAPSE_STDDEV_THRESHOLD} across varied scenarios`);
  }

  return { modelId: agg.modelId, flags, avgConfidence: agg.avgConfidence, confidenceStdDev: agg.confidenceStdDev };
}

export function checkAllCalibration(aggregates: ModelAggregate[]): CalibrationFlag[] {
  return aggregates.map(checkCalibration);
}
