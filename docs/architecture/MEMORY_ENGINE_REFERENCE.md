# Memory Engine — Technical Reference (Frozen)

"This document is the complete technical reference for the **Memory Engine**, the second layer of the Kairos AI Operating System. It is FROZEN: the architecture, public APIs, hashes, validation rules, retrieval logic, statistics, patterns, conflicts, evidence generation, providers, metadata, and package schemas will not change except to fix a Critical production bug. Every future AI subsystem (including the Reasoning Engine) MUST consume the `MemoryPackage` (and, where applicable, the `MemoryIntelligencePackage`) rather than querying Memory internals. All improvements must be additive and backward-compatible."

## 1. Overall Architecture

The Memory Engine turns an agent's historical and current state into immutable, deterministic, evidence-based memory packages. It is split into three frozen phases plus production hardening:

- Phase 1 — Foundation: assembles the immutable `MemoryPackage` from three provider-backed memory kinds.
- Phase 2 — Retrieval & Relevance: narrows Phase 1 to the Top-K most relevant records for a given `AgentContext`, producing `MemoryRetrievalPackage`.
- Phase 3 — Experience Intelligence: derives deterministic statistics, patterns, conflicts, and structured evidence from Phase 2's ranked episodes, producing `MemoryIntelligencePackage`.

Constraints: No LLM calls, no embeddings, no vector DB, no reasoning, no prediction, no trade execution, no online learning, no prompt generation. Every output is a deterministic aggregate or a fixed-threshold rule over historical data.

```
                 AgentContext
                      │
   ┌──────────────────┼──────────────────────────────────┐
   ▼                  ▼                                    ▼
Phase 1           Phase 2                            Phase 3
Foundation        Retrieval & Relevance             Experience Intelligence
   │                  │                                    │
   │  assembleMemory  │  retrieveMemoryPackage(ctx)        │  buildMemoryIntelligencePackage(ctx)
   │  Package(agentId)│                                    │
   ▼                  ▼                                    ▼
MemoryPackage   MemoryRetrievalPackage          MemoryIntelligencePackage
   │                  │                                    │
   └──────────────────┴───────────┬────────────────────────┘
                                   ▼
                       Future Reasoning Engine (external, not in this module)
```

## 2. Internal Layers

Dependency direction is one-way, downward:

- `orchestrator.ts` (Phase 1) depends only on provider interfaces + `validation.ts` + `stableStringify` + `metrics.ts`.
- `retrieval/*` (Phase 2) depends on Phase 1 providers + `agentContext` query inputs; it does NOT depend on `orchestrator.ts`.
- `intelligence/*` (Phase 3) depends on Phase 2's `retrieveMemoryPackage` and on `retrieval/scoring.ts` (shared `QUALITY_SCORE`) and `retrieval/types.ts`.
- `intelligence` never imports `orchestrator.ts`. The two package types are siblings, not parent/child.

No circular dependencies. Layer isolation is enforced by importing only declared public surfaces (`memoryLayer/index.ts` re-exports everything).

## 3. Provider Architecture

Three provider interfaces in `providers/types.ts`:

- `EpisodicMemoryProvider` (append-only): `append`, `list`, `get`, `size`.
- `SemanticMemoryProvider` (upsert-by-key): `upsert`, `list`, `get`, `clear`, `size`.
- `WorkingMemoryProvider` (mutable TTL scratch): `get`, `set`, `invalidate`, `clear`, `list`, `size`.

Default implementations: `InMemoryEpisodicProvider`, `InMemorySemanticProvider`, `InMemoryWorkingProvider` (in-memory `Map`).

Registry in `providers/index.ts` is the ONLY place that knows concrete classes. Swap via `set*Provider(next)`; requires the candidate to implement all required methods (validated up front) and blocks swaps while `isAssemblyInProgress()` is true (guards against reading mixed old/new state mid-assembly).

Episodic is append-only by contract — there is no `update`/`delete`, so a correction is a NEW episode, never an edit.

`list()` returns a COPY (`[...stored]`), so a consumer/build never aliases the provider's mutable store.

## 4. Retrieval Pipeline

Steps (from `retrievalOrchestrator.ts`):

1. `buildRetrievalQuery(context)` — derives `RetrievalQuery` (regime, assets, protocols, objective, riskProfile, the union `tags`, and `now = AgentContext.meta.timestamp`). `now` uses context time, never `Date.now()`, so recency is reproducible.
2. One `list()` per provider (episodic/semantic/working).
3. Agent-ownership filter (`r.agentId === agentId`).
4. `buildTagIndex` + `filterCandidatesByTags` — single-pass tag bucket index; candidates are the union of buckets matching `query.tags` (falls back to full list when tags empty).
5. `scoreEpisodicRecord` / `scoreSemanticFact` — deterministic weighted sum (weights sum to 1.0, asserted at load). Components: regime 0.25, protocol 0.15, asset 0.15, objective 0.15, riskProfile 0.10, recency 0.10 (7-day half-life), confidence 0.05, quality 0.05.
6. `rankEpisodicRecords` / `rankSemanticFacts` — sort by `score.total` desc, tie-break by timestamp/updatedAt desc, then `id` asc (stable, deterministic).
7. `selectTopK` — pure slice (defaults 10 episodic, 10 semantic, 5 working).
8. `validateRetrieval` — fails closed.
9. `computeRetrievalHash` — SHA-256 over stable-stringified query + selected records + `RETRIEVAL_RANKING_VERSION`.

```
AgentContext
   │ buildRetrievalQuery
   ▼ RetrievalQuery (regime, assets, protocols, objective, riskProfile, tags, now)
   │ list() x3 providers (one call each)
   ▼ tag-index candidate filter
   ▼ relevance scoring (deterministic weights)
   ▼ ranking (score desc, timestamp desc, id asc)
   ▼ Top-K selection
   ▼ validateRetrieval (fail closed)
   ▼ MemoryRetrievalPackage (frozen, hashed)
```

## 5. Intelligence Pipeline

Steps (from `intelligenceOrchestrator.ts`, Phase 3):

1. `retrieveMemoryPackage(context)` — Phase 2, unmodified.
2. `aggregateByTag(episodic)` — THE single full traversal: builds `Map<tag, TagAggregate>` with win/loss/neutral/pending ids, confidence sum/count.
3. `computeStatistics` — counts, win/loss rates, average/median return (one sort), average holding/confidence/quality, protocol/asset/regime frequency tables, max gain, max drawdown. Absent data → `null` (never fabricated as 0). `averageAllocation` is always `null` (schema gap, documented).
4. `detectPatterns` — fixed thresholds: `MIN_PATTERN_SUPPORT = 3`, `PROFITABLE_WIN_RATE_THRESHOLD = 0.6`, `LOSING_WIN_RATE_THRESHOLD = 0.4`, `MIN_STREAK_LENGTH = 3`. Regime/protocol/asset win-rate patterns; `repeated-loss-streak` (>=3 chronological losses); `repeated-recovery` (>=3 loss→win transitions). One extra timestamp sort for streaks.
5. `analyzeConflicts` — per pattern, surfaces supporting AND conflicting episode ids; `evidenceStrength = |support − conflict| / total`.
6. `buildEvidence` — per pattern, structured `Evidence` (id, type, supporting ids, confidence, quality, statisticalSupport, affected assets/protocols/regimes).
7. `validateIntelligence` — fails closed.
8. Compute `packageHash` — SHA-256 over stable-stringified query + statistics + patterns + conflicts + evidence + `INTELLIGENCE_VERSION`.

```
MemoryRetrievalPackage (ranked episodes)
   │ aggregateByTag (ONE full pass)
   ├─► computeStatistics
   ├─► detectPatterns (reuses aggregate + 1 timestamp sort)
   │      ├─► analyzeConflicts (reuses pattern ids)
   │      └─► buildEvidence    (reuses pattern ids + shared byId index)
   ▼ validateIntelligence (fail closed)
   ▼ MemoryIntelligencePackage (frozen, hashed)
```

## 6. Validation Pipeline

Three layers, each fails closed (returns `{ok, errors}` and marks `status: 'invalid'`, but never throws away the package — callers can see why):

- Phase 1 `validateMemoryPackage`: duplicate ids, malformed timestamps, invalid outcome/quality enums, out-of-range confidence, missing contextRef, invalid pnl/holdingTimeSeconds, schema version match.
- Phase 2 `validateRetrieval`: reuses Phase 1 + score sanity, duplicate selected ids, malformed tags, malformed retrieval metadata.
- Phase 3 `validateIntelligence`: non-finite/out-of-range statistics, outcome counts not summing to `totalEpisodes`, duplicate pattern/evidence ids, pattern/conflict/evidence referencing unknown episode/pattern ids, `supportCount > totalCount`, out-of-range confidence/quality/statisticalSupport/evidenceStrength.

`status` is always derived from `validation.errors.length === 0` — exactly one source of truth.

## 7. Metadata

- `MemoryPackageMeta`: `version` (`MEMORY_PACKAGE_SCHEMA_VERSION = '1.0.0'`), `agentId`, `timestamp` (`Date.now()`, build-specific), `packageId` (`randomUUID()`, build-specific), `packageHash`.
- `IntelligenceMetadata`: `intelligenceVersion` (`INTELLIGENCE_VERSION = '1.0.0'`), per-stage durations (`intelligenceDurationMs`, `statisticsDurationMs`, `patternDurationMs`, `conflictDurationMs`, `evidenceDurationMs`, `packageGenerationDurationMs`), `patternCount`, `evidenceCount`, `packageHash`.
- `RetrievalMetadata`: scan/select counts, `rankingDurationMs`, `rankingVersion`, `retrievalHash`.

`timestamp`/`packageId` are intentionally build-specific and differ per call; they are EXCLUDED from hashes so replay produces identical hashes.

## 8. Hashing

- `stableStringify` recursively sorts object keys (arrays keep order), maps `undefined→null`, `Date→ISO`, `BigInt/Symbol→null`, and `Map`/`Set` to their entry/array form. Serialization depends only on content, never insertion order.
- Phase 1 `packageHash`: SHA-256 over `{agentId, version, episodic, semantic, working, validation, status}`.
- Phase 2 `retrievalHash`: SHA-256 over `{query, episodic, semantic, working, rankingVersion}`.
- Phase 3 `packageHash`: SHA-256 over `{query, statistics, patterns, conflicts, evidence, intelligenceVersion}`.
- Changing historical data changes derived statistics → changes the hash. Identical input → identical hash.

## 9. Determinism Guarantees

- No randomness, no ML, no LLM. All sorting is stable; all Map/Set iteration is insertion-ordered (deterministic given input order); `stableStringify` removes key-order dependence.
- Recency uses `AgentContext.meta.timestamp`, not wall-clock.
- `packageId`/`timestamp` are the only non-deterministic fields and are excluded from hashes.
- Consequence: identical `AgentContext` + identical provider state → byte-identical statistics/patterns/conflicts/evidence and identical `packageHash` across any number of runs and any concurrency level.

## 10. Replay Guarantees

- Replaying the build over identical inputs yields identical `statistics`, `patterns`, `conflicts`, `evidence`, and `packageHash`.
- The full package object is NOT byte-identical across replays only because `meta.timestamp`/`meta.packageId` differ (by design). Consumers must compare on `packageHash` (and `retrievalHash`), not on `packageId`.
- Verified by existing tests: repeated builds, 100- and 1000-way concurrent builds, and insertion-order insensitivity.

## 11. Public API

CRITICAL NOTE: The governing directive refers to a single interface `buildMemoryPackage(agentContext)`. The FROZEN code actually exposes the following (document these accurately; do NOT invent `buildMemoryPackage`):

- `assembleMemoryPackage(agentId: string): Promise<MemoryPackage>` — Phase 1 entry point (in `memoryLayer/index.ts`).
- `retrieveMemoryPackage(context: AgentContext, options?: RetrievalOptions): Promise<MemoryRetrievalPackage>` — Phase 2 entry point.
- `buildMemoryIntelligencePackage(context: AgentContext, retrievalOptions?, intelligenceOptions?): Promise<MemoryIntelligencePackage>` — Phase 3 entry point.
- Lower-level pure exports (also re-exported): `computeStatistics`, `detectPatterns`, `analyzeConflicts`, `buildEvidence`, `aggregateByTag`, `validateIntelligence`, `validateMemoryPackage`, `validateRetrieval`, `buildRetrievalQuery`.
- Provider registry: `get*Provider`, `set*Provider`, `reset*Provider`, `resetAllMemoryProviders`.
- Metrics: `getMemoryMetricsSnapshot`, `getRetrievalMetricsSnapshot`, `getIntelligenceMetricsSnapshot` + `reset*` variants.
- Constants: `MEMORY_PACKAGE_SCHEMA_VERSION`, `RETRIEVAL_RANKING_VERSION`, `INTELLIGENCE_VERSION`, `MIN_PATTERN_SUPPORT`, `MIN_STREAK_LENGTH`, `PROFITABLE_WIN_RATE_THRESHOLD`, `LOSING_WIN_RATE_THRESHOLD`, `SCORE_WEIGHTS`, `QUALITY_SCORE`.

Recommended consumption: the Reasoning Engine should call `buildMemoryIntelligencePackage(context)` (or `assembleMemoryPackage` + `retrieveMemoryPackage`) and read the frozen package. It must NOT call provider `list()`/`append()` directly.

## 12. Performance Characteristics

- `aggregateByTag`: O(n) single pass (the only full traversal shared by stats + patterns).
- `computeStatistics`: O(n) + one O(n log n) median sort.
- `detectPatterns`: O(n) tag work + one O(n log n) streak sort.
- `analyzeConflicts` / `buildEvidence`: O(n) shared `byId` index (built once in the orchestrator), no duplicate full traversal.
- `validateIntelligence`: O(patterns + episodes).
- Hashing: O(output size) SHA-256 over stable string.
- Profile is linear-to-near-linear; existing Phase 2 audit asserts 5000 records retrieve in < 1000 ms. No unbounded allocations; `list()` returns copies; output is frozen. No leaks across repeated builds (only in-process metric counters are retained).

## 13. Concurrency Model

- Node.js single-threaded event loop. No worker threads, no explicit mutexes.
- Safety comes from: (a) immutable snapshots — `list()` returns copies; (b) `deepFreeze` on every package; (c) append-only episodic provider (no update/delete); (d) `assemblyInProgress` counter blocks provider swaps mid-assembly.
- Concurrent builds read the same immutable provider arrays; single-threaded interleaving means no true data races. Verified: 100- and 500-way concurrent retrievals/intelligence builds produce identical hashes.
- Note: metrics modules hold shared mutable counters — observability state only; they do not affect package output.

## 14. Observability

- Three counter/snapshot metric modules mirror the Context Layer pattern: `metrics.ts` (assembly/validation), `retrieval/metrics.ts` (scan/select/duration), `intelligence/metrics.ts` (per-stage duration, pattern/evidence counts, success/failure).
- `logIfSlow()` emits a single structured `console.warn` only when an intelligence build exceeds 500 ms (log the anomaly, not every call).
- Read snapshots via `get*MetricsSnapshot()`; reset via `reset*Metrics()` (test-only).

## 15. Testing Strategy

Unit + integration + audit suites under `backend/src/__tests__/`:

- `memoryLayer.test.ts` — providers, validation, orchestrator assembly, provider-swap validation, agent isolation, immutability.
- `memoryLayerDeterminism.test.ts` — `packageHash` stability across replays and insertion order; sensitivity to real record changes.
- `memoryRetrieval.test.ts` / `memoryRetrievalAudit.test.ts` — query building, scoring/ranking, Top-K, agent isolation, determinism, 20- and 100-way concurrency, 5000-record scale.
- `memoryIntelligence.test.ts` — statistics, patterns, conflicts, evidence, immutability, retrievalSummary, metadata, determinism (repeated + 100-way concurrency).
- `memoryIntelligenceValidation.test.ts` — direct `validateIntelligence` fail-closed on NaN/Infinity/duplicate/dangling/impossible data.
- `memoryIntelligenceAudit.test.ts` — regression tests for the production-audit fixes (maxGain/maxDrawdown semantics, confidence-consistency, centralized regime vocabulary, shared byId, conflict episode-reference validation, stableStringify Map/Set, chaos fail-closed, 1000-build determinism, tenant isolation).

Philosophy: every invariant (determinism, fail-closed, immutability, tenant isolation, hash sensitivity) has an explicit assertion, including concurrency stress.

## 16. Operational Guidance

- Before consuming a package, ALWAYS check `status === 'valid'` (and `validation.errors` if invalid). An invalid package is still returned so the caller can inspect why.
- Key consumer identity on `intelligence.packageHash` / `retrieval.retrievalHash`, never on `meta.packageId` (which is `randomUUID` and differs per build).
- Agent isolation is enforced by `agentId` partitioning; never share a provider instance's data across agents — the engine filters by `agentId` defensively.
- Do not swap providers while assemblies are in flight (`set*Provider` throws if `isAssemblyInProgress()`).
- Treat `maxGain`/`maxDrawdown` as sign-clamped (floored at 0): `maxDrawdown` is `min(0, minReturn)`, `maxGain` is `max(0, maxReturn)`.
- `averageAllocation` is always `null` (schema gap); do not assume a value.
- `averageConfidence`/`averageQuality` exclude non-finite/malformed values rather than diluting with 0.
- Monitor the `logIfSlow` warning (>500 ms) as a production health signal.

## 17. Known Extension Points

All must be ADDITIVE and backward-compatible.

- New storage providers: implement the three interfaces and `set*Provider` — no orchestrator change.
- New statistics fields: add to `ExperienceStatistics` with `null` defaults; keep existing fields stable.
- New pattern types: extend `PatternType` and `detectPatterns` (new `id` namespace) without altering existing thresholds/ids.
- New relevance signals: extend `SCORE_WEIGHTS` only with a compensating change that keeps the sum at 1.0 (asserted at load); bump `RETRIEVAL_RANKING_VERSION`.
- New quality scales: extend `QUALITY_SCORE` (shared by Phase 2 + 3).
- Schema evolution: bump `MEMORY_PACKAGE_SCHEMA_VERSION` / `INTELLIGENCE_VERSION` only when a shape change would break a persisted package; validation rejects mismatched versions.
- Pluggable metrics sink: replace console logging in `logIfSlow` without touching core logic.

Explicitly OUT OF SCOPE (deferred to future phases, require schema additions): persistent storage providers (already listed as an extension); episode writers wired to decision/execution; semantic-fact derivation; policy-violation detection (needs an `EpisodicRecord` violation field); any reasoning/decision-making; attaching the package onto `AgentContext`.
