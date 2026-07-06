// Regression tracking: diffs the current benchmark run's per-model aggregates against the
// previous saved report, flagging latency/validation/token/reasoning/confidence regressions.
import type { ModelAggregate } from './aggregate.js';

export interface RegressionFinding {
  modelId: string;
  kind: 'latency' | 'validation' | 'token' | 'reasoning' | 'confidence';
  message: string;
  previous: number;
  current: number;
  deltaPct: number;
}

const THRESHOLDS = {
  /** Latency/token regressions trigger at +20% or worse. */
  latencyIncreasePct: 0.2,
  tokenIncreasePct: 0.2,
  /** Validation pass rate regression triggers at a 10 percentage-point drop or worse. */
  validationDropPct: 0.1,
  /** Reasoning regression (evidence count / chain length dropping) triggers at -20%. */
  reasoningDropPct: 0.2,
  /** Confidence regression triggers at a 0.1 absolute drop in average confidence. */
  confidenceDropAbs: 0.1,
};

function pctChange(previous: number, current: number): number {
  if (previous === 0) return current === 0 ? 0 : Infinity;
  return (current - previous) / previous;
}

export function compareReports(current: ModelAggregate[], previous: ModelAggregate[]): RegressionFinding[] {
  const findings: RegressionFinding[] = [];
  const previousById = new Map(previous.map((a) => [a.modelId, a]));

  for (const curr of current) {
    const prev = previousById.get(curr.modelId);
    if (!prev) continue; // new model this run — nothing to regress against

    const latencyDelta = pctChange(prev.avgLatencyMs, curr.avgLatencyMs);
    if (latencyDelta >= THRESHOLDS.latencyIncreasePct) {
      findings.push({
        modelId: curr.modelId, kind: 'latency',
        message: `avg latency increased ${(latencyDelta * 100).toFixed(0)}% (${prev.avgLatencyMs.toFixed(0)}ms -> ${curr.avgLatencyMs.toFixed(0)}ms)`,
        previous: prev.avgLatencyMs, current: curr.avgLatencyMs, deltaPct: latencyDelta,
      });
    }

    const prevPassRate = prev.runs > 0 ? prev.successCount / prev.runs : 0;
    const currPassRate = curr.runs > 0 ? curr.successCount / curr.runs : 0;
    if (prevPassRate - currPassRate >= THRESHOLDS.validationDropPct) {
      findings.push({
        modelId: curr.modelId, kind: 'validation',
        message: `validation pass rate dropped ${((prevPassRate - currPassRate) * 100).toFixed(0)} points (${(prevPassRate * 100).toFixed(0)}% -> ${(currPassRate * 100).toFixed(0)}%)`,
        previous: prevPassRate, current: currPassRate, deltaPct: currPassRate - prevPassRate,
      });
    }

    const tokenDelta = pctChange(prev.avgTotalTokens, curr.avgTotalTokens);
    if (tokenDelta >= THRESHOLDS.tokenIncreasePct) {
      findings.push({
        modelId: curr.modelId, kind: 'token',
        message: `avg total tokens increased ${(tokenDelta * 100).toFixed(0)}% (${prev.avgTotalTokens.toFixed(0)} -> ${curr.avgTotalTokens.toFixed(0)})`,
        previous: prev.avgTotalTokens, current: curr.avgTotalTokens, deltaPct: tokenDelta,
      });
    }

    if (prev.avgEvidenceCount !== null && curr.avgEvidenceCount !== null) {
      const evidenceDelta = pctChange(prev.avgEvidenceCount, curr.avgEvidenceCount);
      if (evidenceDelta <= -THRESHOLDS.reasoningDropPct) {
        findings.push({
          modelId: curr.modelId, kind: 'reasoning',
          message: `avg evidence count dropped ${(Math.abs(evidenceDelta) * 100).toFixed(0)}% (${prev.avgEvidenceCount.toFixed(1)} -> ${curr.avgEvidenceCount.toFixed(1)})`,
          previous: prev.avgEvidenceCount, current: curr.avgEvidenceCount, deltaPct: evidenceDelta,
        });
      }
    }
    if (prev.avgReasoningChainLength !== null && curr.avgReasoningChainLength !== null) {
      const chainDelta = pctChange(prev.avgReasoningChainLength, curr.avgReasoningChainLength);
      if (chainDelta <= -THRESHOLDS.reasoningDropPct) {
        findings.push({
          modelId: curr.modelId, kind: 'reasoning',
          message: `avg reasoning chain length dropped ${(Math.abs(chainDelta) * 100).toFixed(0)}% (${prev.avgReasoningChainLength.toFixed(1)} -> ${curr.avgReasoningChainLength.toFixed(1)})`,
          previous: prev.avgReasoningChainLength, current: curr.avgReasoningChainLength, deltaPct: chainDelta,
        });
      }
    }

    if (prev.avgConfidence !== null && curr.avgConfidence !== null) {
      const confidenceDelta = curr.avgConfidence - prev.avgConfidence;
      if (confidenceDelta <= -THRESHOLDS.confidenceDropAbs) {
        findings.push({
          modelId: curr.modelId, kind: 'confidence',
          message: `avg confidence dropped ${Math.abs(confidenceDelta).toFixed(2)} (${prev.avgConfidence.toFixed(2)} -> ${curr.avgConfidence.toFixed(2)})`,
          previous: prev.avgConfidence, current: curr.avgConfidence, deltaPct: confidenceDelta,
        });
      }
    }
  }

  return findings;
}
