// Types for Reliability Analytics (Phase 7). Same "pure aggregation over caller-supplied history,
// never fabricate a metric it doesn't have data for" philosophy as runtimeAnalytics/analytics.ts,
// learningAnalytics/analytics.ts, strategyEngine/analytics.ts, memoryLayer/analytics.ts. This
// module never observes failures itself — a caller (pipeline runner, execution layer, scheduled
// job) records each failure/retry/recovery as it happens and hands the ordered list here.

export const RELIABILITY_ANALYTICS_VERSION = '1.0.0';

export type ReliabilityEventType =
  | 'crash'
  | 'timeout'
  | 'retry'
  | 'invalidJson'
  | 'emptyResponse'
  | 'verificationFailure'
  | 'executionFailure';

export interface ReliabilityEvent {
  type: ReliabilityEventType;
  timestamp: number;
  /** Whether a recovery was attempted for this event, and whether it succeeded. Omitted when no
   *  recovery was attempted (e.g. a bare retry that wasn't itself recovering from a failure). */
  recovered?: boolean;
}

export type ReliabilityCounts = Record<ReliabilityEventType, number>;

export interface ReliabilityReport {
  /** Total execution attempts observed (successful + failed), supplied by the caller — the
   *  denominator against which failures are scored. Not derivable from `events` alone since a
   *  successful run produces no event. */
  totalRuns: number;
  totalEvents: number;
  counts: ReliabilityCounts;
  /** Count of events where a recovery was attempted (`recovered` is defined). */
  recoveryAttempts: number;
  /** Count of events where the recovery attempt succeeded (`recovered === true`). */
  recoverySuccesses: number;
  /** `recoverySuccesses / recoveryAttempts`, or 0 when no recovery was ever attempted. */
  recoverySuccessRate: number;
  /** 0-100. 100 = no weighted failures relative to `totalRuns`; 0 = failures at or above every
   *  observed run. A successfully-recovered failure counts at a fraction of its normal weight. */
  reliabilityScore: number;
}
