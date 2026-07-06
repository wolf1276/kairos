// Alternative-quality checks: are a decision's 2-3 alternatives unique, policy-compliant, and
// meaningfully different from each other and from the primary decision?
import type { BenchmarkRunResult } from '../runners/executeScenario.js';

export interface AlternativeQualityReport {
  modelId: string;
  decisionsChecked: number;
  duplicateAlternativePairs: number;
  primaryDuplicatedInAlternatives: number;
  emptyTradeoffsCount: number;
  avgUniqueActionsPerDecision: number;
}

function alternativeKey(alt: { action: string; asset: string; allocation: number }): string {
  return `${alt.action}:${alt.asset}:${alt.allocation.toFixed(2)}`;
}

export function checkAlternativeQuality(modelId: string, results: BenchmarkRunResult[]): AlternativeQualityReport {
  const decisions = results.filter((r) => r.success && r.decision);
  let duplicatePairs = 0;
  let primaryDuplicated = 0;
  let emptyTradeoffs = 0;
  let totalUniqueActions = 0;

  for (const r of decisions) {
    const d = r.decision!;
    const keys = d.alternatives.map(alternativeKey);
    const seen = new Set<string>();
    for (const k of keys) {
      if (seen.has(k)) duplicatePairs += 1;
      seen.add(k);
    }

    const primaryKey = `${d.action}:${d.asset}:${d.allocation.toFixed(2)}`;
    if (keys.includes(primaryKey)) primaryDuplicated += 1;

    emptyTradeoffs += d.alternatives.filter((a) => !a.tradeoffs || a.tradeoffs.trim().length === 0).length;

    totalUniqueActions += new Set([d.action, ...d.alternatives.map((a) => a.action)]).size;
  }

  return {
    modelId,
    decisionsChecked: decisions.length,
    duplicateAlternativePairs: duplicatePairs,
    primaryDuplicatedInAlternatives: primaryDuplicated,
    emptyTradeoffsCount: emptyTradeoffs,
    avgUniqueActionsPerDecision: decisions.length > 0 ? totalUniqueActions / decisions.length : 0,
  };
}

export function checkAllAlternativeQuality(byModel: Map<string, BenchmarkRunResult[]>): AlternativeQualityReport[] {
  return [...byModel.entries()].map(([modelId, results]) => checkAlternativeQuality(modelId, results));
}
