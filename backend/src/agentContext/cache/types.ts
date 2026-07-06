// Cache abstraction for the Agent Foundation Layer. Callers (featureEngine, contextBuilder)
// depend only on this interface — never on a concrete storage mechanism — so the backing store
// can move from in-memory to Redis/a distributed cache later with zero call-site changes.
import type { FeatureSet } from '../types.js';
import type { RegimeClassification } from '../regimeDetector.js';

export interface CachedFeatureResult {
  featureSet: FeatureSet;
  regime: RegimeClassification;
  /** Deterministic identifier for the underlying market data snapshot (pair + candle time) this
   *  result was derived from — lets a cache hit and a fresh build produce the same marketId for
   *  the same underlying data, which AgentContext.meta.marketId depends on for reproducibility. */
  marketId: string;
  /** Epoch ms of the last candle the oracle returned — used to compute oracle freshness in the
   *  Market Context domain without re-deriving it from marketId. */
  oracleTimestamp: number;
}

export interface FeatureCacheProvider {
  get(key: string): Promise<CachedFeatureResult | null>;
  set(key: string, value: CachedFeatureResult, ttlMs?: number): Promise<void>;
  invalidate(key: string): Promise<void>;
  clear(): Promise<void>;
  size(): Promise<number>;
  /** Releases any background resources (e.g. a sweep timer) held by this provider instance.
   *  Optional — only implementations that hold such resources need it. */
  dispose?(): void;
}
