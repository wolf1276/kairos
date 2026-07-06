// Provider registry — the single place that knows the concrete cache implementation. Everything
// else in agentContext imports FeatureCacheProvider (the interface) and calls getFeatureCacheProvider();
// swapping in a Redis-backed provider later is a one-line setFeatureCacheProvider() call, with no
// change to featureEngine.ts or contextBuilder.ts.
import { InMemoryFeatureCacheProvider } from './inMemoryFeatureCacheProvider.js';
import type { FeatureCacheProvider } from './types.js';

let provider: FeatureCacheProvider = new InMemoryFeatureCacheProvider();

export function getFeatureCacheProvider(): FeatureCacheProvider {
  return provider;
}

const REQUIRED_PROVIDER_METHODS = ['get', 'set', 'invalidate', 'clear', 'size'] as const;

/** A provider missing a required method would fail deep inside a context build (or a scheduler
 *  tick), not at the call site that actually made the mistake — validate the shape up front so a
 *  bad swap fails loudly and immediately instead of degrading every subsequent build. */
function assertValidProvider(candidate: FeatureCacheProvider): void {
  for (const method of REQUIRED_PROVIDER_METHODS) {
    if (typeof candidate?.[method] !== 'function') {
      throw new Error(`Invalid FeatureCacheProvider: missing required method '${method}'`);
    }
  }
}

/** Swaps the backing cache implementation (e.g. for a future Redis provider, or to inject a
 *  test double). Existing cached entries in the previous provider are not migrated. Disposes the
 *  outgoing provider so any background resources (e.g. InMemoryFeatureCacheProvider's sweep
 *  timer) don't keep running for a store nothing references anymore. */
export function setFeatureCacheProvider(next: FeatureCacheProvider): void {
  assertValidProvider(next);
  provider.dispose?.();
  provider = next;
}

/** Resets to the default in-memory provider — mainly for test isolation. */
export function resetFeatureCacheProvider(): void {
  provider.dispose?.();
  provider = new InMemoryFeatureCacheProvider();
}

/** Delimiter-safe cache key — `agentId` and `pair` are joined via JSON.stringify(...) of an
 *  array rather than raw string concatenation, so a `:` (or any other character) inside either
 *  component can never make two distinct (agentId, pair) pairs collide onto the same cache key.
 *  A collision here would mean one agent's request could be served another agent's (or another
 *  pair's) cached market/capital snapshot — a context-leakage bug, not just a correctness one. */
export function cacheKey(agentId: string, pair: string): string {
  return JSON.stringify([agentId, pair]);
}

/** Feature-cache TTL scaled to the agent's tick interval — a role ticking every 30s shouldn't
 *  reuse a feature snapshot for 5 minutes, and a role ticking every hour shouldn't recompute
 *  every 5s. Clamped to [MIN_FEATURE_CACHE_TTL_MS, MAX_FEATURE_CACHE_TTL_MS] so an unusually
 *  short/long configured interval can't make the cache pointless or stale for an entire cycle. */
const MIN_FEATURE_CACHE_TTL_MS = 2_000;
const MAX_FEATURE_CACHE_TTL_MS = 60_000;
const FEATURE_CACHE_TTL_FRACTION_OF_INTERVAL = 0.5;

export function featureCacheTtlForInterval(intervalSeconds: number): number {
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) return MIN_FEATURE_CACHE_TTL_MS;
  const scaled = intervalSeconds * 1000 * FEATURE_CACHE_TTL_FRACTION_OF_INTERVAL;
  return Math.min(MAX_FEATURE_CACHE_TTL_MS, Math.max(MIN_FEATURE_CACHE_TTL_MS, scaled));
}

export { InMemoryFeatureCacheProvider };
export type { FeatureCacheProvider, CachedFeatureResult } from './types.js';
