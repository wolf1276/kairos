// Default FeatureCacheProvider — the exact in-memory TTL Map from the original Phase 1 cache,
// now behind the FeatureCacheProvider interface. Node's single-threaded event loop means every
// method body here runs to completion before any other cache call can interleave (none of them
// await anything internally), so this remains as safe under concurrent ticks as the original.
import type { CachedFeatureResult, FeatureCacheProvider } from './types.js';

interface CacheEntry {
  value: CachedFeatureResult;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 5_000;

// An entry that's never re-requested after expiry would otherwise sit in `store` forever — get()
// only reaps an entry it happens to be asked for. This periodic sweep is the backstop that
// bounds memory to "expired for at most one sweep interval," independent of read traffic.
const SWEEP_INTERVAL_MS = 30_000;

export class InMemoryFeatureCacheProvider implements FeatureCacheProvider {
  private store = new Map<string, CacheEntry>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.sweepTimer = setInterval(() => this.sweepExpired(), SWEEP_INTERVAL_MS);
    // Never keep the process alive just for cache housekeeping (matters for CLI/test runs).
    this.sweepTimer.unref?.();
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now >= entry.expiresAt) this.store.delete(key);
    }
  }

  async get(key: string): Promise<CachedFeatureResult | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: CachedFeatureResult, ttlMs = DEFAULT_TTL_MS): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  async invalidate(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  async size(): Promise<number> {
    return this.store.size;
  }

  /** Stops the background sweep timer — call when discarding a provider instance (e.g. on
   *  provider swap/reset) so it doesn't keep sweeping a store nothing references anymore. */
  dispose(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }
}
