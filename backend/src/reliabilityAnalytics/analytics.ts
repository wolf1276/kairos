// Reliability Analytics (Phase 7). Pure aggregation over externally-supplied `ReliabilityEvent[]`
// — this module never observes crashes/timeouts/retries itself, mirroring the philosophy of
// runtimeAnalytics/analytics.ts and learningAnalytics/analytics.ts: a caller records each event as
// it happens (or replays them from a log) and hands the ordered list here.
import type { ReliabilityCounts, ReliabilityEvent, ReliabilityEventType, ReliabilityReport } from './types.js';

const EVENT_TYPES: ReliabilityEventType[] = [
  'crash',
  'timeout',
  'retry',
  'invalidJson',
  'emptyResponse',
  'verificationFailure',
  'executionFailure',
];

/** Severity weight per event type used by `reliabilityScore` — a crash costs far more than a
 *  retry. Deliberately fixed/deterministic rather than learned. */
export const RELIABILITY_EVENT_WEIGHTS: ReliabilityCounts = {
  crash: 10,
  executionFailure: 6,
  timeout: 5,
  verificationFailure: 4,
  invalidJson: 4,
  emptyResponse: 3,
  retry: 1,
};

/** A successfully-recovered failure still happened, but counts at this fraction of its normal
 *  weight toward `reliabilityScore` since the system caught and corrected it. */
export const RECOVERY_WEIGHT_DISCOUNT = 0.25;

function emptyCounts(): ReliabilityCounts {
  return {
    crash: 0,
    timeout: 0,
    retry: 0,
    invalidJson: 0,
    emptyResponse: 0,
    verificationFailure: 0,
    executionFailure: 0,
  };
}

/** Builds the full reliability report: per-type event counts, recovery success rate, and a
 *  weighted `reliabilityScore` (0-100) normalized against `totalRuns` — the number of execution
 *  attempts observed, which the caller must supply since a successful run produces no event of
 *  its own. */
export function computeReliabilityReport(events: ReliabilityEvent[], totalRuns: number): ReliabilityReport {
  const counts = emptyCounts();
  let recoveryAttempts = 0;
  let recoverySuccesses = 0;
  let weightedFailures = 0;

  for (const event of events) {
    counts[event.type] += 1;
    const weight = RELIABILITY_EVENT_WEIGHTS[event.type];
    if (event.recovered !== undefined) {
      recoveryAttempts += 1;
      if (event.recovered) recoverySuccesses += 1;
    }
    weightedFailures += event.recovered ? weight * RECOVERY_WEIGHT_DISCOUNT : weight;
  }

  const reliabilityScore =
    totalRuns > 0 ? Math.max(0, Math.min(100, 100 * (1 - weightedFailures / totalRuns))) : 0;

  return {
    totalRuns,
    totalEvents: events.length,
    counts,
    recoveryAttempts,
    recoverySuccesses,
    recoverySuccessRate: recoveryAttempts > 0 ? recoverySuccesses / recoveryAttempts : 0,
    reliabilityScore,
  };
}

export { EVENT_TYPES as RELIABILITY_EVENT_TYPES };
