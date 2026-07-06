# Phase 2C — Production Reliability & Chaos Testing (Reasoning Engine)

## Scope & Constraints
- Target: `backend/src/reasoning/**` provider layer (Phase 2 is feature-complete & frozen).
- **Do NOT** redesign architecture, change prompts, or modify providers — EXCEPT to fix
  Critical/High issues found below (and their regression tests).
- Goal: prove the LLM provider layer is production reliable. Deliver the 8-section report + verdict.
- Method (user-approved): **mock-`fetch` chaos harness** (deterministic, CI-safe, no keys) for all
  unit/chaos/load/security/validation/perf tests, PLUS an **optional, env-gated live smoke** for
  manual runs only.

## Environment
- Runner: `vitest` (existing suite `backend/src/__tests__/reasoningProviders.test.ts`).
- Run: `pnpm --filter backend test reasoningProviders` and `... test reasoningEngine`.
- Add a new file `backend/src/__tests__/reasoningChaos.test.ts` for the chaos/load/security/perf
  additions; extend `reasoningProviders.test.ts` only where a gap is explicitly noted.
- Hooks available: `vi.stubGlobal('fetch', fn)`, `resetProviderMetrics()`, `resetOpenRouterRegistryCache()`.

## Chaos Harness (new helpers, no real network)
Add a `chaosFetch` factory in `reasoningChaos.test.ts` exposing:
- `status(code, body, { delayMs })` — HTTP error with optional latency.
- `throwError(msg)` — simulates network/disconnect/DNS (`TypeError('fetch failed')`, `ENOTFOUND`).
- `hang()` — never resolves → exercises `AbortController` timeout.
- `slow(delayMs > timeoutMs)` and `slow(delayMs < timeoutMs)` — slow-response boundary.
- `oversized(bytes)` — giant but structurally-valid `CandidateDecision` JSON (memory/DoS probe).
- `latency(ms)` — for performance percentiles (realistic 150–900 ms jitter).
All failures normalized through `ProviderError`; assertions check `kind`, `retryable`, call counts,
`decisionId` uniqueness, metrics, and that no raw key/credential appears in thrown/logged text.

## Test Specs (mapped to brief)

### 1. Concurrency
- Extend `it.each([10,50,100,250])` provider-isolation test. At each N: unique `decisionId` (Set size
  === N), every decision `validateCandidateDecision().ok`, no cross-request shared mutable state.
- Add **250-way deterministic-hash convergence**: same `AgentContext`+`MemoryPackage`+`UserPolicy`
  across 250 parallel `buildReasoningContext`/`buildPrompt` → identical `reasoningContextHash`/`promptHash`.
- Add **memory-leak check**: run 250 requests, force `global.gc()` (node --expose-gc), assert
  `process.memoryUsage().heapUsed` delta stays bounded (< e.g. 50 MB) and metrics aggregate has no
  unbounded growth.

### 2. Chaos (each injected via `chaosFetch`, assert graceful recovery)
HTTP 429 · 500 · 503 · timeout(hang) · network disconnect(throw) · DNS failure(ENOTFOUND) ·
auth failure(401) · invalid API key(401 w/ key-shaped body) · provider unavailable(503) ·
unknown model(404) · removed model(404→fallback) · empty response · malformed JSON · partial JSON ·
markdown-wrapped JSON · **oversized response** · truncated response · slow response(boundary).
Assert: transient kinds retry, non-transient kinds fail closed, recovery returns a valid decision
where a healthy fallback exists (OpenRouter), and the process never throws an un-normalized error.

### 3. Retry & Fallback
- Retry ONLY transient (`timeout`/`rate_limit`/`network`/`provider_unavailable`/`empty_response`).
- NO retry for `invalid_json`/`validation_failed` (assert `fetchMock` call count === 1).
- Fallback ONLY to free OpenRouter models (`isModelFree` gate); never a paid model (assert every
  attempted model id is in the free set; assert a configured paid model is dropped).
- Retry budget respected: `maxRetries` bound; assert exactly `maxRetries+1` calls; assert no loop
  (prove termination under all-429 / all-503 / all-404 across free models).

### 4. Validation (fail-closed bypass attempts)
For each: NaN allocation/confidence/uncertainty · Infinity · allocation 1.5 / -0.2 · confidence 2 ·
unsupported protocol · unsupported asset · duplicate `supportingEvidence` (same source+detail) ·
invalid `alternatives[].action` · malformed `CandidateDecision` (missing required fields) ·
`metadata.reasoningHash` tamper. Assert `validateCandidateDecision(...).ok === false` with the
expected reason, including the `allowed` (policy-intersection) check.

### 5. Security
- **HIGH fix gate:** `sanitize()` must redact NVIDIA `nvapi-…` keys (currently leaks — see Fixes).
  Test: provider error body containing a real `nvapi-…` key → message/log contains `[redacted]`,
  never the literal key. Also assert `sk-…`, `Bearer …`, `api_key:…` still redacted.
- Prompts sanitized: assert no secret shape in any prompt section (Phase 1 context has none; verify).
- Provider errors sanitized: capture `console.log` (stub) and assert no credential in any
  `reasoning-engine-provider` log line.
- No cross-request contamination: 250 mixed-success/failure calls → each `decisionId`/`metadata`
  independent; no leaked state between providers sharing the module-level metrics/cache.
- No cross-agent leakage: distinct `agentId` contexts → distinct hashes; no field bleeds across.

### 6. Observability
Assert structured JSON log line carries: `component`, `provider`, `model`, `latencyMs`, `tokens`,
`estimatedCost`, `retryCount`, `timedOut`, `failed`, `errorKind`, `requestId`.
Assert `getProviderMetrics()` exposes: `calls`, `failures`, `timeouts`, `retries`, `totalLatencyMs`,
`totalTokens`, `totalEstimatedCost`, `lastSelectedAt` — AND the **new `fallbacks`** counter
(OpenRouter model fallback events; currently missing → Fixes).

### 7. Performance
With `latency()`-injected fetch (realistic jitter): measure avg · P95 · P99 · throughput (req/s over
N=250) · retry overhead (latency w/ injected 429 vs clean) · fallback overhead (latency across full
free-model cascade vs single success). Identify bottlenecks (expected: network-bound only; local
parse/normalize/validate must stay < a few ms — assert local overhead < 5 ms per call).

## Fixes to Apply (Critical/High only)
1. **HIGH — credential leak (`errors.ts` `sanitize`):** extend regex to redact NVIDIA `nvapi-[A-Za-z0-9_-]{8,}`
   (and keep existing `sk-`/`Bearer`/`api_key`). Add regression test. No other provider change.
2. **MEDIUM — `fallbackCount` observability (`metrics.ts` + `openrouterProvider.ts`):** add a
   `fallbacks` field to `ProviderAggregate`/`ProviderObservability`; increment on each OpenRouter
   per-model fallback; emit in structured log. (MEDIUM, include unless user de-scopes.)
3. **MEDIUM — oversized-response guard (`schema.ts` `parseStrictJson` / `openAiCompatible.ts`):**
   cap raw body size (e.g. reject > 1 MB) and per-string field length to prevent memory/DoS from
   the "oversized response" chaos case. Fail closed with `invalid_json`/`validation_failed`.
4. **MEDIUM — 250 concurrency + hash convergence + memory check:** add tests (no source change).
5. **LOW — chaos coverage + `requestId` in metrics aggregate:** add DNS/disconnect/slow tests;
   surface `requestId` in `getProviderMetrics()` (log already has it).

Re-run affected tests after each fix; repeat until no Critical/High remain.

## Optional Live Smoke (env-gated, manual only)
New `scripts/smoke-reasoning-live.ts`, run only when `REASONING_LIVE_SMOKE=1` and a real
`{PROVIDER}_API_KEY` is set. Hits the actual provider once per configured provider, asserts a valid
`CandidateDecision` and that zero credentials appear in any thrown error. NOT part of `vitest` CI.

## Deliverable Template (final report)
- **Executive Summary** · **Issues Found** · **Fixes Applied** (root cause each) ·
  **Regression Tests** (list) · **Reliability Results** (pass/fail per area) ·
  **Performance Results** (avg/P95/P99/throughput/overhead + bottleneck) ·
  **Remaining Technical Debt** · **Production Readiness** · verdict:
  ❌ Not Ready / ⚠️ Reliability Ready / ✅ Reasoning Engine Phase 2 Reliability Verified.

## Validation
1. `pnpm --filter backend test` (reasoningProviders + reasoningEngine + reasoningChaos) → green.
2. Confirm no Critical/High open; document any MEDIUM/LOW as Remaining Technical Debt.
3. Optional: `REASONING_LIVE_SMOKE=1 pnpm ... smoke-reasoning-live` (manual, with keys).
4. Emit the 8-section report + verdict. Stop — do NOT begin Phase 2D.
