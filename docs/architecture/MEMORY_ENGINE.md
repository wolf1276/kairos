# Memory Engine (Phase 1: Foundation, Phase 2: Retrieval & Relevance, Phase 3: Experience Intelligence, Phase 4: Production Hardening)

The Memory Engine is the second layer of the Kairos AI Operating System, sitting alongside the
[Context Layer](./CONTEXT_LAYER.md). Phase 1 produces one immutable snapshot — `MemoryPackage` —
representing everything an agent remembers. Phase 2 narrows that down to what's relevant right
now, given an `AgentContext`. Phase 3 (below) turns those ranked memories into structured,
evidence-based experience intelligence — statistics, patterns, and conflicts — completing the
Memory Layer.

No LLM, embeddings, vector DB, similarity search, summarization, reasoning, execution, or learning
lives anywhere in this module — deterministic assembly and deterministic retrieval only. It
answers *what does this agent remember right now, and what of that is relevant?* — never *what
should the AI do?*

Code: `backend/src/memoryLayer/`. Public surface: `backend/src/memoryLayer/index.ts`.

## Architecture

```
AgentContext
    |
    v
MemoryOrchestrator
    |
    +--> EpisodicMemoryProvider
    +--> SemanticMemoryProvider
    +--> WorkingMemoryProvider
    |
    v
MemoryPackage
    |
    v
Future Reasoning Layer
```

## Three memory kinds

| Kind | File | Mutability | Contents |
|---|---|---|---|
| Episodic | `providers/inMemoryEpisodicProvider.ts` | Append-only | Completed experiences: ids, timestamps, context/decision/execution refs, outcome, pnl, holding time, confidence, quality, tags |
| Semantic | `providers/inMemorySemanticProvider.ts` | Upsert (replace by key) | Long-term facts only — no events, no predictions |
| Working | `providers/inMemoryWorkingProvider.ts` | Mutable, TTL-based | Temporary operational state — explicitly not durable |

Episodic memory has no update/delete method on its provider interface — a correction is a new
episode, not an edit to an old one.

## Provider abstraction

Each memory kind is defined by an interface in `providers/types.ts`
(`EpisodicMemoryProvider`/`SemanticMemoryProvider`/`WorkingMemoryProvider`). `providers/index.ts`
is a registry — the only place that knows the concrete implementation — following the same
pattern as `agentContext/cache/index.ts`'s `FeatureCacheProvider` registry:

- `get*Provider()` — read the active provider.
- `set*Provider(next)` — swap it (e.g. for a future SQLite/Postgres-backed provider, or a test
  double). Validates the candidate has every required method before swapping, so a bad swap
  fails loudly at the call site instead of deep inside an orchestrator run.
- `reset*Provider()` — restore the default in-memory provider (test isolation).

Default implementations are in-memory only. No storage mechanism is hardcoded elsewhere in the
module — swapping storage later requires no change to `orchestrator.ts`.

## Assembly: `orchestrator.ts`

`assembleMemoryPackage(agentId)`:
1. Reads episodic/semantic/working records from their providers (list-only, no filtering/ranking).
2. Runs `validateMemoryPackage` (see below) and stamps the result into `package.validation`/`status`.
3. Computes `packageHash` (SHA-256 over the stable-stringified package content) and a random
   `packageId`.
4. Returns `Object.freeze(memoryPackage)`.

`status` is derived from `validation.errors.length === 0`, never from a separately-tracked flag —
there is exactly one source of truth for "is this package invalid".

## Validation (`validation.ts`)

Fails closed: any malformed record marks the whole package invalid rather than silently dropping
it. Checks:
- Duplicate episodic/semantic ids.
- Malformed records (missing id/key, invalid timestamp, out-of-range confidence, invalid
  outcome/quality enum values, invalid pnl/holdingTimeSeconds).
- Schema version match against `MEMORY_PACKAGE_SCHEMA_VERSION`.

Pure function, no I/O — mirrors `agentContext/validation.ts`'s style.

## Determinism

`packageHash` depends only on the underlying records (agentId, episodic, semantic, working,
validation, status), sorted-key stable-stringified — two assemblies over identical records hash
identically regardless of call order or wall-clock time. `packageId`/`timestamp` are
build-specific and always differ between calls, matching `AgentContext.meta`'s
`snapshotId`/`contextHash` split.

## Observability

Reuses the Context Layer's counter/snapshot pattern (`agentContext/metrics.ts`) in
`memoryLayer/metrics.ts` — `recordMemoryAssembly`/`recordMemoryValidation` plus a
`getMemoryMetricsSnapshot()` read-only snapshot. No new monitoring framework was introduced.

## Testing

`backend/src/__tests__/memoryLayer.test.ts` — providers, validation, orchestrator assembly,
provider swap validation, agent isolation.
`backend/src/__tests__/memoryLayerDeterminism.test.ts` — packageHash stability across replays and
insertion order, and sensitivity to actual record changes.

## Phase 2: Retrieval & Relevance

Code: `backend/src/memoryLayer/retrieval/`. Public surface: `backend/src/memoryLayer/retrieval/index.ts`
(also re-exported from the top-level `memoryLayer/index.ts`).

Phase 2 answers a narrower question than Phase 1: given an `AgentContext`, *which* of the
memories a future Reasoning Layer would want are actually relevant right now? Still no LLM,
embeddings, vector DB, reasoning, execution, or learning — purely deterministic filtering,
scoring, and ranking over the Phase 1 providers.

```
AgentContext
    |
    v
retrieveMemoryPackage()
    |
    +--> buildRetrievalQuery       (AgentContext -> RetrievalQuery)
    +--> Episodic/Semantic/Working providers (Phase 1, reused, list() called once each)
    +--> tag-index candidate filter
    +--> Relevance Scoring         (scoring.ts)
    +--> Ranking                   (ranking.ts — deterministic sort + tie-break)
    +--> Top-K Selection           (topK.ts)
    +--> Retrieval validation      (retrieval/validation.ts)
    |
    v
MemoryRetrievalPackage
```

`MemoryRetrievalPackage` (`retrieval/types.ts`) is a **sibling** type to `MemoryPackage`, not a
mutation of it — Phase 1's frozen types are untouched. It carries the `RetrievalQuery` used, the
scored/ranked/selected `episodic`/`semantic`/`working` arrays, `RetrievalMetadata`, and the same
`validation`/`status` shape as Phase 1.

### RetrievalQuery (`queryBuilder.ts`)

Built once per retrieval from fields already on `AgentContext`: `regime.label`,
`policy.allowedAssets`, `policy.allowedProtocols`, `policy.objective`, `policy.riskProfile`. These
are normalized (trimmed, lower-cased) and unioned into `query.tags`, the key used to filter
episodic/semantic candidates. `query.now` defaults to `AgentContext.meta.timestamp` (not
`Date.now()`) so identical AgentContext input always produces identical recency scores and hashes.
`AgentContext` has no explicit position-type/holding-horizon field yet — those are deferred to
whichever phase adds them to the Context Layer.

### Candidate filtering (`tagIndex.ts`)

Builds a `Map<tag, records[]>` over the full provider list in one pass, then unions the buckets
matching `query.tags` — avoids re-scanning the full episodic/semantic list once per query tag.
Falls back to the full list when `query.tags` is empty.

### Relevance Scoring (`scoring.ts`)

Deterministic weighted sum, every component explainable and in `[0, 1]`:

| Signal | Weight | Definition |
|---|---|---|
| Regime match | 0.25 | record tags include `query.regime` |
| Protocol match | 0.15 | fraction of `query.protocols` present in record tags |
| Asset match | 0.15 | fraction of `query.assets` present in record tags |
| Objective match | 0.15 | record tags include `query.objective` |
| Risk profile match | 0.10 | record tags include `query.riskProfile` |
| Recency | 0.10 | exponential decay, 7-day half-life, relative to `query.now` |
| Confidence | 0.05 | the record's own `confidence` field |
| Quality | 0.05 | `EpisodicRecord.quality` mapped high=1/medium=0.6/low=0.3 (semantic facts: 1) |

Weights are asserted to sum to 1.0 at module load. No randomness, no ML — a `RelevanceScoreBreakdown`
is attached to every scored record so the score is always auditable.

### Ranking (`ranking.ts`)

Sorts descending by `score.total`; ties break first by timestamp/`updatedAt` (newer first), then
by `id` — so identical AgentContext + identical memory state always produces identical ordering,
regardless of the order providers happened to return records in.

### Top-K Selection (`topK.ts`)

A pure slice over the already-ranked array — selection never changes ordering. Defaults: 10
episodes, 10 semantic facts, 5 working entries; configurable via `RetrievalOptions`.

### Working memory retrieval

Providers already drop expired entries inside `list()`; Phase 2 additionally ranks by `setAt`
(most recent first) and caps at `topKWorking`. No scoring — working memory carries no
regime/protocol/asset tags to score against.

### Retrieval metadata

`RetrievalMetadata` on every package: `retrievalDurationMs`, `rankingDurationMs`,
`{episodic,semantic,working}Scanned/Selected`, `rankingVersion`, and `retrievalHash` (SHA-256 over
the stable-stringified query + selected/scored records + rankingVersion — timing fields are
excluded from the hash so it stays stable across identical repeated retrievals).

### Determinism

`retrievalHash` and full ordering are stable across: repeated calls with the same
AgentContext/provider state, provider insertion order, and concurrent calls (each retrieval only
reads immutable snapshots returned by `list()`, and never mutates shared state).

### Observability

`memoryLayer/retrieval/metrics.ts` mirrors Phase 1's counter/snapshot pattern —
`recordRetrieval`/`getRetrievalMetricsSnapshot()`. No new monitoring framework.

### Testing

`backend/src/__tests__/memoryRetrieval.test.ts` — query building, scoring/ranking correctness,
Top-K limits, agent isolation, immutability, determinism (repeated calls, insertion-order
insensitivity, concurrency), and the weight-sum invariant.

## Phase 3: Experience Intelligence

Code: `backend/src/memoryLayer/intelligence/`. Public surface:
`backend/src/memoryLayer/intelligence/index.ts` (also re-exported from `memoryLayer/index.ts`).

Phase 3 answers *"what does historical experience objectively tell us about the current
situation?"* — never *"what trade should we make?"*. Still no LLM, embeddings, vector DB,
reasoning, prediction, or natural-language summarization: every output is a deterministic
aggregate or fixed-threshold rule over Phase 2's ranked episodes.

```
AgentContext
    |
    v
retrieveMemoryPackage()        (Phase 2, unmodified)
    |
    v
Ranked episodes
    |
    v
buildMemoryIntelligencePackage()
    |
    +--> aggregateByTag()            (one pass: tagAggregation.ts)
    +--> computeStatistics()         (statistics.ts, reuses the aggregate)
    +--> detectPatterns()            (patterns.ts, reuses the aggregate + one timestamp sort)
    +--> analyzeConflicts()          (conflicts.ts, reuses pattern output — no extra scan)
    +--> buildEvidence()             (evidence.ts, reuses pattern output — no extra scan)
    +--> validateIntelligence()      (intelligence/validation.ts)
    |
    v
MemoryIntelligencePackage
    |
    v
Future Reasoning Engine
```

`MemoryIntelligencePackage` (`intelligence/types.ts`) is a **sibling** type to
`MemoryRetrievalPackage`, not a mutation of it — Phase 2's frozen types are untouched. It carries
the retrieval's `query`/`episodic`/`semantic`/`working`, plus `statistics`, `patterns`,
`conflicts`, `evidence`, a `retrievalSummary` (the numbers that came out of Phase 2), and its own
`intelligence` metadata/`validation`/`status`.

### Single-pass design

`tagAggregation.ts`'s `aggregateByTag()` is the *only* full traversal of the retrieved episodic
list. It builds a `Map<tag, {winIds, lossIds, neutralIds, pendingIds, confidenceSum, count}>` in
one loop; `computeStatistics()` and `detectPatterns()` both read from this same map instead of
re-scanning the episode list. `conflicts.ts` and `evidence.ts` operate only on the (small) set of
episode ids a pattern already references — no further traversal of the full list. The only
*additional* passes are: one sort for the statistics median, and one sort-by-timestamp for
streak detection in `patterns.ts` (documented, unavoidable for chronological analysis).

### Experience Statistics (`statistics.ts`)

Every field is a direct aggregate — counts, rates, average/median return, average holding
duration/confidence/quality, protocol/asset/market-regime usage frequency (against the closed
regime vocabulary in `agentContext/regimeDetector.ts`), max gain, max drawdown. Fields with no
eligible data are `null`, never fabricated as `0` — "no data" and "measured zero" are never
conflated. `averageAllocation` is always `null`: `EpisodicRecord` (Phase 1, frozen) carries no
allocation/position-size field; extending it is out of scope for this phase.

### Pattern Detection (`patterns.ts`)

Fixed-threshold, rule-based — not learned:
- **Regime/protocol/asset win-rate patterns**: a tag needs `MIN_PATTERN_SUPPORT` (3) episodes to
  be reported at all. Win rate ≥ `PROFITABLE_WIN_RATE_THRESHOLD` (0.6) → `*-success`/
  `profitable-regime`; win rate ≤ `LOSING_WIN_RATE_THRESHOLD` (0.4) → `*-failure`/`losing-regime`.
  Regime patterns cover every regime tag actually observed in the episodes (not just the current
  AgentContext's regime), so a losing regime the agent isn't currently in can still surface.
- **`repeated-loss-streak`**: any timestamp-consecutive run of ≥ `MIN_STREAK_LENGTH` (3) losses.
- **`repeated-recovery`**: loss→win transitions, reported once ≥ `MIN_STREAK_LENGTH` occurrences
  exist across the whole retrieved history.

Every pattern carries `supportingEpisodeIds`/`conflictingEpisodeIds` — never an opinion, always a
reference back to real episode ids (validated, see below). "Recurring policy violations" from the
Phase 3 spec are **not implemented**: `EpisodicRecord` has no policy-violation field to detect
them from (documented technical debt, not fabricated).

### Conflict Analysis (`conflicts.ts`)

For every pattern, reports the episodes that *disagree* with it (e.g. the losses inside a
`protocol-success` pattern) rather than hiding them. `evidenceStrength = |support − conflict| /
total` — 1.0 means unanimous, 0.0 means a dead split. Reasoning about what to do with a conflict
belongs to a future Reasoning Engine; Memory only reports it.

### Evidence Builder (`evidence.ts`)

Turns each pattern + its conflict analysis into a structured `Evidence` item: id, type,
supporting episode ids, confidence (pattern's average), quality (average of
`EpisodicRecord.quality` mapped to the same 1/0.6/0.3 scale relevance scoring uses),
`statisticalSupport` (support/total ratio), and the actual assets/protocols touched by the
supporting episodes. No natural language anywhere in the shape.

### MemoryPackage extension

`intelligence: IntelligenceMetadata` — `intelligenceVersion`, per-stage durations (statistics/
pattern/conflict/evidence/package-generation), `patternCount`, `evidenceCount`, and `packageHash`
(SHA-256 over the stable-stringified query + statistics + patterns + conflicts + evidence +
version — timing fields excluded so identical input hashes identically across runs).
`retrievalSummary` carries the selected counts and `retrievalHash` straight from Phase 2, so a
consumer doesn't need to separately call retrieval to see what fed the intelligence layer.

### Validation (`intelligence/validation.ts`)

Fails closed, on top of Phase 1's record-shape validation: non-finite/out-of-range
statistics fields, outcome counts not summing to `totalEpisodes`, duplicate pattern ids, duplicate
evidence ids, patterns/conflicts/evidence referencing episode or pattern ids that don't exist,
`supportCount > totalCount`, and out-of-range confidence/quality/statisticalSupport/
evidenceStrength. Any failure sets `status: 'invalid'` — the package is still returned (so callers
can see *why*), never thrown away silently.

### Determinism

`packageHash` and every derived field are stable across repeated calls with identical
AgentContext/provider state, insertion order, and concurrency (all reads are over the immutable
arrays Phase 2 already returns; nothing here mutates shared state).

### Observability

`memoryLayer/intelligence/metrics.ts` mirrors the existing counter/snapshot pattern
(`recordIntelligence`/`getIntelligenceMetricsSnapshot()`), plus `logIfSlow()` — a single
structured `console.warn` only when a build exceeds 500ms, matching `agentContext/metrics.ts`'s
"log the anomaly, not every call" convention (an intelligence build runs every tick; per-call
logging would be pure noise at steady state).

### Testing

`backend/src/__tests__/memoryIntelligence.test.ts` — statistics, pattern detection (support
threshold, success/failure/streak patterns, episode-id reference integrity), conflict analysis,
evidence, package assembly/immutability, determinism (repeated builds, 100-way concurrency).
`backend/src/__tests__/memoryIntelligenceValidation.test.ts` — direct `validateIntelligence()`
unit tests injecting NaN/Infinity/out-of-range/duplicate/dangling-reference data.

## Phase 4: Production Hardening

Phases 1-3 are **frozen**: no new statistics, patterns, conflict/evidence logic, or intelligence
fields are added here — this phase makes the existing contract safe to run in production and
locks it against accidental drift. Still no LLM, embeddings, reasoning, or execution.

### Write-time validation

`providers/inMemoryEpisodicProvider.ts#append()`, `inMemorySemanticProvider.ts#upsert()`, and
`inMemoryWorkingProvider.ts#set()` now validate the record/fact/entry *before* accepting it,
using the same per-record checkers `validateMemoryPackage` already used
(`episodicRecordErrors`/`semanticFactErrors`/`workingMemoryEntryErrors`, extracted into
`validation.ts` for exactly this reuse — one set of rules, not two). A malformed write throws
immediately at the call site instead of silently entering storage and only surfacing later as a
whole-package `status: 'invalid'` deep inside some future `assembleMemoryPackage`/
`retrieveMemoryPackage`/`buildMemoryIntelligencePackage` call, far from where the mistake was
made. Phase 1's `validateMemoryPackage` (and Phase 3's `validateIntelligence`, which now also
checks episodic shape/duplicates directly) still run at assembly time as defense-in-depth — for
records that reached storage through some other path (a future persistent provider, a bulk
import) that didn't go through these `append`/`upsert`/`set` calls.

### Bounded memory (opt-in)

All three in-memory providers accept an optional `capacityPerAgent` constructor option
(`InMemoryEpisodicProviderOptions`/`InMemorySemanticProviderOptions`/
`InMemoryWorkingProviderOptions`). Unset (default) is unbounded — identical to pre-Phase-4
behavior, so no existing caller is affected unless it opts in. When set, the oldest record
(episodic: append order; semantic/working: least-recently-upserted/set key) is evicted once the
per-agent count exceeds capacity. This is a backstop against unbounded process-memory growth for
long-running deployments — nothing here is persisted, so an agent that never rotates or replaces
memory would otherwise grow forever.

### Frozen public contract

`backend/src/__tests__/memoryEngineHardening.test.ts`'s `frozen public contract` test asserts
`Object.keys(memoryLayer/index.ts)` against an explicit, hand-maintained list. Any accidental
export removal/rename fails this test immediately, at the point of the accident, rather than
surfacing as a downstream import error in whatever future Reasoning Engine code consumes this
module. A genuinely new, intentional public export requires updating that list (and, since it
changes the frozen contract, this document) in the same change.

### Testing

`backend/src/__tests__/memoryEngineHardening.test.ts` — write-time validation on all three
providers (rejects malformed writes, valid writes still succeed unchanged), capacity/eviction
(unbounded by default, oldest-evicted-first once set, re-touching a key isn't eviction bait,
rejects a non-positive-integer capacity), and the frozen-contract export check.

## Phase 5 (not built here)

- Persistent storage providers (SQLite/Postgres) implementing the existing provider interfaces.
- Episode writers wired to the decision/execution pipeline.
- Semantic fact derivation from episodic history.
- Policy-violation detection (requires extending `EpisodicRecord` with a violation field —
  currently undetectable from the frozen Phase 1 schema).
- Reasoning/decision-making that actually consumes `MemoryIntelligencePackage`.
- Attaching `MemoryIntelligencePackage` onto `AgentContext` (or a sibling assembly point) for the
  Reasoning Engine's actual input.
