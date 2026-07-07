# Reasoning Engine (Phase 1: Foundation, Phase 2: LLM Integration, Phase 3: Decision Intelligence, Phase 4: Decision Verification, Phase 5: Execution Planner, Phase 6: Execution Engine)

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

`backend/src/__tests__/decisionIntelligence.test.ts` (35 tests, mocked `fetch`) covers: `v2` prompt
determinism and its divergence from `v1` (same context sections, different `system`/`outputSchema`);
end-to-end generation with correct metadata stamping and `strict: true` structured output; policy/
protocol awareness (unsupported protocol/asset, allocation-ceiling violation, in-range acceptance);
alternative-count enforcement (2, 3, 1, and 4 alternatives); evidence integrity (uncited step, broken
reference, duplicate evidence, invalid evidence type, empty evidence array); confidence bounds
(`NaN`, `Infinity`, out-of-range); malformed output (markdown-fenced JSON, invalid action, tampered
`decisionHash`, max_tokens truncation detection); provider error classification (HTTP 402 mapped to
non-retryable `authentication`, not `network`); conflicting-evidence/uncertainty handling (accepts a
decision that explicitly surfaces conflict and higher uncertainty; rejects missing `uncertainty`/
`expectedOutcome`/empty `assumptions`); and 10/50/100-way concurrent generation with unique
`decisionId`s and correct per-request `promptHash` attribution.

**Provider support.** `requestClient.ts` supports every `providers/types.ts::ProviderName` plus
`huggingface` (Hugging Face's OpenAI-compatible router, `https://router.huggingface.co/v1`) via a
locally-typed `DecisionIntelligenceProviderName` — added without touching `providers/types.ts`,
since Hugging Face is not and will never be a provider in the frozen LLM provider layer.

**Live smoke test findings (Phase 3 production smoke test).** Two real bugs found against NVIDIA
`z-ai/glm-5.2` and Hugging Face `meta-llama/Llama-3.1-8B-Instruct`, both fixed in `requestClient.ts`:
1. `maxTokens: 2000` truncated NVIDIA's response mid-JSON (Decision Intelligence's schema is far
   larger than CandidateDecision's) — the resulting `invalid_json` error was indistinguishable from
   genuine model malformation. Fixed by checking `finish_reason === 'length'` and raising a specific,
   actionable error.
2. A depleted Hugging Face credit balance returned HTTP 402, which `classifyHttpStatus`
   (`providers/errors.ts`, frozen) has no case for and falls back to `network` — retryable, wrong for
   a billing failure. Fixed locally (not in `providers/`) by mapping 402 to `authentication`.

Live testing also confirmed the Phase 3 allocation-ceiling check works correctly against a real
model: at a 25% policy ceiling, `z-ai/glm-5.2` consistently proposed larger allocations (its
market-driven sizing overriding the stated limit) and every instance was correctly rejected; at a
60% ceiling the same model produced a fully valid, well-reasoned decision (15 evidence items, 3
differentiated alternatives, non-trivial uncertainty with genuine conflicting-evidence entries).
This is a real prompt-adherence characteristic of the model, not a code defect — worth knowing
before choosing a production default and policy ceiling together.

## Explicitly out of scope for Phase 3

The Verification Engine, an Execution Planner, blockchain execution, learning/reinforcement
learning, memory writes, and any change to the Context Layer, Memory Engine, or the LLM provider
layer (`providers/`). Phase 3 only adds a decision-quality layer on top of the existing pipeline.

## Phase 4: Decision Verification (`reasoning/verification/`)

Phase 4 is a deterministic, rule-based gate between a `DecisionIntelligence` (Phase 3) and
anything that would act on it (a future Execution Planner — not built yet). **No AI, no LLM call,
no execution, no memory write** — every rule is a pure function of `(decision, context)` (plus an
injectable clock for staleness checks), so identical inputs always produce an identical
`VerificationResult`, byte-for-byte, including its hash.

```
DecisionIntelligence + ReasoningContext (AgentContext + MemoryPackage + UserPolicy)
        |
        v
  Schema  (hard gate — reuses validateDecisionIntelligence, shape/enum/range/hash only)
        |  (fails closed here -> reject immediately, no later stage runs)
        v
  Policy -> Capital -> Protocol -> Market -> Portfolio -> Evidence -> Consistency -> Risk -> Execution Feasibility
        |
        v
  VerificationResult: VerifiedDecision | RejectedDecision
```

**Why Schema is a hard gate and nothing else is.** A structurally invalid `DecisionIntelligence`
can't be safely read by later stages — `capital.ts` reading `.primaryDecision.allocation` on a
malformed object would throw, not fail gracefully. So Schema failing short-circuits the pipeline
(`stagesRun: ['schema']`, nothing else evaluated). Every other stage always runs to completion —
even if Policy already failed, Capital/Protocol/Market/etc still execute — because
`passedRules`/`failedRules`/`warnings` are meant to give a *complete* diagnostic picture, the same
philosophy as Phase 1's `validateCandidateDecision` returning every error, not just the first.

## Rule engine

Each stage lives in its own file under `reasoning/verification/rules/`, exporting a pure
`runXRules(decision, context) -> RuleResult[]`. A `RuleResult` is `{ rule, stage, passed, severity,
message }` — `rule` is a stable, namespaced id (e.g. `policy.allocation_ceiling`,
`risk.tolerance_alignment`) that tooling/dashboards can key off across runs. `severity` is
`'error'` (blocks verification) or `'warning'` (surfaced but non-blocking, e.g. an alternative
with a policy issue when the primary decision itself is compliant).

| Stage | Rules |
| --- | --- |
| `schema` | Reuses `validateDecisionIntelligence` (Phase 3, unmodified) — required fields, enums, allocation/confidence ranges, evidence references, `decisionHash` |
| `policy` | Protocol/asset in the `deriveAllowedPolicy` intersection (Phase 1, unmodified), allocation ceiling, objectives present, delegation active, confidence meets policy minimum, alternatives compliant |
| `capital` | No negative balances (all three balances must be finite — `NaN`/`Infinity` rejected, not just `>= 0`), requested capital within deployable capital, requested capital within total managed capital |
| `protocol` | Protocol execution enabled, action is one of the 5 canonical actions, requested capital within the agent's own position limit |
| `market` | Oracle healthy, oracle not stale (`ageSeconds <= 300`), `AgentContext` not stale (`builtAt` within 5 minutes), volatility within a 50% hard ceiling |
| `portfolio` | Concentration limit (80%), diversification (informational), no duplicate `(action, protocol, asset, allocation)` tuples across primary + alternatives |
| `evidence` | Non-empty evidence, canonical evidence types, every reasoning step's `evidenceRefs` resolve (no broken/hallucinated references), no duplicate evidence |
| `consistency` | Overall confidence aligns with the per-section average, low confidence never pairs with a large allocation, high uncertainty never pairs with zero identified risks, bullish outcome never pairs with WITHDRAW and bearish outcome never pairs with DEPOSIT |
| `risk` | Allocation within a risk-tolerance-tiered ceiling (low/medium/high), drawdown within 30%, risk-domain volatility within 50%, requested capital within a liquidity-safe fraction of recent volume (all capital/volume inputs required finite — `Infinity` is rejected, never treated as "unlimited") |
| `execution_feasibility` | System/scheduler/execution-subsystem ready, no active cooldown, recent-failure count below threshold, wallet delegation active — all skipped for `HOLD` (nothing to execute) |

All thresholds (position limits, staleness windows, risk-tolerance ceilings, etc.) are named
exported constants at the top of their rule file — tune them there, not inline.

## Output: VerifiedDecision | RejectedDecision

Both share `VerificationReportBase`: `passedRules`, `failedRules`, `warnings`, `verificationHash`,
`verificationVersion`, `verifiedAt`, `stagesRun`, `ruleResults` (the full list, for anyone who
wants more than the rule-id summary). `RejectedDecision` adds `rejectionStage` — the first stage
(in pipeline order) that produced an error-severity failure, for fast triage.

## Replay & determinism

`verifyDecision(decision, context, { now })` never reads the real clock unless `now` is omitted —
tests always pass a fixed `now` and get byte-identical results (including `verificationHash`)
across any number of repeated calls. `hashVerification` (`verification/hashing.ts`) hashes
`{ decisionHash, ruleResults, verificationVersion }` — the same `sha256`-over-`stableStringify`
technique used everywhere else in the Reasoning Engine — explicitly excluding `verifiedAt` (the
only wall-clock field) so re-running verification on an unchanged decision always reproduces the
same hash, the same replay guarantee Phase 1's `hashCandidateDecision` and Phase 3's
`hashDecisionIntelligence` provide.

## Testing (Phase 4)

`backend/src/__tests__/decisionVerification.test.ts` (43 tests) covers: valid decisions; malformed
decisions (invalid action, NaN confidence, wrong alternative count, undefined `primaryDecision`)
all short-circuiting at `schema`; every named policy violation (protocol, asset, allocation
ceiling, minimum confidence, delegation inactive); insufficient/negative capital; protocol
restrictions (execution disabled, position-limit overflow); stale market data (unhealthy oracle,
stale oracle, stale context, excess volatility); evidence integrity (broken reference, duplicate
evidence); consistency violations (low-confidence/high-allocation pairing, high-uncertainty/
zero-risk pairing); risk violations (tolerance ceiling, drawdown, liquidity); execution
infeasibility (system not ready, active cooldown) and `HOLD`'s exemption from those checks; a
tampered `decisionHash` (rejected at `schema`); five explicit bypass attempts (all correctly fail —
including one that caught a real gap: `policy.alternatives_compliant` originally checked only
protocol/asset, not the allocation ceiling, for alternatives — fixed during test-writing);
determinism (byte-identical repeated output, hash changes only when a rule outcome changes); and
10/50/100/250-way "parallel" verification (verification is synchronous, so this is sequential
repeated calls, not concurrent I/O — the point is proving determinism and isolation at each scale,
not testing an async race).

**Final production audit** (`backend/src/__tests__/decisionVerificationFinalAudit.test.ts`, 76
tests) re-tested every category above plus schema edge cases (extra fields, null/undefined
values), 500x replay, 10/50/100/250/500-way concurrency including 500 distinct decisions run
through `Promise.all` with zero cross-contamination, 8 explicit security bypass attempts (forged
hash, modified evidence, modified policy, allocation/protocol/rule bypass, malformed types, replay
attack), and a performance pass (sub-5ms average, all synchronous). Found and fixed 3 real bugs:

1. **Missing rule**: nothing checked "bullish outcome + WITHDRAW" / "bearish outcome + DEPOSIT" —
   added `consistency.outcome_matches_action`.
2. **Overflow bypass**: `Infinity` on both `totalManagedCapital` and `deployableCapital` passed
   `capital.no_negative_balances` (`Infinity >= 0`) and made `capital.available_capital` vacuously
   true (`Infinity <= Infinity`) — fixed with explicit `Number.isFinite` guards on all three
   capital balances.
3. **Liquidity bypass**: `Infinity` `recentVolume` made `requestedCapital / Infinity = 0`, passing
   `risk.liquidity_sufficient` regardless of trade size — fixed with an explicit
   `Number.isFinite(recentVolume)` guard.

## Explicitly out of scope for Phase 4

An Execution Planner (the natural next consumer of `VerifiedDecision`), blockchain execution,
memory writes, learning, and any change to the Context Layer, Memory Engine, LLM provider layer,
Benchmark Framework, Decision Intelligence, or prompts. Phase 4 only adds a deterministic gate
between Decision Intelligence and anything that would act on its output.

## Phase 5: Execution Planner (`reasoning/executionPlanner/`)

Turns a `VerifiedDecision` (Phase 4) + `ReasoningContext` into an `ExecutionPlan` — an ordered,
hashable, replayable description of what *would* be executed. **No AI, no LLM, no blockchain
call** — this only builds a plan; a future Execution Engine (not built here) would consume it and
actually call a protocol.

```
VerifiedDecision (status must be 'verified' — a RejectedDecision throws immediately)
        |
        v
runPrerequisiteChecks()   supported_protocol, supported_action, asset_exists,
        |                 balances_non_negative, balances_sufficient — re-derived independently
        |                 from the CURRENT context, never trusting the decision's own
        |                 verification-time snapshot (capital can move between verify and plan)
        v  (any failure -> throw ExecutionPlanValidationError, fail closed)
buildSteps()              prerequisite_check -> simulate -> execute -> confirm (HOLD: single
        |                 no_op step, nothing to execute)
        v
topologicalSort()         deterministic ordering + circular/missing-dependency detection
        |
        v
estimateFee/Slippage/BalanceChanges/StateChanges()   arithmetic only, no oracle/simulation call
        |
        v
hashExecutionPlan()  ->  deepFreeze()  ->  ExecutionPlan
```

**Why the planner re-runs its own prerequisite checks instead of trusting Phase 4's verdict.**
`VerifiedDecision` proves the decision was compliant *at verification time*. Capital, protocol
availability, and allowed assets can all change between verification and planning (a concurrent
trade spending capital, a protocol being disabled). The planner treats the `context` it's handed
as the current source of truth and re-derives every check from it — `deriveAllowedPolicy`
(Phase 1, reused unmodified) for protocol/asset, and the same `Number.isFinite` + non-negative
balance pattern Phase 4's capital stage uses for capital.

**Step template.** Every non-`HOLD` action produces the same 4-step chain: `prerequisite_check`
(no capital moved) → `simulate` (a `SimulationRequest` is generated here, describing what a
dry-run would need — protocol/action/asset/amount — never an actual call) → `execute` (the only
step that moves capital) → `confirm`. Each step `dependsOn` the previous, so `dependencies` is
always a simple chain — `topologicalSort` (`executionPlanner/dependencyGraph.ts`) is still run
and validated on every build (Kahn's algorithm with an alphabetical tie-break for determinism),
both as defense-in-depth and because it's independently unit-tested against synthetic cyclic/
self-referencing/missing-dependency graphs to prove circular-dependency detection actually works,
not just "never observed to fail."

**Rollback strategy.** One `RollbackStep` per `execute` step, describing the compensating reverse
action (DEPOSIT↔WITHDRAW, or restoring prior allocation for SWAP/REBALANCE) — descriptive, not
itself executable code, since Phase 5 never executes anything.

**Estimates are arithmetic, not simulated.** `estimatedFees` uses a flat, documented rate
(`PROTOCOL_FEE_RATE`, 10bps) times requested capital. `estimatedSlippage` is
`(requestedCapital / recentVolume) * SLIPPAGE_COEFFICIENT`, capped at `MAX_SLIPPAGE_PCT` — pure
function of trade size vs. observed liquidity, not a live quote. `expectedBalanceChanges` assumes
a two-asset (XLM/USDC) portfolio model matching `AgentContext.features.portfolio`'s own shape — a
documented limitation, not a bug, since extending to N assets would require changing the frozen
`AgentContext` type.

## Determinism, immutability, replay

`buildExecutionPlan` is synchronous and pure aside from `randomUUID()` for `executionId` (the
only field allowed to differ between builds). `hashExecutionPlan` (`executionPlanner/hashing.ts`)
excludes `executionId` and `timestamp` — the same `sha256`-over-`stableStringify` technique used
everywhere else in this engine — so identical `VerifiedDecision` + `ReasoningContext` always
produces an identical `planHash`, proven by a 500x replay test. The returned plan is recursively
frozen (`deepFreeze`, the same technique as `reasoning/contextBuilder.ts`, duplicated locally
rather than importing a frozen Phase 1 file) — any mutation attempt throws.

## Testing (Phase 5)

`backend/src/__tests__/executionPlanner.test.ts` (33 tests) covers: single-action (4-step) and
HOLD (1-step no-op) plan generation; rejecting a `RejectedDecision`; deterministic step ordering
and `executionId` uniqueness vs. `planHash` stability; dependency-graph validation (valid DAG,
circular dependency, self-dependency, missing dependency, duplicate dependency, stable orphan-node
tie-break); protocol/asset routing and rejection of an unsupported protocol/asset re-checked
independently of Phase 4's verdict; capital checks against a context that changed after
verification (insufficient balance, negative balance — this caught a real gap, see below);
rollback generation (one per execute step, none for HOLD, deterministic); simulation request
generation; metadata/hash determinism and replay (500x); immutability (frozen, mutation throws);
and 10/50/100/250-way concurrency including 100 concurrent distinct decisions with zero
`planHash` collisions; and average/P95/P99 latency across 500 in-process builds (a regression
guard — avg < 50ms, P99 < 100ms — not a precise SLO), logged to console using the same
sort-and-index percentile technique as `benchmarks/reasoning/metrics/aggregate.ts`.

**Bug found and fixed during test-writing:** `runPrerequisiteChecks`'s `balances_sufficient` check
only compared `requestedCapital <= deployableCapital` — a negative `totalManagedCapital` paired
with a positive `deployableCapital` produced a negative `requestedCapital` that trivially
satisfied the comparison, silently passing. Fixed by adding an explicit `balances_non_negative`
check (mirroring Phase 4's capital-stage fix for the same class of bug) before the sufficiency
check runs.

`backend/src/__tests__/executionPlannerFinalAudit.test.ts` (66 tests, 14 categories) is a second,
independent pass over the same module: plan generation, dependency graph, ordering, protocol/asset
routing, capital, rollback, simulation, metadata, 500x determinism, 10/50/100/250/500-way
concurrency, adversarial "every attack must fail" cases (forged decisions, forged hashes, forged
dependency graphs), throughput/avg/P95/P99 performance over 1000 builds, and doc-vs-implementation
consistency. **Three further bugs found and fixed by this audit:**
1. No prerequisite check existed for a disabled protocol subsystem
   (`AgentContext.system.protocolExecutionAvailable`) — a decision verified while the subsystem was
   up could still be planned after it went down. Fixed by adding a `protocol_enabled` check
   (exempting `HOLD`, which calls no protocol) to `runPrerequisiteChecks`, following the same
   re-derive-from-current-context pattern as the capital checks.
2. No independent check existed on `primaryDecision.allocation` itself — the planner trusted that
   anything shaped like a `VerifiedDecision` had already been through Decision Intelligence's
   schema validation, but nothing at runtime enforces that for a directly-constructed/forged
   object. A forged negative or >1 allocation could reach capital math unchecked (a negative
   allocation trivially satisfies `requestedCapital <= deployableCapital`). Fixed by adding an
   `allocation_in_range` check (`Number.isFinite` + `[0, 1]`) as defense-in-depth, not assuming
   upstream validation was actually run.
3. `hashExecutionPlan` excluded `metadata.planHash` from its hash input but not the top-level
   `planHash` field — recomputing the hash on an already-built plan diverged from the hash used to
   build it (self-referential corruption: `hashExecutionPlan(plan) !== plan.planHash`). Fixed by
   also destructuring out the top-level `planHash` before hashing.

## Explicitly out of scope for Phase 5

Blockchain execution (an Execution Engine that actually calls a protocol), and any change to the
Context Layer, Memory Engine, LLM provider layer, Benchmark Framework, Decision Intelligence, or
Decision Verification. Phase 5 only produces a plan describing what execution would look like.

## Phase 6: Execution Engine (`reasoning/executionEngine/`)

Turns a frozen `ExecutionPlan` (Phase 5) into an `ExecutionResult` by actually running its steps.
**Deterministic orchestration — no AI, no LLM.** The engine never imports or calls a protocol SDK
itself; every side effect goes through a caller-supplied `ProtocolAdapter` (`adapter.ts`):
`simulate(step)`, `submit(step)`, `confirm(step, transactionId)`. **No concrete protocol adapter
(Blend, a DEX, etc.) is implemented in this phase** — that is explicitly out of scope; only the
adapter contract and a deterministic in-test mock double exist.

```
ExecutionPlan
        |
        v
assertPlanExecutable()     re-runs topologicalSort() on the plan's own step graph + validates
        |                  every rollbackStrategy entry's compensatesStepId exists — a forged/
        |                  hand-built plan (bypassing buildExecutionPlan) cannot smuggle a cycle
        |                  or dangling rollback reference past the engine
        v  (any failure -> throw ExecutionPlanInvalidError, fail closed)
executeStep() per step, in dependency order (skips downstream of the first failure):
        prerequisite_check / confirm  -> bookkeeping only, no adapter call
        simulate                     -> adapter.simulate() -> reject whole run if !ok
        execute                      -> adapter.submit() -> adapter.confirm(), retried up to
                                         retryPolicy.maxAttempts for retryable failures;
                                         a 'timeout' confirm status is always terminal (never
                                         retried, to avoid double-submitting)
        |
        v  (if any step failed)
runRollback()               re-invokes adapter.submit() as a compensating call for every
        |                    execute step that succeeded before the failure
        v
hashExecutionResult()  ->  deepFreeze()  ->  ExecutionResult
```

**Status model.** `completed` (nothing failed), `partially_completed` (some steps failed, but
others completed and rollback wasn't fully successful/needed), `rolled_back` (rollback completed
for every succeeded execute step), `failed` (nothing completed at all). A single failed step does
not automatically mean overall `failed` — earlier steps that already succeeded (e.g.
`prerequisite_check`) are real, recorded outcomes.

**Retry classification.** `classifyFailure()` maps a failure to `retryable | permanent | timeout`.
A `confirm()` result of `'timeout'` is always terminal — resubmitting after an unknown-outcome
timeout risks a double-spend. Anything else retries up to `retryPolicy.maxAttempts` (default 3,
including the first attempt), then becomes `permanent`.

**Journal & replay.** Every simulate/submit/confirm/retry/rollback/skip event is appended to an
ordered `JournalEntry[]` (`seq`-numbered, not just timestamp-ordered, so replay is stable even if
entries are reordered). `replayJournal(journal)` reconstructs `completedSteps`/`failedSteps`/
`rolledBackSteps` from the journal alone, without re-invoking any adapter — the durable audit
trail is sufficient to answer "what happened" after the fact.

**Concurrency.** Same discipline as the Execution Planner: no module-level mutable state in
`executionEngine/*.ts`. Each `executePlan()` call gets its own `RunState` (journal, sequence
counter, runId), so parallel executions of the same or different plans never share memory.

## Determinism, immutability, replay (Phase 6)

`executePlan` is deterministic given a deterministic adapter (same simulate/submit/confirm
decisions in, same outcome out) aside from `randomUUID()` for `runId` and adapter-generated
`transactionId`s (neither reproducible, and both excluded from the hash). `hashExecutionResult`
(`executionEngine/hashing.ts`) excludes `runId`, all wall-clock timestamps/durations,
`transactionId`s, and **the entire `journal`** — the journal's `detail` strings embed those same
non-reproducible values (e.g. `"transactionId=tx-blend-3"`), so it can never be part of a stable
hash; the canonical outcome (status, completed/failed steps, rollback outcome, and each step's
status/fee/simulationResult/failureKind) is what gets hashed. The returned result is recursively
frozen (`deepFreeze`, same technique as Phase 5).

## Testing (Phase 6)

`backend/src/__tests__/executionEngine.test.ts` (37 tests) covers: successful multi-step and HOLD
execution with full per-step field capture (executionId, transactionId, protocol, action, status,
timestamps, duration, retryCount, fee, simulationResult); simulation failure (rejects before any
submit); protocol failure (adapter `confirm()` returns `'failed'`); timeout (terminal, never
retried, classified `timeout`); retry (retryable submit/confirm failures succeed within
`maxAttempts`, exhausting retries becomes `permanent`); rollback (invoked only when an execute
step actually succeeded before a later failure; not invoked for HOLD or for a step that never
ran); partial completion (downstream steps marked `skipped`, not dropped); invalid transaction/
invalid protocol/malformed plan (missing adapter, cyclic step graph, zero-step plan, dangling
rollback reference — all rejected before any adapter call); journal replay (reconstructs the same
completed-step set as the live result, order-independent via `seq`); determinism (500x identical
`executionHash` for the same plan + deterministic adapter); concurrency (10/50/100/250 parallel
executions, no cross-contamination, single shared `executionHash`); security (missing/spoofed
adapter, replay, rollback-bypass, malformed plan — every attack rejected); and average/P95/P99
latency + throughput across 300 executions (regression guard, not a precise SLO).

**Bugs found and fixed during test-writing (all in the new Phase 6 code, none in Phase 1-5):**
1. `hashExecutionResult` excluded `runId` at the top level but not each per-step
   `ExecutionStepResult.executionId` (which echoes `runId`) — every run produced a distinct
   `executionHash` despite identical outcomes. Only surfaced under a real (non-frozen) clock, in
   the 10/50/100/250-way concurrency tests. Fixed by also excluding `executionId` from the
   per-step hash projection.
2. `replayJournal` reconstructed `completedSteps` by matching `/status=confirmed/` against journal
   `detail` text, but `prerequisite_check`/`confirm`-type steps (no adapter call) originally
   logged a detail string without that substring, so replay silently dropped them from
   `completedSteps` even though the live `ExecutionResult` correctly listed them as completed.
   Fixed by normalizing every terminal-success log line to include `status=confirmed`.
3. (Same root cause as #2) A `simulate`-type step's completion was never logged to the journal at
   all — only `simulate_start`/`simulate_result` were recorded, with no terminal entry — so replay
   also dropped `step-1-simulate` from `completedSteps`. Fixed by adding a completion log line
   after a `simulate` step reaches `status: 'simulated'`.

## Explicitly out of scope for Phase 6

Any concrete `ProtocolAdapter` implementation (Blend, a DEX, or any other real protocol/chain
integration), and any change to the Context Layer, Memory Engine, LLM provider layer, Benchmark
Framework, Decision Intelligence, Decision Verification, or Execution Planner (all frozen). Phase
6 only orchestrates execution through adapters supplied by the caller.

## Protocol Adapter Framework (`protocolAdapters/`)

A standalone infrastructure layer, not a Reasoning Engine phase — it has no dependency on
Context/Memory/Reasoning/Decision Intelligence/Decision Verification/Execution Planner, and they
have no dependency on it. Exists so the Phase 6 Execution Engine (`reasoning/executionEngine/`)
never needs to call a protocol SDK directly: it goes Execution Engine → `ProtocolRegistry` →
`ProtocolAdapter` → protocol SDK. **No Blend/Soroswap/Phoenix implementation exists yet** — only
the abstraction (interface, registry, factory, deterministic hashing) and a declarative
`createAdapter()` used to build deterministic test doubles.

### Adapter lifecycle

```
createAdapter(spec) or a hand-built ProtocolAdapter
        |
        v
registry.register(adapter)
        |  1. validateAdapterShape() — every required method present, capabilities well-formed,
        |     capabilities.protocol === adapter.protocol (adapter-spoofing check)
        |  2. reject if a live entry already exists for this protocol (DuplicateAdapterError)
        |  3. freeze capabilities, compute capabilityHash + adapterHash
        v
ProtocolMetadata (frozen) stored, keyed by protocol name
        |
        v
registry.lookup(protocol) -> live ProtocolAdapter, for simulate/validate/execute/estimate* calls
registry.health(protocol)  -> always a fresh adapter.health() call, never cached
registry.unregister(protocol) -> removes the entry; re-registration afterward is allowed
```

Every method on `ProtocolAdapter` (`adapter.ts`) is async — `initialize`, `health`, `simulate`,
`validate`, `execute`, `estimateFees`, `estimateSlippage` — except `capabilities()`, which must be
a pure synchronous function of the adapter's fixed configuration (the registry calls it once, at
registration, and freezes the result; an adapter is not expected to change what it supports after
construction).

### Registry design

`ProtocolRegistry` (`registry.ts`) holds a private `Map<string, { adapter, metadata }>` — never
exposed directly. `list()` returns a frozen, protocol-name-sorted array of `ProtocolMetadata`
snapshots (not adapter references), so a caller can never mutate the registry's internal state
through a returned value, and iteration order is deterministic regardless of registration order.
`register`/`unregister`/`lookup`/`has` are synchronous (`Map` operations are atomic in JS's
single-threaded model, so no lock is needed for concurrent registration attempts); only `health()`
is async, since it live-queries the adapter.

Fail-closed on every path: `lookup`/`unregister`/`health` of an unregistered protocol throw
`AdapterNotFoundError`; `register` of a protocol already present throws `DuplicateAdapterError`;
`register` of a shape-invalid adapter (missing method, empty capability array, non-boolean flag,
or a `capabilities.protocol` that doesn't match `adapter.protocol`) throws `MalformedAdapterError`
— validated *before* the adapter ever enters the map, never discovered later at lookup time.

### Capability model

`ProtocolCapabilities` (`types.ts`): `protocol`, `supportedActions`, `supportedAssets`,
`supportedNetworks` (all non-empty string arrays), `simulationSupport`/`batchingSupport`/
`rollbackSupport` (booleans). Declared once, frozen at registration. `hashCapabilities()`
(`hashing.ts`) sorts the three array fields before hashing, so two declarations listing the same
actions/assets/networks in different order still produce the same `capabilityHash` — order was
never meaningful for a capability *set*.

### Health model

Four states (`HEALTH_STATUSES`): `READY`, `DEGRADED`, `UNAVAILABLE`, `UNKNOWN`. The registry never
caches or infers health — `registry.health(protocol)` always calls the live
`adapter.health()`, so a health-spoofing attempt (an adapter reporting a stale/fake status) is
structurally impossible from the registry's side; the adapter's own `health()` implementation is
the only source of truth, by design (a future real adapter is expected to check actual
connectivity/RPC health there).

### Simulation flow

`createAdapter()`'s default `simulate()` (`factory.ts`): re-runs `validate()` first (never trusts
that a caller already validated), and if validation fails, returns `success: false` with the
validation errors surfaced directly as `SimulationResult.errors` — a decision never reaches
fee/slippage estimation on an invalid request. On a valid request, it calls `estimateFees()` /
`estimateSlippage()` (both overridable per spec) and assembles a `SimulationResult` (`success`,
`estimatedFees`, `estimatedSlippagePct`, `warnings`, `errors`, `estimatedOutputs`,
`simulationHash`). `hashSimulationResult()` hashes everything except the `simulationHash` field
itself (self-reference, same discipline as `hashExecutionPlan`/`hashExecutionResult` elsewhere in
this codebase) — deterministic for identical requests against a deterministic adapter.

### Determinism, immutability

`ProtocolMetadata` and `ProtocolCapabilities` are recursively frozen at registration
(`deepFreeze`, same technique as Phases 5/6) — any mutation attempt throws under strict mode.
`hashAdapter(protocol, version, capabilityHash)` excludes `registeredAt` (wall-clock,
non-deterministic), so re-registering the identical adapter always produces the identical
`adapterHash` regardless of when it happens — proven by a 500x replay test across fresh registry
instances.

### Testing

`backend/src/__tests__/protocolAdapterFramework.test.ts` (50 tests): registration (incl. duplicate
rejection, malformed-metadata rejection, re-registration after unregister); lookup/unregister
(fail-closed for unknown protocols); capability validation (unsupported action/asset/network,
missing required params); health transitions (registry always live-queries, never caches);
simulation (success, validation-failure fail-closed, warnings, deterministic hash); deterministic
hashing and replay (order-independent `capabilityHash`, `registeredAt`-independent `adapterHash`,
500x identical hashes across fresh registries); 10/50/100/250-way concurrent registration with no
race conditions and deterministic final state; security (adapter spoofing, duplicate IDs,
capability-object mutation after registration, health spoofing, `capabilities()` throwing,
registry-snapshot mutation via `list()`); and registration/lookup/simulation latency.

**Bug found and fixed during test-writing:** `createAdapter()` originally silently overwrote a
spec's mismatched `capabilities.protocol` with `spec.protocol` instead of rejecting it — masking
both a real future config bug (a copy-paste error naming the wrong protocol in a capability
declaration) and the registry's own adapter-spoofing defense (which the factory's silent fix made
untestable through the normal adapter-construction path). Fixed by adding `AdapterSpecMismatchError`,
thrown at `createAdapter()` build time whenever `spec.protocol !== spec.capabilities.protocol`,
rather than reconciling the two silently.

### Explicitly out of scope

Any concrete protocol implementation (Blend, Soroswap, Phoenix, or any other SDK integration),
actual blockchain calls, and wiring this framework into the Execution Engine (`reasoning/
executionEngine/`) — that integration is a later step, not part of this framework build.

## Aquarius Protocol Adapter (`protocolAdapters/aquarius/`)

The first concrete adapter built on the Protocol Adapter Framework above — implements
`ProtocolAdapter` for the Aquarius Router. **No blockchain execution**: `execute()` always throws
`AquariusExecutionNotImplementedError`; only quoting, validation, simulation, and unsigned
transaction *building* are implemented. No Soroban SDK dependency exists anywhere in this
directory — every external call goes through a caller-supplied client interface
(`AquariusRouterClient`, `SorobanRpcClient`, `AquariusBackendApiClient`), with a deterministic
in-memory double of each (`testDoubles.ts`) for development/testing.

### Router integration

Aquarius Router is the **single on-chain integration point** — this adapter never talks to a pool
contract directly. Every mutating action maps to one Router method:

| Action | Router method |
|---|---|
| `SWAP` (single hop) | `swap_chained` — a direct swap is just a 2-element path |
| `SWAP_CHAINED` (multi-hop) | `swap_chained` |
| `DEPOSIT` | `deposit` |
| `WITHDRAW` | `withdraw` |
| `CLAIM_REWARDS` | `claim_rewards` |
| `POOL_DISCOVERY` | *(read-only — no transaction; `buildTransaction()` rejects it)* |

The Router contract address is **never hardcoded** — `getAquariusRouterContractId(network)`
(`aquarius/config.ts`) reads `AQUARIUS_ROUTER_CONTRACT_ID_TESTNET` /
`AQUARIUS_ROUTER_CONTRACT_ID_MAINNET` from environment config, following the same
`readRequiredEnv` pattern as `backend/src/config.ts` (not modified). A single adapter instance
serves both networks — `request.network` selects which contract address is resolved per call, so
no separate testnet/mainnet adapter instances are needed.

### Backend API usage (optional path finding)

`resolveSwapRoute()` tries the optional `AquariusBackendApiClient.findRoute()` first (off-chain
path finding across pools); if it's not configured, throws, or returns `null`, the adapter falls
back to on-chain routing via `routerClient.quoteSwapChained([input, output], ...)` — per the
requirement "if the backend API is unavailable, continue using on-chain routing where supported."
Every route — from either source — is shape-validated (`assertValidRouteResult`) before being
trusted: a malformed response from either external client (wrong type, too-short path, etc.)
throws immediately rather than silently propagating into a `Quote`/`TransactionBuilder`.

### Simulation flow

`simulate()` always re-validates the request first (never trusts a caller already did), then:
1. Builds action-specific `estimatedOutputs` (swap output amount, LP tokens for `DEPOSIT`,
   underlying assets for `WITHDRAW`, reward amount/asset for `CLAIM_REWARDS`, pool count for
   `POOL_DISCOVERY`).
2. Calls `SorobanRpcClient.simulateTransaction(contractId, method, args, network)` — the one
   Soroban RPC touchpoint this adapter has, and strictly simulation-only (`simulate`, never
   `submit`). A simulation failure reported by Soroban RPC surfaces as `SimulationResult.success:
   false` with `errors`, not a thrown exception.
3. Assembles and hashes the result (`hashSimulationResult`, from the shared framework).

`validate()` checks, in order: supported action, supported network, **router availability**
(`health()` — `UNAVAILABLE`/`UNKNOWN` fail closed; `DEGRADED` still permits the request),
supported asset(s), **slippage limit** (`params.maxSlippagePct` vs. the adapter's configured
maximum, default 5%), **token ordering** (a `SWAP_CHAINED` path must start at the request's own
input asset, no repeated adjacent hops), and **trustline requirements** (any non-`XLM` asset
requires `params.trustlineEstablished === true`).

### Adapter registration

No different from any other adapter in this framework — `createAquariusAdapter(options)`
produces a plain `ProtocolAdapter`; `registry.register(adapter)` validates and freezes it exactly
as documented above. No special-casing exists or was added to `ProtocolRegistry` for Aquarius.

### Testing

`backend/src/__tests__/aquariusAdapter.test.ts` (48 tests): registration/capabilities; quote
generation (on-chain fallback, backend-API routing, fallback-on-unavailable, fallback-on-null,
reject-invalid); `SWAP`/`SWAP_CHAINED` (simulate, `buildTransaction` routing both through
`swap_chained`, path preserved in tx args); `DEPOSIT`/`WITHDRAW`/`CLAIM_REWARDS`/`POOL_DISCOVERY`
(simulate outputs, correct Router method mapping, `POOL_DISCOVERY` transaction-build rejection);
validation (unsupported asset/action, invalid route — short path, wrong starting hop, repeated
hop, unsupported hop asset — slippage over/under limit, router `UNAVAILABLE`/`UNKNOWN`/`DEGRADED`
health, trustline required/exempt/satisfied); malformed responses (bad router path shape, Soroban
RPC failure surfaced as a failed simulation not an exception, missing contract-id env var);
deterministic quote/transaction/simulation hashing (incl. 500x); `execute()` always throws; and
10/50/100-way concurrent simulate/quote calls with a single deterministic hash across all of them.

**Bug found and fixed during test-writing:** the adapter originally trusted the shape of whatever
`AquariusRouterClient`/`AquariusBackendApiClient` returned without validation — a malformed
`path` (wrong type, too short) would propagate silently into a `Quote`/`TransactionBuilder`
instead of failing. Fixed by adding `assertValidRouteResult()`, called on every external route
response (on-chain and backend-API) before it's trusted.

### Performance

Simulation/quote/transaction-building are pure in-memory operations against injected clients —
latency is dominated entirely by whatever `AquariusRouterClient`/`SorobanRpcClient` implementation
is supplied (the deterministic test doubles resolve in microseconds; a real network-backed client
would dominate). No separate perf benchmark was added beyond the 500x/100-way determinism checks
above, since there is no real network call in this phase to measure.

### Remaining technical debt

No real `AquariusRouterClient`/`SorobanRpcClient`/`AquariusBackendApiClient` implementation exists
(by design — protocol execution and any real Soroban/HTTP integration are out of scope for this
phase). Concentrated-liquidity-specific pool-level interaction (beyond the Router) is not
implemented, since no requirement surfaced needing it yet — the Router covers every action this
adapter currently supports.

### Explicitly out of scope

Blend, Soroswap, Phoenix (any other protocol adapter), and any redesign of the Protocol Adapter
Framework's own interfaces beyond the two additive, backward-compatible optional methods
(`quote`, `buildTransaction`) and two shared types (`Quote`, `TransactionBuilder`) added to
support this and future router-based adapters. (Real Soroban RPC/backend API integration is
covered below — no longer out of scope.)

## Aquarius: Real Integration (`protocolAdapters/aquarius/real*.ts`, `production.ts`)

Replaces the deterministic test doubles with a real `AquariusRouterClient` and `SorobanRpcClient`
for production use — `createAquariusAdapter()` and its call contract are **unchanged**; only what
gets injected into it differs. Verified live against the official Aquarius testnet router.

### What was verified live (see verification log below for exact transcript)

- **Router contract**: `CBCFTQSPDBAIZ6R6PJQKSQWKNKWH2QIV3I4J72SHWBIK3ADRRAM5A6GD` — confirmed to
  exist on testnet via a real `getLedgerEntries` RPC call (contract instance storage inspected:
  `PoolCounter`, `TokenHash`, `RewardToken`, `ProtocolFeeFraction`, etc. — genuine AMM router
  state, not a guess). Sourced from https://docs.aqua.network/developers/code-examples/prerequisites-and-basics;
  a second candidate address surfaced by a generic web search returned **no ledger entry at all**
  and was discarded — this is why every address in this integration was independently confirmed
  on-chain rather than trusted from a single source.
- **`get_pools(tokens)`**: real call against the router returned 4 real pools for the XLM/AQUA
  token pair, matching the Aquarius backend API's own pool listing exactly (cross-validated pool
  index + pool contract address).
- **`swap_chained`**: a real simulated swap of 1 XLM → AQUA produced a genuine AMM-computed output
  (`22.831705 AQUA`), including a real `update_reserves` event from the pool contract. The first
  attempt failed with a real, expected error (`trustline entry is missing`) until a real `AQUA`
  trustline was established on the test account via a live `changeTrust` operation — this is the
  same trustline requirement `AquariusAdapter.validate()` already enforces.
- **`claim`** (the adapter's `CLAIM_REWARDS`): real call returned `0` (no LP position) — signature
  confirmed.
- **`withdraw`**: real call with `0` shares returned `[0, 0]` — signature confirmed.
- **`deposit`**: real call reached the contract with correctly-encoded arguments and failed with a
  genuine `resulting balance is not within the allowed range` error, because the test account
  holds `0 AQUA` — a real business-logic failure, not an encoding bug (proves the call reaches the
  contract correctly; the deposit's *success* path return-value shape was not independently
  observed live, see technical debt below).
- **Pool discovery**: the real Aquarius backend API (`https://amm-api-testnet.aqua.network/api/external/v2/pools/`)
  returned a real, paginated list of 101 pools.

Function signatures came from https://docs.aqua.network/developers/aquarius-soroban-functions and
were cross-validated against the real `get_pools`/`swap_chained`/`claim`/`withdraw` calls above —
the documented signature matched the real contract's actual argument order and count in every
case tested.

### Architecture (unchanged call graph, real implementations)

```
AquariusAdapter (adapter.ts — UNCHANGED)
        |
        v
options.routerClient          options.sorobanRpcClient
        |                              |
        v                              v
realRouterClient.ts            realSorobanRpcClient.ts
        |                              |
        +----------> invocation.ts <---+     (shared: builds the real Soroban operation
                          |                    for swap_chained/deposit/withdraw/claim,
                          v                    resolves asset/pool addresses, simulates)
                    @stellar/stellar-sdk
                    (rpc.Server.simulateTransaction — never .sendTransaction)
                          |
                          v
              realBackendApi.ts (AssetPoolRegistry)
                          |
                          v
        Aquarius Backend API (real, public, unauthenticated)
        — pool discovery + dynamic asset-code -> contract-address /
          (assetA, assetB) -> pool_index resolution. NEVER a hardcoded
          token or pool address anywhere in this integration.
```

`production.ts::createProductionAquariusAdapter()` is the one place that assembles "real mode" —
reads the router contract id, Soroban RPC URL, backend API URL, and simulation source account
from config/env (all real, network-appropriate defaults, all overridable, **never hardcoded** in
source beyond the well-known public Stellar RPC/API base URLs, which are Stellar-network-level
constants, not Aquarius-specific secrets).

### The simulation source account

Soroban's `simulateTransaction` needs a syntactically valid transaction, which needs a *source
account* with a real sequence number — but simulation never signs or submits, so **only a public
key is ever required**, read from `AQUARIUS_SIMULATION_SOURCE_ACCOUNT`. No secret key exists
anywhere in this codebase. For local verification, any funded testnet account works (fund one via
`https://friendbot.stellar.org?addr=<G...>`).

### Testing

`backend/src/__tests__/aquariusIntegration.test.ts` (10 tests) — real network calls against live
testnet, skipped unless `AQUARIUS_INTEGRATION_TEST=true` (keeps the default suite hermetic/
offline; run it with the command in that file's header comment). Covers `health()`, pool
discovery, `quote()`, `simulate()` for `SWAP`/`SWAP_CHAINED`/`WITHDRAW`/`CLAIM_REWARDS`,
`buildTransaction()`, deterministic tx-hash generation against the real client, and a
router-unavailable fail-closed case. All 10 pass against live testnet. The unit suite
(`aquariusAdapter.test.ts`, 49 tests, test doubles) also passes unaffected.

**Bugs found and fixed by real, live testing (this integration):**
1. **No caching in the backend-API pool registry** — every one of `listPools`/`resolveAddress`/
   `findPool`/`findPoolByIndex` re-fetched and re-paginated the full ~101-pool listing (6+ HTTP
   round trips) independently, and a single `simulate()` call invokes 2-3 of them. The full
   integration suite took **149 seconds** and two tests hit their 30s timeout before this was
   fixed. Fixed with a simple TTL cache (60s default) in `realBackendApi.ts`; the same suite now
   runs in **~13 seconds**.
2. **`simulate()` threw instead of returning a graceful failure** — a router/backend client
   exception (unreachable router, nonexistent contract, network error) propagated out of
   `adapter.simulate()` as a rejected promise, inconsistent with how a Soroban RPC-level failure
   was already handled (captured into `SimulationResult.errors`). Surfaced by a real integration
   test against a syntactically valid but undeployed router contract. Fixed by wrapping the
   router-client call and the Soroban RPC call each in their own `try/catch` inside `simulate()`,
   both degrading to `{ success: false, errors: [...] }` rather than throwing.
3. **`describe.skip`'s body still executes synchronously** — the real integration test file
   originally called `createProductionAquariusAdapter()` (which reads a required env var) at
   describe-body scope; vitest still runs a skipped suite's synchronous body to collect its
   `it`s, so the whole repo test suite failed with `Missing env var:
   AQUARIUS_SIMULATION_SOURCE_ACCOUNT` even with no integration env vars set — breaking the
   "default suite stays hermetic" guarantee this file exists to provide. Fixed by moving adapter
   construction into a `beforeAll` hook (hooks, unlike the describe body itself, are genuinely
   skipped).

### Remaining technical debt

- `deposit()`'s success return value (`(Vec<u128>, u128)` per docs) was not independently observed
  live — only its failure path was (real error, correct argument encoding). Should be re-verified
  with a test account funded in both pool assets before this path is trusted for anything beyond
  simulation.
- `priceImpactPct` from the real router client is currently always `0` — a real price-impact
  calculation needs pool reserve data this integration doesn't fetch (documented gap, not
  fabricated).
- No caching in `realBackendApi.ts` — every call re-fetches all pool pages; fine for occasional
  quoting, would need caching for high-frequency use.
- Concentrated-liquidity pool-level interaction remains unimplemented (unchanged from the
  framework build) — no requirement has surfaced needing it.

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
