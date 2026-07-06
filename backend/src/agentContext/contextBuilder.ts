// Context Builder — the single assembly point for AgentContext, the Context Layer's one
// immutable snapshot of "what is true right now" for a given agent. Gathers all five domains
// (Market, Managed Capital, Policy, System, Historical), validates the result, and freezes it.
// Never reasons, predicts, decides, or executes — see docs/architecture/CONTEXT_LAYER.md.
import { randomUUID, createHash } from 'crypto';
import { getAgentRow } from '../agentService.js';
import { buildFeatureResult } from './featureEngine.js';
import { getFeatureCacheProvider, cacheKey } from './cache/index.js';
import { buildMarketContextView } from './domains/marketContext.js';
import { buildManagedCapitalContextView } from './domains/capitalContext.js';
import { buildPolicyContextView } from './domains/policyContext.js';
import { buildSystemContextView } from './domains/systemContext.js';
import { buildHistoricalContextView } from './domains/historicalContext.js';
import { validateAgentContext } from './validation.js';
import { AGENT_CONTEXT_SCHEMA_VERSION } from './types.js';
import type { AgentContext, ContextQuality } from './types.js';
import { recordContextBuild, recordValidation, recordQuality, recordDomainConfidence } from './metrics.js';

const QUALITY_HIGH_THRESHOLD = 0.75;
const QUALITY_MEDIUM_THRESHOLD = 0.4;

/** Clamps a domain confidence into [0, 1] — any non-finite or out-of-range value (a bug in a
 *  domain builder, corrupt upstream data) must never propagate into the aggregate quality score. */
function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function computeContextQuality(domainConfidence: ContextQuality['domainConfidence']): ContextQuality {
  const safeDomainConfidence = Object.fromEntries(
    Object.entries(domainConfidence).map(([k, v]) => [k, clampConfidence(v)])
  ) as ContextQuality['domainConfidence'];
  const values = Object.values(safeDomainConfidence);
  const score = values.reduce((s, v) => s + v, 0) / values.length;
  const level: ContextQuality['level'] = score >= QUALITY_HIGH_THRESHOLD ? 'high' : score >= QUALITY_MEDIUM_THRESHOLD ? 'medium' : 'low';
  return { score, level, domainConfidence: safeDomainConfidence };
}

export class ContextBuilderError extends Error {}

export interface BuildContextOptions {
  pair?: string;
  intervalSeconds?: number;
  /** Skip the feature cache and force a fresh computation for this build. */
  forceRefresh?: boolean;
}

export { AGENT_CONTEXT_SCHEMA_VERSION };

const DEFAULT_PAIR = 'XLM/USDC';
const DEFAULT_INTERVAL_SECONDS = 300;

/** JSON.stringify with all object keys sorted recursively — makes the serialization depend only
 *  on content, never on property insertion order, so two structurally-identical objects always
 *  produce the same string (arrays keep their order, since order is meaningful there). */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Deterministic hash over everything in the context except fields that are inherently
 *  wall-clock-relative (snapshotId is random, timestamp is "now", and a handful of *Seconds
 *  fields recompute their age relative to "now" even when the underlying data hasn't changed) —
 *  two builds against the same underlying data (agent row + market snapshot) hash identically
 *  regardless of when each build ran or how the source objects were constructed (property
 *  insertion order never affects the result). Built as an explicit canonical object rather than
 *  deep-cloning and deleting fields, so there is exactly one place that enumerates which fields
 *  are "deterministic data" vs. "wall clock" — nothing can be accidentally re-introduced by a
 *  clone.
 */
function computeContextHash(input: Omit<AgentContext, 'meta'> & { meta: Omit<AgentContext['meta'], 'snapshotId' | 'contextHash' | 'timestamp'> }): string {
  const { computedAt: _computedAt, ...featuresWithoutComputedAt } = input.features;
  const { ageSeconds: _oracleAge, ...oracleWithoutAge } = input.market.oracle;
  const { remainingSeconds: _remaining, ...cooldownWithoutRemaining } = input.historical.cooldown;
  const canonical = {
    agentId: input.agentId,
    owner: input.owner,
    role: input.role,
    pair: input.pair,
    regime: input.regime,
    features: featuresWithoutComputedAt,
    meta: input.meta,
    market: { ...input.market, oracle: oracleWithoutAge },
    capital: {
      ...input.capital,
      pendingExecutions: input.capital.pendingExecutions.map(({ ageSeconds: _age, ...rest }) => rest),
    },
    policy: input.policy,
    system: input.system,
    historical: { ...input.historical, cooldown: cooldownWithoutRemaining },
    validation: input.validation,
    status: input.status,
    quality: input.quality,
  };
  return createHash('sha256').update(stableStringify(canonical)).digest('hex');
}

/**
 * Builds the immutable AgentContext for one agent. Reuses agentService.getAgentRow (single DB
 * read) and buildFeatureResult (which itself reuses every other existing service, and computes
 * indicators/regime exactly once per cache miss) for the Market/Capital data, then layers the
 * Policy/System/Historical domains on top of the same agent row + feature result — no duplicate
 * DB query or indicator computation happens here. Depends only on the FeatureCacheProvider
 * abstraction (cache/index.js), never on a concrete cache implementation.
 *
 * Always returns a fully-formed, frozen AgentContext — even when validation fails, so the
 * frontend debug viewer and callers can see *why* — but `status`/`validation.ok` must be checked
 * before handing the context to any future reasoning layer. Returns null only when the agent
 * doesn't exist or the oracle doesn't yet have enough candle history to build anything at all.
 */
export async function buildAgentContext(agentId: string, options: BuildContextOptions = {}): Promise<AgentContext | null> {
  const buildStart = performance.now();
  try {
    const context = await buildAgentContextInner(agentId, options);
    recordContextBuild(performance.now() - buildStart, context ? 'success' : 'null');
    return context;
  } catch (error) {
    recordContextBuild(performance.now() - buildStart, 'failure');
    throw error;
  }
}

async function buildAgentContextInner(agentId: string, options: BuildContextOptions): Promise<AgentContext | null> {
  const pair = options.pair ?? DEFAULT_PAIR;
  const intervalSeconds = options.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS;

  const row = getAgentRow(agentId);
  if (!row) return null;

  if (options.forceRefresh) await getFeatureCacheProvider().invalidate(cacheKey(agentId, pair));

  const result = await buildFeatureResult(row, pair, intervalSeconds, { useCache: !options.forceRefresh });
  if (!result) return null;

  const now = Date.now();
  const market = buildMarketContextView(result, intervalSeconds, now);
  const capital = buildManagedCapitalContextView(row, result, now);
  const policy = buildPolicyContextView(row, result);
  const system = buildSystemContextView(row, result, intervalSeconds, now);
  const historical = buildHistoricalContextView(row, now);
  const validation = validateAgentContext({ market, capital, policy, system, schemaVersion: AGENT_CONTEXT_SCHEMA_VERSION });
  // Derive status from validation.errors directly (not validation.ok) so there is exactly one
  // source of truth for "is this context invalid" — a context can never end up marked 'valid'
  // while carrying validation errors, or 'invalid' with none.
  const status = validation.errors.length === 0 ? ('valid' as const) : ('invalid' as const);
  const quality = computeContextQuality({
    market: market.confidence,
    capital: capital.confidence,
    policy: policy.confidence,
    system: system.confidence,
    historical: historical.confidence,
  });

  recordValidation(validation.ok, validation.errors);
  recordQuality(quality.score, quality.level);
  for (const [domain, value] of Object.entries(quality.domainConfidence) as [keyof typeof quality.domainConfidence, number][]) {
    recordDomainConfidence(domain, value);
  }

  const contentForHash = {
    agentId: row.id,
    owner: row.owner,
    role: row.role,
    pair,
    regime: result.regime,
    features: result.featureSet,
    builtAt: now,
    meta: { version: AGENT_CONTEXT_SCHEMA_VERSION, marketId: result.marketId },
    market,
    capital,
    policy,
    system,
    historical,
    validation,
    status,
    quality,
  };
  const contextHash = computeContextHash(contentForHash);

  const context: AgentContext = {
    ...contentForHash,
    meta: {
      version: AGENT_CONTEXT_SCHEMA_VERSION,
      timestamp: now,
      marketId: result.marketId,
      snapshotId: randomUUID(),
      contextHash,
    },
  };

  return Object.freeze(context);
}

/** Forces a full rebuild, bypassing the feature cache — use when an event (trade fill, policy
 *  change) makes the cached FeatureSet stale before its TTL would naturally expire it. */
export function refreshAgentContext(agentId: string, options: Omit<BuildContextOptions, 'forceRefresh'> = {}): Promise<AgentContext | null> {
  return buildAgentContext(agentId, { ...options, forceRefresh: true });
}
