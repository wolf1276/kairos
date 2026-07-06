# Phase 2B — Multi-Model Benchmark Plan (Kairos Reasoning Engine)

**Status:** Planning artifact. This plan defines a FIXED, deterministic harness that benchmarks
the FROZEN Reasoning Engine against free OpenRouter chat models. It does NOT modify architecture,
prompts, providers, schema, or validation. Execution happens in an authorized environment with
`OPENROUTER_API_KEY` (absent in the planning sandbox).

---

## 1. Context & Goal

The LLM integration architecture (Reason` Engine Phase 2) is complete and frozen. Phase 2B must
evaluate every viable **free** OpenRouter reasoning/chat model and recommend the best production
default for Kairos, using a deterministic benchmark of 50 representative scenarios run through the
**actual frozen pipeline**.

Frozen surface used (read-only; do not change):
- `backend/src/reasoning/orchestrator.ts::runReasoning(agentContext, memoryPackage, userPolicy, provider)`
- `backend/src/reasoning/contextBuilder.ts::buildReasoningContext` (builds frozen `ReasoningContext`)
- `backend/src/reasoning/promptBuilder.ts::buildPrompt` (frozen prompt)
- `backend/src/reasoning/providers/openrouterProvider.ts::OpenRouterProvider` (constructed directly)
- `backend/src/reasoning/providers/openrouterModelRegistry.ts::fetchOpenRouterModelRegistry` / `getFreeModelIds`
- `backend/src/reasoning/validation.ts::validateCandidateDecision` + `CANDIDATE_DECISION_JSON_SCHEMA`
- `backend/src/reasoning/providers/metrics.ts` (per-call `provider_call` JSON log carries `model`,`latencyMs`,`tokens`)

Decisions already made with the user:
- **Scope:** Cap to top K free chat models (K ≈ 10–12), chosen by capability/recency/family diversity.
  Harness still enumerates the full live free list; it only *executes* the curated K.
- **Runs:** 3 runs per (model, scenario) for latency percentiles + a temp=0 determinism check.
- **Isolation:** Stub `globalThis.fetch` for `https://openrouter.ai/api/v1/models` so ONLY the target
  model is reported "free" (matches the existing test technique in `reasoningProviders.test.ts`),
  eliminating `OpenRouterProvider`'s 8-deep fallback cross-contamination. Fallback rows are also
  detected via `decision.metadata.providerVersion` and flagged.
- **Quality:** Deterministic heuristics computed by the harness + optional sampled LLM-judge (separate
  model, harness-only — does not touch the engine).

---

## 2. Deliverables

1. A new harness module **`backend/src/reasoning/benchmark/`** (new files only — no edits to existing
   engine code):
   - `scenarios.ts` — 50 deterministic scenario definitions (AgentContext + MemoryPackage + UserPolicy).
   - `modelDiscovery.ts` — fetch live free catalog, rank to top K chat-capable models.
   - `harness.ts` — drives `runReasoning` per model/scenario/run; captures metrics via `console.log`
     interception + external timers; applies `fetch` stub for isolation.
   - `metrics.ts` — aggregates per-model stats (the 15 metrics below).
   - `quality.ts` — heuristic quality scorer (policy awareness, hallucination, evidence usage, consistency).
   - `report.ts` — ranking + recommendations + markdown report writer.
   - `runBenchmark.ts` — CLI entry (`tsx`) that runs the sweep and emits `benchmark-report.md` +
     `benchmark-results.json`.
2. New tests `backend/src/__tests__/reasoningBenchmark.test.ts` validating the harness offline
   (recorded/fixture responses; no live key needed) — same pattern as `reasoningProviders.test.ts`.
3. A markdown report `docs/reasoning/PHASE_2B_BENCHMARK.md` with the ranking and the single recommended
   production default.

---

## 3. Model Discovery (top K)

- Call `fetchOpenRouterModelRegistry(apiKey)` (live). Keep only `free === true`.
- Filter to **chat-capable**: exclude ids containing `tts|audio|stt|vision|image|instruct` pitfalls is
  too crude — instead keep ids whose family is known chat/instruct AND exclude obvious non-text
  (audio/image/tts/embedding). Heuristic allowlist of families: `llama`, `mistral`, `qwen`, `gemma`,
  `deepseek`(chat), `phi`, `nemotron`, `command-r`, `hermes`, `vicuna`, `openchat`, `ministral`.
- Rank the survivors by (a) capability/recency (prefer 70B+ or latest 3.x/4.x; prefer `:free` stable
  entries), (b) family diversity (ensure at least one representative per major family), then take top K
  (default K=12, configurable `BENCHMARK_TOP_K`).
- Output: ordered list of model ids. Persist to `benchmark-models.json` for reproducibility.

---

## 4. Benchmark Dataset (50 scenarios)

Each scenario is a deterministic triple: `AgentContext` (built reusing `makeAgentContext`-style shape
from the existing tests) + `MemoryPackage` (hand-built, `status:'valid'`, `packageHash` set) +
`UserPolicy`. Cover the required axes (distribute across 50):

- Bull / Bear / Sideways / High-vol / Low-vol markets (vary `regime`, `volatilityPct`, trend/momentum).
- Empty memory (`episodic:[]`) vs Rich memory (20–40 seeded `EpisodicRecord`s with mixed outcomes).
- Contradictory evidence (memory shows both winning & losing for the same protocol/regime).
- High confidence (`context.confidence` ~0.95) vs Low confidence (~0.3).
- Large portfolio (`totalManagedCapital` 100k–1M) vs Small portfolio (500–2k).
- Plus boundary cases: policy that forbids the "obvious" action (force a policy-aware `hold`),
  out-of-policy protocol present only in memory (detect policy escape), ambiguous regime, cooldown active.

Build `ReasoningContext` via `buildReasoningContext` and `Prompt` via `buildPrompt` (frozen) so the
exact production prompt is used. For "rich memory" scenarios, optionally also build a
`MemoryIntelligencePackage` (via the frozen Memory Engine) and fold its `patterns`/`evidence` text into
the `MemoryPackage`/context where the frozen prompt expects it — keep this optional and documented.

---

## 5. Measurement Methodology

For each (model, scenario, runIndex in 0..2):
1. Stub `globalThis.fetch` so `/models` returns ONLY `{id: model, pricing:{prompt:'0',completion:'0'}}`.
   Construct `new OpenRouterProvider({ provider:'openrouter', model, apiKey, temperature:0,
   maxTokens:2000, timeoutMs:30000, maxRetries:0, structuredOutput:true })`.
2. Intercept `console.log`; call `runReasoning(...)` wrapped in an external `performance.now()` timer
   and a `try/catch`.
3. Capture from the emitted `provider_call` log line: `latencyMs`, `tokens:{prompt,completion,total}`,
   `model`, `failed`, `errorKind`, `timedOut`, `retryCount`. Capture `decision` (or thrown error).
4. Classify outcome:
   - **success** = returned `CandidateDecision` AND `validateCandidateDecision(d, deriveAllowedPolicy(ctx)).ok`.
   - **JSON validity** = raw parsed as JSON object (no `invalid_json`).
   - **schema validity** = matches `CANDIDATE_DECISION_JSON_SCHEMA` (re-validate model output shape).
   - **validation pass rate** = `validateCandidateDecision(...).ok` (includes policy + hash).
   - **malformed output count** = `invalid_json` / `empty_response` / `validation_failed`.
   - **timeout count** / **retry count** from log.
   - **average confidence** = mean `decision.confidence` over successes.
   - **average response size** = mean raw response byte length.
5. **Determinism (temp=0):** compare the 3 runs' normalized decisions (exclude `decisionId`,
   `timestamp`, `metadata.reasoningHash`/`buildDurationMs`). Record `determinismPass = all equal`.

Aggregate per model (across 50 scenarios × 3 runs = 150 calls):
- success rate, JSON validity %, schema validity %, validation pass rate, avg/P95/P99 latency
  (P95/P99 over the 150 latency samples via sorted percentile), prompt/completion/total tokens
  (means + totals), retry count, timeout count, malformed count, avg confidence, avg response size,
  determinism rate.
- Capture `providerVersion` on every decision; any `providerVersion.model !== configuredModel` ⇒
  mark `fallbackOccurred` (should be ~0 thanks to the `/models` stub; if >0, the stub failed and the
  model is flagged).

---

## 6. Quality Review (heuristics, harness-computed)

For each successful decision, score 0–1 components:
- **Policy awareness:** 1.0 if `validateCandidateDecision` passes with the real `AllowedPolicy`;
  else 0. Track policy-escape rate per model.
- **Protocol correctness:** `decision.protocol` ∈ allowedProtocols (agent∩user) AND present/referenced
  in context; else penalize.
- **Evidence usage:** fraction of `supportingEvidence[].source` that maps to context signals
  (memory patterns/evidence/regime); empty or all-generic ⇒ low.
- **Hallucination rate:** references to a protocol/asset/source NOT present in `AgentContext`/
  `MemoryPackage`/`UserPolicy` ⇒ hallucination hit (count per model).
- **Reasoning quality:** length + specificity heuristic (mentions regime/volatility/evidence) — coarse;
  refined by the optional LLM-judge on a sampled subset (e.g., 1 scenario × K models).
- **Consistency:** agreement of `action` with `regime`/memory win-rate signal (e.g., bull + profitable
  memory ⇒ not `close`; bear + losing memory ⇒ not `increase`). Coarse rule-based consistency score.
- **Determinism:** from §5.

The LLM-judge (optional, OFF by default) re-scores reasoning quality + evidence relevance on the
sampled subset using a separate fixed judge model; results are reported separately and never feed back
into the engine.

---

## 7. Output / Ranking

- Emit `benchmark-results.json` (raw per-call + per-model aggregates) and `docs/reasoning/PHASE_2B_BENCHMARK.md`.
- Rank models by a weighted score: reliability (validation pass rate, determinism) > success rate >
  quality (policy awareness, low hallucination, evidence usage, consistency) > latency (avg/P95) >
  tokens (lower better). Weights documented in `report.ts`.
- Recommend exactly ONE production default, with explicit rationale, plus the four categorical picks:
  **Best overall**, **Fastest** (lowest P95 latency), **Lowest tokens**, **Most reliable**
  (validation pass + determinism + lowest malformed/timeout), **Best reasoning** (quality score).
- State the recommended default and note it should be set via `REASONING_MODEL` (or the registry's
  `auto` default) in the authorized environment.

---

## 8. Validation Plan (harness correctness)

- `reasoningBenchmark.test.ts` runs fully offline using recorded/fixture model responses (stub
  `fetch` for both `/models` and `/chat/completions`), mirroring `reasoningProviders.test.ts`.
- Assert: scenario count = 50; each scenario produces a frozen `ReasoningContext`+`Prompt`; harness
  computes all 15 metrics; determinism check distinguishes temp=0 identical vs perturbed; policy-escape
  scenario yields `validation.ok=false` and is counted; hallucination detector flags an out-of-context
  protocol; stubbed `/models` yields zero fallback rows.
- Live run (user-executed in authorized env) appends `benchmark-results.json`; CI can fail if the
  recommended default's validation pass rate < threshold (e.g., < 0.95) — configurable.

---

## 9. Risks & Open Questions

- **Rate limits:** free-tier 429s will throttle the live sweep; harness must sequentialize with
  exponential backoff and a configurable `BENCHMARK_MAX_CONCURRENCY=1` default, and tolerate
  `rate_limit` by marking the call (not crashing). This is why we cap to K models and 3 runs.
- **Non-chat free entries:** registry is pricing-based; the family filter may miss/over-include.
  Manual review of the top-K list before the live run is required.
- **Structured-output support:** some free models ignore `json_schema`; those surface as
  `invalid_json`/`validation_failed` and are scored accordingly (not special-cased).
- **Quality heuristics are coarse** by design (engine is frozen, no judge baked in); the optional
  LLM-judge is the only semantic measure and is sampled, not exhaustive.
- **OPENROUTER_API_KEY absent in sandbox** ⇒ this plan's execution step is performed by the user in an
  authorized environment; the plan + harness + offline tests are complete without it.

## 10. Out of Scope (frozen)

No changes to: prompts, provider HTTP/selection logic, `CANDIDATE_DECISION_JSON_SCHEMA`,
`validateCandidateDecision`, `MemoryPackage` schema, or any `memoryLayer`/`agentContext` code. The
benchmark only consumes the frozen pipeline and writes new harness + report files.
