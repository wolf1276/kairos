import { describe, expect, it } from 'vitest';
import { computeReliabilityReport, RELIABILITY_EVENT_WEIGHTS } from '../reliabilityAnalytics/analytics.js';
import type { ReliabilityEvent } from '../reliabilityAnalytics/types.js';

describe('computeReliabilityReport', () => {
  it('returns a perfect score with zero events and zero runs', () => {
    const report = computeReliabilityReport([], 0);
    expect(report.totalEvents).toBe(0);
    expect(report.reliabilityScore).toBe(0);
    expect(report.recoverySuccessRate).toBe(0);
  });

  it('returns a perfect score when runs succeed with no events', () => {
    const report = computeReliabilityReport([], 100);
    expect(report.reliabilityScore).toBe(100);
  });

  it('counts each event type independently', () => {
    const events: ReliabilityEvent[] = [
      { type: 'crash', timestamp: 1 },
      { type: 'timeout', timestamp: 2 },
      { type: 'retry', timestamp: 3 },
      { type: 'invalidJson', timestamp: 4 },
      { type: 'emptyResponse', timestamp: 5 },
      { type: 'verificationFailure', timestamp: 6 },
      { type: 'executionFailure', timestamp: 7 },
    ];
    const report = computeReliabilityReport(events, 100);
    expect(report.totalEvents).toBe(7);
    expect(report.counts).toEqual({
      crash: 1,
      timeout: 1,
      retry: 1,
      invalidJson: 1,
      emptyResponse: 1,
      verificationFailure: 1,
      executionFailure: 1,
    });
  });

  it('discounts recovered failures toward the score and tracks recovery rate', () => {
    const recovered = computeReliabilityReport([{ type: 'crash', timestamp: 1, recovered: true }], 100);
    const unrecovered = computeReliabilityReport([{ type: 'crash', timestamp: 1, recovered: false }], 100);
    expect(recovered.reliabilityScore).toBeGreaterThan(unrecovered.reliabilityScore);
    expect(recovered.recoveryAttempts).toBe(1);
    expect(recovered.recoverySuccesses).toBe(1);
    expect(recovered.recoverySuccessRate).toBe(1);
    expect(unrecovered.recoverySuccessRate).toBe(0);
  });

  it('does not count a bare retry with no recovered flag as a recovery attempt', () => {
    const report = computeReliabilityReport([{ type: 'retry', timestamp: 1 }], 10);
    expect(report.recoveryAttempts).toBe(0);
    expect(report.recoverySuccessRate).toBe(0);
  });

  it('clamps reliabilityScore to 0 when weighted failures exceed totalRuns', () => {
    const events: ReliabilityEvent[] = Array.from({ length: 5 }, (_, i) => ({
      type: 'crash' as const,
      timestamp: i,
    }));
    const report = computeReliabilityReport(events, 2);
    expect(report.reliabilityScore).toBe(0);
  });

  it('weighs a crash more heavily than a retry', () => {
    expect(RELIABILITY_EVENT_WEIGHTS.crash).toBeGreaterThan(RELIABILITY_EVENT_WEIGHTS.retry);
    const crashReport = computeReliabilityReport([{ type: 'crash', timestamp: 1 }], 100);
    const retryReport = computeReliabilityReport([{ type: 'retry', timestamp: 1 }], 100);
    expect(crashReport.reliabilityScore).toBeLessThan(retryReport.reliabilityScore);
  });
});
