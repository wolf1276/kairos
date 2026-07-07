// In-process observability for Decision Verification. Parallel to (not a modification of)
// providers/metrics.ts and decisionIntelligence/metrics.ts.
import type { VerificationResult } from './types.js';

interface VerificationAggregate {
  total: number;
  approved: number;
  rejected: number;
  totalLatencyMs: number;
  ruleFailureCounts: Record<string, number>;
}

function emptyAggregate(): VerificationAggregate {
  return { total: 0, approved: 0, rejected: 0, totalLatencyMs: 0, ruleFailureCounts: {} };
}

let aggregate: VerificationAggregate = emptyAggregate();

export function recordVerification(result: VerificationResult, latencyMs: number): void {
  aggregate.total += 1;
  if (result.status === 'verified') aggregate.approved += 1;
  else aggregate.rejected += 1;
  aggregate.totalLatencyMs += latencyMs;
  for (const rule of result.failedRules) {
    aggregate.ruleFailureCounts[rule] = (aggregate.ruleFailureCounts[rule] ?? 0) + 1;
  }

  console.log(
    JSON.stringify({
      component: 'reasoning-engine-verification',
      event: 'verification_result',
      status: result.status,
      latencyMs,
      passedRuleCount: result.passedRules.length,
      failedRuleCount: result.failedRules.length,
      warningCount: result.warnings.length,
      verificationHash: result.verificationHash,
    })
  );
}

export function getVerificationMetrics(): VerificationAggregate & { approvalRate: number; rejectionRate: number; avgLatencyMs: number } {
  const { total, approved, rejected, totalLatencyMs, ruleFailureCounts } = aggregate;
  return {
    total, approved, rejected, totalLatencyMs, ruleFailureCounts,
    approvalRate: total > 0 ? approved / total : 0,
    rejectionRate: total > 0 ? rejected / total : 0,
    avgLatencyMs: total > 0 ? totalLatencyMs / total : 0,
  };
}

/** Test-only: resets in-memory aggregate between test cases. */
export function resetVerificationMetrics(): void {
  aggregate = emptyAggregate();
}
