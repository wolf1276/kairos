// In-process observability for Reasoning Engine providers. No external monitoring framework —
// this is an in-memory counter/aggregate store, read via getProviderMetrics() the same way
// agentContext/monitor.ts exposes Context Layer health.
import type { ProviderName, ProviderObservability } from './types.js';

interface ProviderAggregate {
  calls: number;
  failures: number;
  timeouts: number;
  retries: number;
  fallbacks: number;
  totalLatencyMs: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalEstimatedCost: number;
  lastSelectedAt: number | null;
}

function emptyAggregate(): ProviderAggregate {
  return {
    calls: 0,
    failures: 0,
    timeouts: 0,
    retries: 0,
    fallbacks: 0,
    totalLatencyMs: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    totalEstimatedCost: 0,
    lastSelectedAt: null,
  };
}

const aggregates = new Map<ProviderName, ProviderAggregate>();

export function recordProviderCall(obs: ProviderObservability): void {
  const agg = aggregates.get(obs.provider) ?? emptyAggregate();
  agg.calls += 1;
  agg.retries += obs.retryCount;
  agg.fallbacks += obs.fallbackCount;
  agg.totalLatencyMs += obs.latencyMs;
  agg.totalPromptTokens += obs.usage.promptTokens;
  agg.totalCompletionTokens += obs.usage.completionTokens;
  agg.totalTokens += obs.usage.totalTokens;
  agg.totalEstimatedCost += obs.estimatedCost;
  agg.lastSelectedAt = Date.now();
  if (obs.timedOut) agg.timeouts += 1;
  if (obs.failed) agg.failures += 1;
  aggregates.set(obs.provider, agg);

  console.log(
    JSON.stringify({
      component: 'reasoning-engine-provider',
      event: 'provider_call',
      provider: obs.provider,
      model: obs.model,
      latencyMs: obs.latencyMs,
      tokens: obs.usage,
      estimatedCost: obs.estimatedCost,
      retryCount: obs.retryCount,
      fallbackCount: obs.fallbackCount,
      timedOut: obs.timedOut,
      failed: obs.failed,
      errorKind: obs.errorKind,
      requestId: obs.requestId,
    })
  );
}

export function getProviderMetrics(): Record<ProviderName, ProviderAggregate> {
  return Object.fromEntries(aggregates.entries()) as Record<ProviderName, ProviderAggregate>;
}

/** Test-only: resets in-memory aggregates between test cases. */
export function resetProviderMetrics(): void {
  aggregates.clear();
}
