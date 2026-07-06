# Context Layer

The Context Layer is the first layer of the Kairos AI Operating System. It produces one
immutable snapshot — `AgentContext` — representing everything an AI agent is authorized to know
about a specific agent at a specific point in time.

**The Context Layer never reasons, predicts, executes, or calls an LLM.** It only answers: *what
is true right now?*

Code: `backend/src/agentContext/`. Public surface: `backend/src/agentContext/index.ts`.

## Five domains

| Domain | File | Answers |
|---|---|---|
| Market | `domains/marketContext.ts` | price, oracle freshness, trend/momentum/volatility/volume/liquidity, regime |
| Managed Capital | `domains/capitalContext.ts` | capital under delegation, idle/deployable, allocations, protocol exposure, PnL, pending executions |
| Policy | `domains/policyContext.ts` | objective, risk profile, allowed assets/protocols, spend/position limits, delegation status |
| System | `domains/systemContext.ts` | oracle/scheduler/price-feed health, protocol/execution availability, feature flags |
| Historical | `domains/historicalContext.ts` | last execution/decision, recent failures, cooldown — bounded operational history, not memory |

Managed Capital and Policy deliberately hide blockchain implementation details (wallet addresses,
contract IDs, signatures, nonces, tx hashes) — an AI agent reasons like a portfolio manager, not a
blockchain client.

## Assembly: `contextBuilder.ts`

`buildAgentContext(agentId, options?)`:
1. Reads the agent row (`agentService.getAgentRow`) — one DB read.
2. Calls `featureEngine.buildFeatureResult` once — this is the only oracle/indicator computation
   in the whole build; every domain below reads from its result, none re-derive it.
3. Builds all five domain views from that single `FeatureBuildResult` + agent row.
4. Runs `validateAgentContext` (see below) and stamps the result into `context.validation`/`status`.
5. Computes `contextHash` (SHA-256 over the context with wall-clock-relative fields — `builtAt`,
   `computedAt`, every `*ageSeconds`/`remainingSeconds` — stripped first) and a random `snapshotId`.
6. Returns `Object.freeze(context)`.

`refreshAgentContext(agentId, options?)` forces a cache bypass (see below) — use after an event
that makes the cached FeatureSet stale before its TTL expires (e.g. a trade fill).

Returns `null` only when the agent doesn't exist or the oracle doesn't have enough candle history
yet — otherwise it always returns a context, even an invalid one (see Validation).

## Reproducibility

Two builds of the same underlying agent state + market snapshot produce the **same
`contextHash`**, regardless of which instant either build ran at — verified in
`__tests__/contextLayer.test.ts` and `contextLayerCorrectness.test.ts`. The hash is SHA-256 over all
fields with wall-clock-relative values — `builtAt`, `computedAt`, every `*ageSeconds`/`remainingSeconds` —
stripped first. `snapshotId` is unique per build (for audit trails); `marketId`
(`"<pair>@<lastCandleTime>"`) is shared by every build against the same oracle snapshot.

Determinism is verified in 3 ways:
1. **Same-input identity**: Two sequential `buildAgentContext` calls on the same agent return matching hashes.
2. **Cold-cache concurrency**: N simultaneous first-ever builds for the same agent all return the same hash.
3. **Forced-refresh concurrency**: N simultaneous `refreshAgentContext` calls (guaranteed cache miss) all return the same hash.

All three checks run in the test suite and assert strict hash equality.

## Validation (`validation.ts`)

Checked before a context is considered fit for any future AI layer:
- oracle freshness (age ≤ 900s)
- market price present and positive
- managed capital loaded (finite number)
- portfolio allocation complete
- a policy/role is assigned
- system reports the oracle healthy
- no protocol exposure without a corresponding allowed protocol
- `meta.version` must be a supported build version (defined in `contextBuilder.ts`)
- `policy.riskProfile` must be one of the known profiles: `conservative`, `moderate`, `aggressive`, `unspecified`
- every entry in `policy.allowedAssets` must match `[A-Z]{2,10}` — numeric codes or special characters are rejected
- validation fails as soon as the first invalid `allowedAssets` entry is found (no partial-allowlist risk)

`status: 'valid' | 'invalid'` and `validation.errors[]` are always present on the context — an
invalid context is not thrown away, so the frontend debug viewer and audit trail can see *why* it
failed. **No future reasoning/decision/execution layer should act on a context where
`status !== 'valid'`.**

Validation is exercised exhaustively in `contextLayerValidationCoverage.test.ts` (56 tests) —
every error path is tested individually, and the combined multi-error case ensures all errors appear
in the same `validation.errors[]` array.

## Cache abstraction

`cache/index.ts` exposes `FeatureCacheProvider` (get/set/invalidate/clear/size). The default is
`InMemoryFeatureCacheProvider` (5s TTL). `featureEngine`/`contextBuilder` depend only on the
interface — swapping in a Redis-backed provider later is `setFeatureCacheProvider(new RedisProvider())`
with no call-site changes.

### Cache Stampede Protection

`featureEngine.ts` implements per-key in-flight Promise deduplication:
1. Before computing a feature set, the engine checks `inFlight` Map for an existing promise keyed by
   `agentId@pair`.
2. If a computation is already in flight, the concurrent caller awaits the same promise instead of
   starting a duplicate oracle/indicator build.
3. On resolution (success or failure), `finally()` removes the key from `inFlight` — no stale promise
   retention, no memory leak on errors.
4. The cache is still set on success, so subsequent callers (after the in-flight completes) hit a warm
   cache and skip the in-flight check entirely.

This is a per-process mechanism (in-memory Map), not distributed — each process gets its own. Fine
for single-process deployments; a distributed shared-cache deployment would need a Redis-based lock.

### Concurrency Model

All concurrent-access guarantees are verified in `contextLayerConcurrency.test.ts` (15 tests):
- **Cold-cache race**: N first-ever concurrent builds against the same agent all return the same hash
  (verified via the stress test suite). Only one process computes; the rest coalesce.
- **Warm-cache race**: Once the cache is warm, concurrent requests hit it and never recompute.
- **Multi-agent non-interference**: 50 different agents built concurrently each get correct,
  non-cross-contaminated data.
- **Cache-miss race**: Concurrent `refreshAgentContext` calls (guaranteed cache miss) never corrupt
  the cache or produce inconsistent hashes.
- **Benchmarks**: Throughput/latency profiled at 10, 50, and 100 concurrent requests (both warm and
  cold cache) — metrics recorded but no assertion, for regression comparison.

## Operational monitoring (`metrics.ts` + `monitor.ts`)

Pure observability — records what happened, never changes what a context looks like or how it's
built.

**`metrics.ts`** — in-process counters, recorded from `contextBuilder.ts`/`featureEngine.ts` call
sites (not by reasoning about them after the fact):
- **Context build**: count, success/failure/null outcome counts, avg/min/max duration, slow-build
  count (≥500ms — logged via `console.warn` the instant it happens, not just aggregated).
- **Cache**: hit count, miss count, hit rate.
- **Provider latency**: avg/max ms per `FeatureCacheProvider` call (get or set) — provider-agnostic,
  so it covers a future Redis-backed provider automatically.
- **Validation**: ok/fail counts, top 10 most frequent validation error strings.
- **Quality**: average `quality.score`, counts per `quality.level` (high/medium/low).
- **Confidence**: average confidence per domain (market/capital/policy/system/historical).

`getContextMetricsSnapshot()` returns all of the above; exposed at `GET /api/context-metrics`.

**`monitor.ts`** — a periodic self-check over that snapshot, reusing `runner.ts`'s
`setInterval`-based scheduler pattern (`startContextMonitor()`/`stopContextMonitor()`/
`isContextMonitorRunning()`), on its own cadence (`CONTEXT_MONITOR_INTERVAL_MS`, default 60s —
independent of `SCHEDULER_INTERVAL_MS`). Runs one check immediately on start, then every interval.
`getContextHealthSummary()` is the pure, synchronous function that does the actual evaluation — safe
to call from a route on every request, not just on the monitor's cadence.

### Thresholds

| Warning code | Condition | Rationale |
|---|---|---|
| `LOW_SUCCESS_RATE` | success rate < 95% (only once ≥1 build recorded) | builds failing/returning null more than occasionally means something upstream is degraded |
| `HIGH_VALIDATION_FAILURE_RATE` | validation failure rate > 20% | the *data* feeding the layer is suspect, even though invalid contexts are still returned for inspection |
| `LOW_CACHE_HIT_RATE` | hit rate < 50% (only once ≥20 cache reads recorded, to avoid noise on a cold/idle system) | cache isn't doing its job — every request re-hitting the oracle |
| `HIGH_SLOW_BUILD_RATE` | slow-build rate > 5% | latency is systemic, not a one-off outlier |
| `LOW_AVG_QUALITY` | average `quality.score` < 0.4 | contexts are technically valid but routinely low-confidence |

Thresholds live in `monitor.ts` as plain constants (not env/config) since they're monitoring
judgment calls, not deployment parameters. When any threshold is exceeded, the self-check logs one
structured line: `[context-monitor] degraded: {"checkedAt":...,"warnings":[{"code":...,
"message":...,"observed":...,"threshold":...}]}` — JSON, not prose, so a log pipeline or a human
grepping logs can pull fields out directly.

### Extension points (Prometheus / OpenTelemetry)

Both `getContextMetricsSnapshot()` and `getContextHealthSummary()` are pure functions with no
framework dependency — the single seam a future exporter needs:
- **Prometheus**: wrap `getContextMetricsSnapshot()`'s fields as `prom-client` gauges/counters in a
  `GET /metrics` (text-format) handler; call `.set()`/`.inc()` from the same call sites `metrics.ts`
  already instruments, or scrape the snapshot on Prometheus's own pull interval.
- **OpenTelemetry**: register an OTel `Meter` with observable gauges that read
  `getContextMetricsSnapshot()`/`getContextHealthSummary()` on each collection callback — no change
  needed to `contextBuilder.ts`, `featureEngine.ts`, or `monitor.ts` itself.

Neither is wired in today — no external monitoring framework is a dependency of this layer.

### API

- `GET /api/context-metrics` — raw counters (`getContextMetricsSnapshot()`).
- `GET /api/context-health` — health status/warnings (`getContextHealthSummary()`), computed fresh
  on every request.
- `GET /api/agents/:id/context?refresh=true&pair=XLM/USDC` — build or retrieve context for an agent.

Both `/api/context-metrics` and `/api/context-health` are auth-gated and mounted in `index.ts`
alongside the other `/api` routers.

#### Request Timeout

The context build endpoint enforces a 15-second wall-clock timeout via `Promise.race`. If the build
doesn't resolve within that window, the route responds with 504 Gateway Timeout. This prevents a
stuck oracle call from holding the connection indefinitely. The timeout is cleared on both success
and error paths.

#### Audit Logging

Every successful context access records an audit event via `logEvent` with:
- `eventType: 'context_access'`
- `agentId`, `owner`, `pair`
- `message` containing requester public key, status, snapshotId, and whether it was a forced refresh

Audit write failures are caught silently — the context response is never gated on audit trail
success.

### Performance overhead

Every hook is either an in-memory counter increment/`Map.set` (O(1)) or a `performance.now()` call
already bracketing work that happens anyway (the build itself, a cache read/write) — no additional
I/O, no additional DB query, no additional oracle call. The self-check loop is a single
`setInterval` reading already-recorded counters once a minute (default); its own callback does no
I/O either. Net cost: a handful of nanoseconds-to-low-microseconds per build/cache-op, indistinguishable
from noise next to a real DB read or oracle round trip.

## API

`GET /api/agents/:id/context` (auth required, agent-owner-scoped) — `backend/src/routes/context.ts`.
Query params: `?refresh=true` (bypass cache), `?pair=XLM/USDC` (default pair).

## Frontend

`apps/web/app/dashboard/context/page.tsx` — a developer/debug panel reachable via the "Context"
nav item. Renders every field of the live `AgentContext` returned by the API above (agent picker,
snapshot metadata, all five domain cards, validation errors if any). No mock data — every value
comes straight from the backend response.

## Reused, not duplicated

Every number in a context comes from an existing service: `decisionEngine.buildMarketContext`
(oracle+indicators+base regime, called exactly once per cache miss), `portfolioService`,
`protocolPositionService`, `pnl.ts`, `tradeService`, `decisionService`, `auditService`,
`runner.isSchedulerRunning`, `priceFeed.isRunning`, `config.isProtocolExecutionEnabled`. No
indicator, PnL, or allocation math is recomputed inside `agentContext/`.

## Test suite

All test files live in `backend/src/__tests__/` and use the same in-memory SQLite + deterministic
oracle mock (`MockOracle`) for reproducible runs. No external services, no network I/O.

| File | Tests | What it covers |
|---|---|---|
| `contextLayer.test.ts` | 6 | Basic build, refresh, hash determinism, null on missing agent |
| `contextLayerCorrectness.test.ts` | 15 | Hash stability across sequential builds, marketId invariance, snapshotId uniqueness, null-agent edge cases, re-initialization |
| `contextLayerValidationCoverage.test.ts` | 56 | Every individual validation error path, multi-error accumulation, valid context bypass |
| `contextLayerStress.test.ts` | 9 | Cold-cache coalescing (same-agent concurrency), warm-cache hit rate, multi-agent non-interference, forced-miss races, benchmarks at 10/50/100 concurrency |
| `contextLayerConcurrency.test.ts` | 15 | Parallel build/refresh, sequential reuse token, status enumeration, in-flight dedup across concurrent builds, error isolation per agent, near-simultaneous refresh-all consistency |
| `contextLayerE2E.test.ts` | 12 | Full HTTP pipeline: 200/400/404/500 responses, auth enforcement, pair validation, error isolation, no-internal-detail-leak |
| `contextLayerSecurity.test.ts` | 23 | Permissions: agent ownership, wallet scoping, non-owner rejection, owner-only access, owned-vs-scoped separation, auth requirement, invalid/forged tokens, missing auth header, 401 vs 403 semantics |
| `contextLayerReliability.test.ts` | 22 | Graceful recovery: mock-resets, cache sweep, repeated refresh, lifecycle (start/stop/restart of monitor/metrics), error recovery after failures, rapid rebuild cycles |
| `contextLayerMetrics.test.ts` | 11 | Counter accuracy: build counts, success/failure/null counts, cache hit/miss rates, validation ok/fail, quality score distribution, slow-build detection |
| `contextLayerMonitor.test.ts` | 14 | Health summary: warning generation (success rate, validation failure rate, cache hit rate, slow-build rate, avg quality), threshold testing, empty-state handling |
| `validation.test.ts` | 7 | Validation function unit tests: freshness, positive price, finite capital, complete allocation, policy assigned, oracle healthy, protocol exposure matched |
| `dbIntegrity.test.ts` | 4 | DB integrity: context_access event type acceptance, foreign key constraint handling |

Total: **229 tests** across **17 files**.

## What's explicitly out of scope here

No LLM calls, no agents, no memory/RAG, no strategy layer, no decision engine, no execution
changes, no SDK changes, no smart contract changes. This layer only prepares information.
