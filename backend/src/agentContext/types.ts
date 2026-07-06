// Types for the Agent Foundation Layer (Phase 1). This is the ONLY shape future agents may
// depend on — no agent may query backend services (db.ts, decisionEngine.ts, etc.) directly.
import type { ProtocolId, ProtocolPositionKind } from '../db.js';
import type { AgentRole, AgentMode } from '../db.js';
import type { ExtendedRegimeLabel } from './regimeDetector.js';
import type { MarketContextView } from './domains/marketContext.js';
import type { ManagedCapitalContextView } from './domains/capitalContext.js';
import type { PolicyContextView } from './domains/policyContext.js';
import type { SystemContextView } from './domains/systemContext.js';
import type { HistoricalContextView } from './domains/historicalContext.js';
import type { ContextValidationResult } from './validation.js';

/** AgentContext schema version — bump when the shape of AgentContext/FeatureSet/any domain view
 *  changes in a way that would break a persisted or replayed context. Lives here (rather than
 *  contextBuilder.ts) so validation.ts can check it without creating a validation <-> builder
 *  import cycle. */
export const AGENT_CONTEXT_SCHEMA_VERSION = '2.1.0';

export interface TrendFeatures {
  ema20: number;
  ema50: number;
  sma20: number;
  trendStrength: number; // ADX
  direction: 'up' | 'down' | 'flat';
}

export interface MomentumFeatures {
  rsi: number;
  macdHistogram: number;
  roc: number;
}

export interface VolatilityFeatures {
  atr: number;
  volatilityPct: number;
  band: 'low' | 'normal' | 'high';
}

export interface VolumeFeatures {
  window24h: number;
  changePct: number;
}

export interface LiquidityFeatures {
  recentVolume: number;
}

export interface WalletFeatures {
  publicKey: string;
  smartWalletAddress: string | null;
  delegationActive: boolean;
  mode: AgentMode;
  capital: string | null;
}

export interface PortfolioFeatures {
  xlmPct: number;
  usdcPct: number;
  idleUsd: number;
  totalValue: number;
  targetXlmPct: number;
  targetUsdcPct: number;
  driftPct: number;
}

export interface ProtocolExposureEntry {
  protocolId: ProtocolId;
  kind: ProtocolPositionKind;
  asset: string;
  amount: string;
}

export interface RiskFeatures {
  realizedPnl: number;
  unrealizedPnl: number;
  drawdownPct: number | null;
  volatilityPct: number;
}

export interface FeatureSet {
  pair: string;
  price: number;
  trend: TrendFeatures;
  momentum: MomentumFeatures;
  volatility: VolatilityFeatures;
  volume: VolumeFeatures;
  liquidity: LiquidityFeatures;
  wallet: WalletFeatures;
  portfolio: PortfolioFeatures;
  protocolExposure: ProtocolExposureEntry[];
  risk: RiskFeatures;
  computedAt: number;
}

/** Immutable metadata stamped on every AgentContext build — the basis for replay, backtesting,
 *  schema evolution, and debugging. Generated automatically; callers never set these fields. */
export interface ContextMeta {
  /** AgentContext schema version (semver) — bump on any breaking shape change so a persisted or
   *  replayed context can be checked for compatibility before being fed to an agent. */
  version: string;
  /** Wall-clock time this context was assembled (epoch ms). */
  timestamp: number;
  /** Deterministic identifier for the underlying market data snapshot (pair + candle time) this
   *  context's features were derived from — two contexts built from the same market snapshot
   *  (e.g. a cache hit vs. the original build) share the same marketId, which is what makes
   *  replay/backtesting comparisons meaningful. */
  marketId: string;
  /** Unique identifier for this specific build (not the underlying market snapshot) — every
   *  buildAgentContext() call gets a fresh one, even on a feature-cache hit, so two builds of the
   *  same market snapshot for the same agent remain individually addressable for audit/replay. */
  snapshotId: string;
  /** SHA-256 hash of the deterministic content of this context (everything except snapshotId/
   *  timestamp/hash itself) — lets two contexts be compared for exact equality without a deep
   *  diff, and lets a replayed context be checked against its original hash. */
  contextHash: string;
}

/** Overall data-quality read on the whole context — the average of the five domains' own
 *  `confidence` scores, plus a coarse level for quick display. This is a data-quality signal,
 *  not a decision or a prediction: it says nothing about what action (if any) is correct, only
 *  how much the assembled data itself should be trusted right now. */
export interface ContextQuality {
  /** 0-1 — mean of market/capital/policy/system/historical confidence. */
  score: number;
  level: 'high' | 'medium' | 'low';
  domainConfidence: {
    market: number;
    capital: number;
    policy: number;
    system: number;
    historical: number;
  };
}

export interface AgentContext {
  agentId: string;
  owner: string;
  role: AgentRole | null;
  pair: string;
  regime: {
    base: string;
    label: ExtendedRegimeLabel;
    breakout: boolean;
    volatilityBand: 'low' | 'normal' | 'high';
  };
  features: FeatureSet;
  /** @deprecated use meta.timestamp — kept for backward compatibility with Phase 1 call sites. */
  builtAt: number;
  meta: ContextMeta;

  // ── Context Layer domains ──────────────────────────────────────────────────────────────────
  market: MarketContextView;
  capital: ManagedCapitalContextView;
  policy: PolicyContextView;
  system: SystemContextView;
  historical: HistoricalContextView;
  validation: ContextValidationResult;
  /** 'valid' mirrors validation.ok — surfaced at the top level so consumers (and the frontend
   *  debug viewer) don't have to reach into validation to answer "can I trust this?". */
  status: 'valid' | 'invalid';
  quality: ContextQuality;
}
