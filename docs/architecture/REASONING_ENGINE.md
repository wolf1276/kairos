# Reasoning Engine (Phase 1: Foundation, Phase 2: LLM Integration, Phase 3: Decision Intelligence)

The Reasoning Engine is the third layer of the Kairos AI Operating System, sitting on top of the
[Context Layer](./CONTEXT_LAYER.md) and the [Memory Engine](./MEMORY_ENGINE.md). Phase 1 produces
one immutable, deterministic pipeline: given an `AgentContext`, a `MemoryPackage`, and a
`UserPolicy`, assemble a `ReasoningContext`, build a structured `Prompt` from it, and validate a
`CandidateDecision` against a fail-closed schema.

No LLM, prompt execution, trade execution, blockchain interaction, verification, or learning
lives anywhere in this module. It answers *what would a structured decision look like, given
everything known right now?* — never *what should the AI do?* (no provider is invoked in Phase
1) and never *was this decision correct?* (Verification Engine, a later phase).

Code: `backend/src/reasoning/`. Public surface: `backend/src/reasoning/index.ts`.

## Architecture

```
AgentContext  +  MemoryPackage  +  UserPolicy
                     |
                     v
             ReasoningContext (frozen)
                     |
                     v
               Prompt Builder
                     |
                     v
             Prompt (v1 template)
                     |
                     v
           ReasoningProvider (Phase 2 — not implemented)
                     |
                     v
             CandidateDecision
                     |
                     v
              Validation Layer
```

## ReasoningContext

`buildReasoningContext(agentContext, memoryPackage, userPolicy)` (`contextBuilder.ts`) combines
the three inputs into one object and recursively freezes it (`deepFreeze`). No database access,
no HTTP, no provider calls — pure combination. Throws `ReasoningContextError` if any input is
missing or if `agentContext.agentId` doesn't match `memoryPackage.meta.agentId`.

`ReasoningContext.meta.reasoningContextHash` is a SHA-256 over `{ agentId, agentContextHash:
agentContext.meta.contextHash, memoryPackageHash: memoryPackage.meta.packageHash, userPolicy }` —
it trusts the upstream engines' own hashes rather than re-hashing their full content, so a
ReasoningContext hash changes if and only if the underlying AgentContext, MemoryPackage, or
UserPolicy actually changed.

`UserPolicy` is the account owner's outer boundary (risk tolerance, max allocation, allowed
protocols/assets, minimum confidence, objectives) — distinct from `AgentContext.policy`
(`PolicyContextView`), which is the individual agent's own strategy-config-derived rules. Both
flow into the prompt's "Risk Constraints" section.

## Prompt Builder

`buildPrompt(context, templateVersion?)` (`promptBuilder.ts`) is a pure function: it never calls
an LLM or performs I/O. It dispatches to a versioned template (`promptTemplate.ts`) that maps a
`ReasoningContext` to `PromptSections`, then hashes the sections.

Sections: System, Agent Identity, Current Market Context, Managed Capital, Historical
Experience, Detected Patterns, Evidence, Risk Constraints, Allowed Protocols, Objectives,
Required Output Schema.

Determinism: every section is built with `stableStringify` (the same key-sorted serializer the
Context Layer and Memory Engine use for their own hashes), so identical `ReasoningContext` input
always produces byte-identical `Prompt.sections` and `Prompt.promptHash`.

## Prompt templates

Templates are pure `(context: ReasoningContext) => PromptSections` functions registered by
version string in `promptTemplate.ts`. Only `v1` exists today. A future `v2` is added by
registering a new entry — the prompt builder and orchestrator never change.

## Provider abstraction

`interfaces.ts` defines the only contract a future LLM integration implements:

```ts
interface ReasoningProvider {
  readonly name: string;
  generateDecision(context: ReasoningContext, prompt: Prompt): Promise<CandidateDecision>;
}
```

No implementation exists in Phase 1 — no HTTP client, no SDK, no OpenAI/Claude/Gemini/DeepSeek
code. Phase 2 implements this interface in `providers/` (below).

## Phase 2: Providers (`reasoning/providers/`)

```
Prompt
  |
  v
BaseProvider.generateDecision()
  |-- doRequest()            (provider-specific HTTP call — the ONLY per-provider code)
  |-- parseStrictJson()      (fail closed on anything that isn't well-formed JSON)
  |-- normalizeToCandidateDecision()  (stamp decisionId/timestamp/metadata/reasoningHash)
  |-- validateCandidateDecision()     (fail closed — reject, never coerce)
  |-- recordProviderCall()            (latency, tokens, cost, retries -> metrics.ts)
  v
CandidateDecision
```

`BaseProvider` (`baseProvider.ts`) is the only place retry, timeout, parsing, normalization,
validation, and observability are implemented. Each concrete provider —
`OpenAiProvider`, `AnthropicProvider`, `DeepSeekProvider` — implements only `doRequest(prompt,
signal)`: build the provider-native request, call `fetch`, and return `{ raw, usage, requestId,
providerVersion }`. No retry/timeout/JSON-parsing/validation logic is duplicated per provider,
and no provider-specific field (e.g. Anthropic's `tool_use` block, OpenAI's `choices[0]`) escapes
`providers/` — every provider returns the same `CandidateDecision`.

**Structured output.** OpenAI and DeepSeek use Chat Completions with `response_format`
(`json_schema` for OpenAI when `REASONING_STRUCTURED_OUTPUT=true`, `json_object` for DeepSeek,
which has no `json_schema` mode). OpenAI's `json_schema` request always sets `strict: true` —
without it, OpenAI's Structured Outputs treats the schema as an advisory hint rather than an
enforced constraint (confirmed via a live smoke test: a `gpt-4o-mini` call without `strict: true`
returned an out-of-range `allocation` and an extra undeclared property despite
`additionalProperties: false`). Anthropic uses the Messages API with a single tool
(`emit_candidate_decision`) and `tool_choice` forced to that tool, so the model can only respond
via its `input`, never free-form text. All three schemas are generated from one shared JSON
Schema (`schema.ts`, `CANDIDATE_DECISION_JSON_SCHEMA`) covering everything the model is
responsible for (`action` through `uncertainty`) — `decisionId`, `timestamp`, and `metadata` are
always stamped by `providers/`, never the model.

**Normalization.** `parseStrictJson` (`schema.ts`) throws `MalformedDecisionError` on anything
that isn't valid JSON or isn't a plain object — no partial-JSON recovery, no natural-language
fallback. `normalizeToCandidateDecision` builds the full `CandidateDecision` from the model's
JSON plus a freshly stamped `decisionId`/`timestamp`/`metadata`, then computes
`metadata.reasoningHash` via the same `hashCandidateDecision` Phase 1 uses. `validateCandidateDecision`
runs on every normalized decision; a failure raises `ProviderError('validation_failed', ...)`,
which is never retried.

**Provider selection.** `factory.ts::createProvider(config)` looks up a constructor in
`registry.ts`'s `PROVIDER_REGISTRY` map by `config.provider` — the orchestrator and factory never
branch on provider name with an `if`/`switch`; adding a fourth provider means adding one entry to
`registry.ts` and one class, nothing else. `config.ts::getProviderConfigFromEnv()` reads
`REASONING_PROVIDER`, `REASONING_MODEL`, `REASONING_TEMPERATURE`, `REASONING_MAX_TOKENS`,
`REASONING_TIMEOUT_MS`, `REASONING_MAX_RETRIES`, `REASONING_STRUCTURED_OUTPUT`, and
`{PROVIDER}_API_KEY` / `{PROVIDER}_BASE_URL` — every value is configuration, nothing is
hardcoded, and a missing API key for the selected provider throws immediately (fail closed) rather
than falling back silently.

**Retry policy.** `BaseProvider.generateDecision` retries only `ProviderError`s whose `kind` is
`timeout`, `rate_limit`, `network`, `provider_unavailable`, or `empty_response`
(`errors.ts::RETRYABLE`) — up to `config.maxRetries` additional attempts, with exponential backoff
between attempts (`baseProvider.ts::backoffDelayMs`: 250ms base, doubling per attempt, capped at
4000ms, plus up to one base-delay of jitter). `invalid_json` and `validation_failed` are never
retried: a malformed or invalid output is a model/prompt problem retrying can't fix.

The backoff was added during the Phase 2 reliability audit — a live benchmark had shown retries
firing immediately after a 429 almost always hit the same rate limit again, since the upstream
provider's own `retry_after_seconds` was consistently far longer than an instant retry could ever
respect.

**Timeouts.** Every `doRequest` call is wrapped in an `AbortController` set to fire after
`config.timeoutMs`; a request the provider itself doesn't cancel in time surfaces as
`ProviderError('timeout', ...)`, which is retryable.

**Error handling.** All provider failures — HTTP errors, network failures, malformed JSON,
validation failures — are normalized to one `ProviderError` class (`errors.ts`) carrying `kind`,
`provider`, and `retryable`; no raw `fetch`/SDK exception or provider-specific error type crosses
out of `providers/`. HTTP status codes are mapped via `classifyHttpStatus` (401/403 ->
`authentication`, 429 -> `rate_limit`, 404 -> `model_unavailable`, 5xx -> `provider_unavailable`,
otherwise `network`). `sanitize()` strips anything matching an API-key/bearer-token shape out of
every error message before it is thrown or logged — no credential ever reaches a log line.

**Token accounting & cost.** Every successful call captures `promptTokens`/`completionTokens`/
`totalTokens` from the provider's own `usage` field and passes it to `pricing.ts::estimateCost`,
which looks up USD-per-1k-token pricing from a small built-in table (overridable via the
`PROVIDER_PRICING_JSON` env var without a code change) — an unknown provider/model pair costs
`0` rather than guessing.

**Metadata.** `CandidateDecisionMetadata.providerVersion` is stamped as `"{provider}:{model}"`
(e.g. `"openai:gpt-4o-mini"`) by every provider — the only provider-identifying field that
survives into the `CandidateDecision` itself.

**Observability.** `metrics.ts::recordProviderCall` is invoked on every attempt (success or
final failure) and updates an in-memory per-provider aggregate (`calls`, `failures`, `timeouts`,
`retries`, `fallbacks`, cumulative latency/tokens/cost, `lastSelectedAt`), readable via
`getProviderMetrics()`; each call is also emitted as one structured JSON log line
(`component: "reasoning-engine-provider"`). `OpenRouterProvider` additionally emits one
`event: "model_fallback"` log line per abandoned model (with `abandonedModel`, `reason`,
running `fallbackCount`), and the final `fallbackCount` is threaded through
`RawProviderResponse` into the same `provider_call` record — added during the Phase 2
reliability audit, since fallback activity previously had no observable signal at all. No
external monitoring framework, matching Phase 1's approach — this is not wired into
`agentContext/monitor.ts`, which only watches the Context Layer.

**Orchestration.** `orchestrator.ts::runReasoning(agentContext, memoryPackage, userPolicy,
provider)` builds the `ReasoningContext` + `Prompt` (unchanged from Phase 1), calls
`provider.generateDecision(context, prompt)`, and validates the result — the only new
orchestration entry point; `buildReasoningRequest`/`validateDecision` from Phase 1 are untouched
and still used internally.

## Configuration reference (Phase 2)

| Env var | Purpose | Default |
| --- | --- | --- |
| `REASONING_PROVIDER` | `openrouter` \| `openai` \| `anthropic` \| `deepseek` \| `nvidia` | `openrouter` |
| `REASONING_MODEL` | Model name for the selected provider (`auto` or unset for OpenRouter — see below) | provider-specific |
| `REASONING_TEMPERATURE` | Sampling temperature | `0.2` |
| `REASONING_MAX_TOKENS` | Max completion tokens | `2000` |
| `REASONING_TIMEOUT_MS` | Per-attempt timeout | `30000` |
| `REASONING_MAX_RETRIES` | Additional attempts after transient failures | `2` |
| `REASONING_STRUCTURED_OUTPUT` | Use `json_schema` mode where supported (OpenAI, OpenRouter, NVIDIA) | `true` |
| `{PROVIDER}_API_KEY` | e.g. `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `NVIDIA_API_KEY` | required |
| `OPENROUTER` | Accepted as a fallback for `OPENROUTER_API_KEY` (common naming in practice) | — |
| `{PROVIDER}_BASE_URL` | Override the default API base URL | provider default |
| `PROVIDER_PRICING_JSON` | Override/extend the built-in cost-per-1k-token table | none |

## OpenRouter provider — free models only (`providers/openrouterProvider.ts`)

OpenRouter is the default provider specifically because it is the only one that requires no
OpenAI/Anthropic/DeepSeek/Gemini key — one `OPENROUTER_API_KEY` (or `OPENROUTER`) is enough. It
reuses the same OpenAI-compatible request path as `OpenAiProvider`
(`providers/openAiCompatible.ts`, factored out for this reason) pointed at
`https://openrouter.ai/api/v1`, plus a free-model registry and fallback chain layered in
`doRequest()`.

**No hardcoded model list.** `providers/openrouterModelRegistry.ts::fetchOpenRouterModelRegistry`
calls OpenRouter's own `GET /models` endpoint and classifies every returned model as free or paid
from its live `pricing` field (`prompt === 0 && completion === 0`; the `:free` id suffix is only
a fallback signal for entries with a missing/malformed pricing block). Nothing in this codebase
names a specific "current" free model — that list can change at any time, and this engine never
assumes yesterday's free model is still free (or still exists) today. The registry response is
cached in memory for 5 minutes (`REGISTRY_TTL_MS`) to avoid a `/models` round trip on every
reasoning request; `resetOpenRouterRegistryCache()` clears it (used by tests). Concurrent callers
that all miss a cold/expired cache share one in-flight fetch rather than each firing their own
request (`fetchOpenRouterModelRegistry`'s `inflight` promise) — found during the Phase 2
reliability audit's 250-way concurrency stress test, which would otherwise thundering-herd the
very endpoint whose rate limits the fallback chain exists to respect.

**Default model resolution.** `REASONING_MODEL` unset or set to the sentinel `auto`
(`OPENROUTER_AUTO_MODEL`) means "resolve a free model at request time" — the provider queries
`getFreeModelIds()` and uses the whole (deterministically sorted) list as the fallback order.

**Fallback order.** `resolveCandidateModels()` in `openrouterProvider.ts` builds the candidate
list per request:
1. If `REASONING_MODEL` names a specific model AND the registry currently classifies it as free,
   it is tried first, followed by every other free model (registry order) as fallback.
2. If `REASONING_MODEL` is unset/`auto`, or names a model the registry does **not** currently
   classify as free (paid, unknown, or unverifiable because the registry call itself failed),
   the configured model is dropped entirely and every free model is tried in registry order.
3. `doRequest()` tries each candidate in turn (capped at `MAX_FALLBACK_ATTEMPTS = 8` — free
   models are rate-limited fairly often in practice). Three error kinds advance to the next
   candidate rather than failing the request: `model_unavailable` (HTTP 404 or any
   model-not-found response — a decommissioned free model), `rate_limit` (a live smoke test found
   OpenRouter's free-tier rate limits are per-model/shared-upstream-capacity, so a 429 on one
   free model says nothing about the next one), and `empty_response` (a live smoke test found
   some free-priced catalog entries aren't actually chat-capable, e.g. audio/image models, which
   return no completion content for a chat request). Any other error kind (auth, network,
   timeout) is NOT model-fallback territory — it propagates immediately so `BaseProvider`'s own
   retry loop (transient-failure retries, see Retry policy above) handles it the same way it does
   for every other provider.
4. If every candidate is exhausted, the last error is thrown. If the registry itself contains
   zero free models, or the `/models` call itself fails, the request fails closed with
   `provider_unavailable` before any chat-completion call is attempted — a paid model is never
   used as a silent fallback, under any circumstance.

**Never a paid model.** The only path to a paid model id ever reaching a request is a user
explicitly setting `REASONING_MODEL` to it — and `resolveCandidateModels()` explicitly checks
`isModelFree()` first and drops it (falling back to the free list) if it is not confirmed free.
An unknown/unlisted model is treated as **not** free (fail closed), never assumed free.

## NVIDIA provider (`providers/nvidiaProvider.ts`)

NVIDIA's hosted inference API (`https://integrate.api.nvidia.com/v1`) is also OpenAI-compatible,
so `NvidiaProvider` is a thin wrapper around the same `requestOpenAiCompatibleChatCompletion`
helper used by `OpenAiProvider` and `OpenRouterProvider` — only the base URL and default model
(`z-ai/glm-5.2`) differ, and `strict: true` structured output was confirmed live to work against
it. Unlike OpenRouter, NVIDIA has no free-model registry or fallback chain here — it's configured
like `openai`/`anthropic`/`deepseek`: set `REASONING_PROVIDER=nvidia`, `NVIDIA_API_KEY`, and
optionally `REASONING_MODEL` to any NVIDIA-hosted model id.

## Security (Phase 2)

API keys are read from env only, passed to `fetch` as request headers, and never logged.
`sanitize()` (`errors.ts`) strips API-key- and bearer-token-shaped substrings from every error
message. No wallet information or user PII is included in any prompt section beyond what Phase 1
already assembles from `AgentContext`/`MemoryPackage`/`UserPolicy`.

## Testing (Phase 2)

`backend/src/__tests__/reasoningProviders.test.ts` mocks `fetch` (never calls a real provider)
and covers: per-provider normalization into an identical `CandidateDecision` shape; HTTP error ->
`ProviderError.kind` mapping (401/403/429/5xx); malformed-JSON and validation-failure paths never
retrying; timeout via `AbortController`; retry-then-succeed and retry-exhaustion; token/cost
accounting in `metrics.ts`; API-key sanitization in error messages; factory/registry selection;
10/50/100-way concurrent request isolation (no shared mutable state — each `decisionId` is
unique); and a latency benchmark (avg/P95/P99).

The `describe('OpenRouter provider')` block additionally mocks the `/models` registry endpoint
and covers: free-model selection when `REASONING_MODEL=auto`; `getFreeModelIds`/`isModelFree`
classification purely from pricing; a configured paid model being dropped in favor of the free
list; a configured free model being used as-is; single-hop fallback when the first free model
404s; full failover across every free model (asserting none of the attempted models were paid)
before raising `model_unavailable`; a 429 or empty completion also falling over to the next free
model instead of retrying itself; fail-closed `provider_unavailable` when the registry itself
returns no free models or is unreachable; and factory registration of `openrouter`.

The `describe('NVIDIA provider')` block covers normalization, `strict: true` on the structured
output request, the NVIDIA base URL being used, and error mapping — the same shape of coverage as
`OpenAiProvider`.

One-off manual live smoke tests (not part of the committed suite) confirmed the pipeline against
a real OpenRouter-routed `gpt-4o-mini` call and a real NVIDIA `z-ai/glm-5.2` call — see the Phase
2 production smoke test report for findings (the `strict: true` fix, and the `rate_limit`/
`empty_response` fallback fixes, were discovered this way).

## Explicitly out of scope for Phase 2

The Verification Engine, an Execution Planner, blockchain execution, learning/reinforcement
learning, and any change to the Context Layer, Memory Engine, or Reasoning Foundation (Phase 1)
architecture. Phase 2 only connects providers to the existing pipeline.

## Phase 3: Decision Intelligence (`reasoning/decisionIntelligence/`)

Phase 3 teaches the engine to produce a much richer decision analysis — a primary decision,
2-3 alternatives, a cited reasoning chain, typed evidence, risk assessment, explicit assumptions,
an uncertainty assessment, a qualitative expected outcome, per-section confidence, and a summary.
No execution, no blockchain interaction, no memory writes, no learning.

**Why this is a separate module, not an extension of CandidateDecision.** Decision Intelligence's
primary action vocabulary — `HOLD`, `DEPOSIT`, `WITHDRAW`, `SWAP`, `REBALANCE` — is different from
`CandidateAction` (`open`/`close`/`increase`/`decrease`/`hold`/`rebalance`). The frozen provider
layer's structured-output request (`providers/schema.ts::CANDIDATE_DECISION_JSON_SCHEMA`) hardcodes
the *old* action enum directly into the JSON Schema sent to the model in `strict` mode — the model
structurally cannot emit `DEPOSIT`/`WITHDRAW`/`SWAP` through that pipeline no matter what prompt
text asks for it, and `BaseProvider.generateDecision` unconditionally normalizes and validates
against `CandidateDecision`'s schema regardless of any input. Extending `CandidateAction` in
`reasoning/types.ts` would not fix this, because the *provider layer* (frozen this phase) is what
actually constrains the model's output. Decision Intelligence therefore has its own request
pipeline that never calls `BaseProvider.generateDecision`/`doRequest` — nothing in `providers/` is
modified, imported-and-modified, or forked; only pure reads of already-exported configuration and
error-classification utilities.

**Architecture:**

```
ReasoningContext (built exactly as Phase 1 — AgentContext + MemoryPackage + UserPolicy)
  |
  v
buildPrompt(context, 'v2')        (promptTemplate.ts — new template version, same section data
  |                                as v1 except `system`/`outputSchema` text)
  v
generateDecisionIntelligence(context, prompt, config)   (decisionIntelligence/orchestrator.ts)
  |-- requestDecisionIntelligenceCompletion()  (own HTTP call — DECISION_INTELLIGENCE_JSON_SCHEMA,
  |                                             strict:true; reuses ProviderError/classifyHttpStatus
  |                                             from providers/errors.ts, read-only)
  |-- parseStrictJson()             (fail closed on anything that isn't well-formed JSON)
  |-- normalizeToDecisionIntelligence()  (stamp decisionId/timestamp/metadata/decisionHash)
  |-- validateDecisionIntelligence() (fail closed — reject, never coerce)
  |-- recordDecisionIntelligenceCall()  (observability -> decisionIntelligence/metrics.ts)
  v
DecisionIntelligence
```

Retry/backoff mirrors `providers/baseProvider.ts`'s pattern (same constants: 250ms base, doubling,
4000ms cap, plus jitter) but is a separate implementation in `orchestrator.ts` — intentionally, since
`BaseProvider.generateDecision` cannot be reused without inheriting its `CandidateDecision`-specific
normalization/validation. `providers/` itself has zero new files and zero edits for Phase 3.

## Decision schema

`DecisionIntelligence` (`decisionIntelligence/types.ts`):

- **`primaryDecision`**: `{ action, protocol, asset, allocation, confidence }`. `action` is one of
  `HOLD`, `DEPOSIT`, `WITHDRAW`, `SWAP`, `REBALANCE` — no other value is structurally producible
  (enforced by the JSON Schema's `enum` + `strict: true`) or accepted (enforced again by
  `validateDecisionIntelligence`, defense in depth against a provider that ignores `strict` mode).
- **`alternatives`**: 2-3 items, each `{ action, protocol, asset, allocation, confidence, tradeoffs }`.
  Fewer than 2 or more than 3 fails validation.
- **`reasoningChain`**: ordered `{ step, evidenceRefs }` — every step must cite at least one index
  into `evidence[]`; an empty `evidenceRefs` or an out-of-bounds index both fail validation (see
  Evidence architecture below).
- **`evidence`**: typed `{ type, source, detail, weight }` items — see Evidence architecture.
- **`risks`**: `{ description, probability, severity, mitigation }`.
- **`assumptions`**: non-empty `string[]` — "no hidden assumptions" is enforced as "at least one
  assumption must be stated", not merely "the field must exist".
- **`uncertainty`**: `{ missingInformation, conflictingEvidence, lowConfidenceSignals, score }` — the
  arrays may be empty (nothing missing/conflicting/low-confidence is a valid state), but the object
  itself and `score` are required.
- **`expectedOutcome`**: `{ direction, expectedBenefit, expectedDownside }` — `direction` is one of
  `up`/`down`/`flat`/`uncertain`; `expectedBenefit`/`expectedDownside` are deliberately typed as
  free-text strings, never numeric fields, so the schema itself makes fabricating a precise return
  percentage or price target impossible.
- **`confidence`**: see Confidence architecture below.
- **`summary`**: a concise free-text string.
- **`metadata`**: see Metadata below.

## Evidence architecture

Every `evidence[]` item is typed as one of five canonical kinds
(`decisionIntelligence/types.ts::EVIDENCE_TYPES`): `market_indicator`, `historical_statistic`,
`historical_pattern`, `historical_conflict`, `policy_rule` — corresponding directly to the prompt
sections the model was given (market context, memory episodic/semantic data, risk constraints).
`reasoningChain[].evidenceRefs` are integer indices into this array; `validateDecisionIntelligence`
rejects:

- an empty `evidence[]` array (nothing to cite at all),
- a reasoning step with no `evidenceRefs` (an uncited conclusion),
- an `evidenceRefs` index that doesn't resolve to a real `evidence[]` entry (a "broken reference" —
  the model citing evidence it never actually provided, i.e. a hallucinated citation), and
- duplicate evidence entries (same `source`+`detail` pair twice), same pattern as Phase 1's
  `supportingEvidence` duplicate check.

This is the concrete mechanism behind "every reasoning step must cite evidence" and "never invent
facts" — the model's own reasoning chain is checked for referential integrity against its own
evidence list, not just checked for the right shape.

## Confidence architecture

`confidence.overall` is a single `[0,1]` figure; `confidence.perSection` breaks it down across the
five sections that most benefit from independent confidence (`primaryDecision`, `alternatives`,
`evidence`, `risk`, `expectedOutcome`) — a model can be very confident in its market read but much
less confident in its risk assessment, and this schema lets that show up explicitly rather than
being averaged away into one number. Every one of the six confidence values (`overall` + 5
per-section) is independently validated as a finite number in `[0,1]`, rejecting `NaN`/`Infinity`
exactly like Phase 1's `CandidateDecision.confidence` check.

## Alternative generation

The prompt (`v2` template's `outputSchema` section) explicitly asks for 2-3 alternatives, each with
its own `tradeoffs` field — a plain-text explanation of what is given up relative to the primary
decision (e.g. "more upside, more risk"). `validateDecisionIntelligence` enforces the 2-3 count
range and requires every alternative to carry a non-empty `tradeoffs` string, so a degenerate
alternative that's just a copy of the primary decision with no stated tradeoff fails validation
shape-wise (though not semantically — judging whether a stated tradeoff is *meaningful* is a
reasoning-quality concern, not a schema concern, and stays out of scope for validation).

## Risk model

`risks[]` items require `probability` (`[0,1]`, distinct from `confidence` — how likely the risk
is to materialize, not how confident the model is in the decision), `severity`
(`low`/`medium`/`high`), and `mitigation` (what would reduce the risk, not just a description of
it). An empty `risks` array is permitted (a genuinely low-risk decision can have none), but any
risk present must be complete.

## Validation

`validateDecisionIntelligence(decision, { allowed?, maxAllocationPct? })`
(`decisionIntelligence/validation.ts`) is fail-closed, same contract as Phase 1/2's
`validateCandidateDecision`. Beyond shape/range checks on every field above, it enforces:

- **Policy compliance**: `primaryDecision`/each alternative's `protocol`/`asset` must be in the
  `AllowedPolicy` intersection (`deriveAllowedPolicy(context)`, reused unchanged from
  `reasoning/validation.ts`) — an unsupported protocol or asset anywhere in the decision fails
  validation, not just in the primary action.
- **Allocation limits**: `allocation` (primary or any alternative) must not exceed
  `context.userPolicy.maxAllocationPct / 100` — a new check Phase 3 adds that Phase 1/2 never
  enforced (Phase 1/2's `validateCandidateDecision` checks `allocation` is in `[0,1]` but never
  against the user's actual ceiling).
- **Metadata integrity**: `metadata.decisionHash` must match a fresh
  `hashDecisionIntelligence(decision)` recomputation (`decisionIntelligence/hashing.ts`), same
  tamper-detection technique as Phase 1's `reasoningHash` check.

A missing required object (`uncertainty`, `expectedOutcome`, `confidence`) is rejected rather than
defaulted — `normalize.ts` deliberately does not fill in a synthetic default for any of these; only
array-typed fields default to `[]` when absent (which validation's non-empty/range checks still
correctly reject where required, e.g. an absent `evidence` array and an explicitly empty one both
fail the same "non-empty array" check).

## Metadata

`DecisionIntelligenceMetadata` extends what Phase 1/2 track: `reasoningVersion`, `decisionVersion`
(both `DECISION_INTELLIGENCE_SCHEMA_VERSION`), `promptVersion` (`v2`), `providerVersion`
(`{provider}:{model}`), `reasoningDurationMs`, `evidenceCount`, `alternativeCount`,
`uncertaintyScore` (mirrors `decision.uncertainty.score`), `decisionHash`, `promptHash`.

## Observability

`decisionIntelligence/metrics.ts::recordDecisionIntelligenceCall` — parallel to (not a modification
of) `providers/metrics.ts` — tracks per `provider:model`: `calls`, `failures`, cumulative
`reasoningDurationMs`/`validationDurationMs`/`providerLatencyMs`, token totals, retry totals, and
last-seen confidence; emits one structured JSON log line per call
(`component: "reasoning-engine-decision-intelligence"`) with reasoning duration, validation
duration, confidence, alternative count, evidence count, uncertainty score, token usage, and
provider latency.

## Testing (Phase 3)

`backend/src/__tests__/decisionIntelligence.test.ts` (32 tests, mocked `fetch`) covers: `v2` prompt
determinism and its divergence from `v1` (same context sections, different `system`/`outputSchema`);
end-to-end generation with correct metadata stamping and `strict: true` structured output; policy/
protocol awareness (unsupported protocol/asset, allocation-ceiling violation, in-range acceptance);
alternative-count enforcement (2, 3, 1, and 4 alternatives); evidence integrity (uncited step, broken
reference, duplicate evidence, invalid evidence type, empty evidence array); confidence bounds
(`NaN`, `Infinity`, out-of-range); malformed output (markdown-fenced JSON, invalid action, tampered
`decisionHash`); conflicting-evidence/uncertainty handling (accepts a decision that explicitly
surfaces conflict and higher uncertainty; rejects missing `uncertainty`/`expectedOutcome`/empty
`assumptions`); and 10/50/100-way concurrent generation with unique `decisionId`s and correct
per-request `promptHash` attribution.

## Explicitly out of scope for Phase 3

The Verification Engine, an Execution Planner, blockchain execution, learning/reinforcement
learning, memory writes, and any change to the Context Layer, Memory Engine, or the LLM provider
layer (`providers/`). Phase 3 only adds a decision-quality layer on top of the existing pipeline.

## CandidateDecision

An immutable, structured proposal — never an execution instruction. Fields: `decisionId`,
`timestamp`, `action` (`open`/`close`/`increase`/`decrease`/`hold`/`rebalance`), `protocol`,
`asset`, `allocation` (fraction of managed capital, `[0,1]`), `confidence` (`[0,1]`),
`reasoning`, `supportingEvidence`, `risks`, `assumptions`, `alternatives`, `uncertainty`
(`[0,1]`), `metadata`. No execution fields (no signer, no transaction, no route) — a Verification
Engine reviews this before anything is acted on.

## Validation

`validateCandidateDecision(decision, allowed?)` (`validation.ts`) fails closed: it never guesses
or coerces, only accepts or rejects with a list of reasons. Checks every required field's
presence and type, `allocation`/`confidence`/`uncertainty` are finite numbers in `[0,1]`
(rejecting `NaN` and `Infinity` explicitly), `action`/`alternatives[].action` are valid enum
values, `supportingEvidence` is non-empty with no duplicate `source`+`detail` pairs,
`risks[].severity` is valid, and — critically — that `metadata.reasoningHash` matches a fresh
`hashCandidateDecision(decision)` recomputation, so a tampered or hand-edited decision is
rejected even if every field individually looks well-formed.

The optional second parameter, `allowed: { allowedProtocols, allowedAssets }` (produced by
`deriveAllowedPolicy(context)`), rejects a decision whose `protocol`/`asset` falls outside the
**intersection** of `AgentContext.policy` and `UserPolicy` — either boundary can veto. It is
optional so shape-only validation (replay/audit tooling with no live `ReasoningContext`) still
works, but every production call site (`providers/baseProvider.ts`,
`orchestrator.ts::validateDecision`/`runReasoning`) always supplies it. (Added during the Phase 2
production smoke test: `validateCandidateDecision` previously only checked that `protocol`/
`asset` were non-empty strings, so a decision proposing an unsupported protocol or asset would
have passed validation.)

## Hashing

`hashing.ts` uses the same SHA-256-over-`stableStringify` technique as the Context Layer and
Memory Engine:

- `hashReasoningContext(canonical)` — over a caller-supplied canonical object (used by
  `contextBuilder.ts`, which excludes `timestamp`/`contextId` before hashing).
- `hashPromptSections(sections)` — over `Prompt.sections`.
- `hashCandidateDecision(decision)` — over the decision with `decisionId`, `timestamp`,
  `metadata.buildDurationMs`, and `metadata.reasoningHash` itself excluded, so a decision replayed
  from the same `ReasoningContext` + `Prompt` (by a real provider in Phase 2) hashes identically
  to the original regardless of when it was produced or what id it was assigned.

## Replay & determinism

Given the same `AgentContext`, `MemoryPackage`, and `UserPolicy`:

- `buildReasoningContext` produces the same `reasoningContextHash` every time.
- `buildPrompt` produces byte-identical `sections` and the same `promptHash` every time.
- `hashCandidateDecision` produces the same hash for two decisions that differ only in
  `decisionId`/`timestamp`/`buildDurationMs`.

This holds under concurrency — 10/50/100 concurrent builds from the same inputs all converge on
the same hash (see `backend/src/__tests__/reasoningEngine.test.ts`).

## Extension points

- **New prompt template version**: add an entry to the `TEMPLATES` map in `promptTemplate.ts`.
  No change to `promptBuilder.ts` or `orchestrator.ts`.
- **New LLM provider (Phase 2)**: implement `ReasoningProvider` from `interfaces.ts`. The
  orchestrator will invoke it with the already-built `ReasoningContext` + `Prompt`; no change to
  context assembly, prompt building, or validation.
- **New CandidateDecision field**: extend `types.ts`, then extend `validation.ts`'s checks and
  bump `REASONING_ENGINE_SCHEMA_VERSION`.

## Observability

Structured JSON logs only (no monitoring framework) via `orchestrator.ts`: `context_assembly`,
`prompt_generation`, and `validation` events, each with a `durationMs` field and relevant hashes/
ids. Suitable for pipe-to-log-aggregator; not wired to `monitor.ts` (the Context Layer's health
monitoring module) since the Reasoning Engine invokes no external system to be unhealthy about
yet.

## Explicitly out of scope for Phase 1

OpenAI/Claude/Gemini/DeepSeek or any other LLM call, prompt execution, trade execution,
blockchain interaction, the Verification Engine, learning, and reinforcement learning. These are
later phases built on top of this foundation, never inside it.
