// Backward-compatible facade over the cache abstraction (see cache/index.ts). Kept so existing
// call sites/tests that import sync-style helpers from here don't need to change; internally it
// just delegates to the current FeatureCacheProvider. Every provider method body here runs
// synchronously to completion (no internal await), so these helpers remain safe to call without
// awaiting them, exactly like the original in-memory-only implementation.
import { cacheKey, getFeatureCacheProvider } from './cache/index.js';
import type { CachedFeatureResult } from './cache/types.js';

export { cacheKey };
export type { CachedFeatureResult };

export async function getCachedFeatureSet(key: string): Promise<CachedFeatureResult | null> {
  return getFeatureCacheProvider().get(key);
}

export async function setCachedFeatureSet(key: string, value: CachedFeatureResult, ttlMs?: number): Promise<void> {
  return getFeatureCacheProvider().set(key, value, ttlMs);
}

/** Explicit invalidation — call after any event that changes the underlying data faster than the
 *  TTL would naturally expire it (e.g. a trade fill for this agent). */
export function invalidateFeatureSet(agentId: string, pair: string): void {
  void getFeatureCacheProvider().invalidate(cacheKey(agentId, pair));
}

export function clearFeatureCache(): void {
  void getFeatureCacheProvider().clear();
}

export async function featureCacheSize(): Promise<number> {
  return getFeatureCacheProvider().size();
}
