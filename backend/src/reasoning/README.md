# Reasoning Engine

The Reasoning Engine turns an agent's authorized context and memory into a **verified, plan-ready decision**. It is the heart of the Kairos AI decision pipeline, and it is *mostly deterministic*: only one phase (Decision Intelligence) ever calls an LLM. Every other phase is rule-based and reproducible.

> [!NOTE]
> Full design lives in [`docs/architecture/REASONING_ENGINE.md`](../../../docs/architecture/REASONING_ENGINE.md). This README documents the code surface under `backend/src/reasoning/`.

## Public surface

Callers import **only** from [`index.ts`](./index.ts) — never reaching into internal files directly. It re-exports the pipeline phases as namespaces plus the reasoning context/prompt/validation helpers:

| Export | What it is |
| :--- | :--- |
| `decisionIntelligence` (namespace) | Phase 3 — the LLM step (see below). |
| `verification` (namespace) | Phase 4 — deterministic decision verification, no LLM. |
| `executionPlanner` (namespace) | Phase 5 — deterministic execution planning, no LLM, no chain call. |
| `buildReasoningContext`, `buildPrompt`, `validateCandidateDecision`, `deriveAllowedPolicy` | Context assembly, prompt building, and candidate-decision validation. |
| `runReasoning`, `buildReasoningRequest`, `assemblePrompt`, `validateDecision` | Orchestrator entry points. |
| `ReasoningProvider`, `CandidateDecision`, `DecisionValidationResult`, … (types) | The reasoning type surface and `REASONING_ENGINE_SCHEMA_VERSION` / `PROMPT_TEMPLATE_VERSION`. |

## Pipeline phases

| Directory | Phase | LLM? | Role |
| :--- | :--- | :--- | :--- |
| `decisionIntelligence/` | Decision Intelligence | **Yes — the only LLM call** | Proposes a primary action with alternatives, evidence, and confidence. It **never sizes or authorizes** a transfer. |
| `verification/` | Verification | No | Deterministic gate. Rejects a decision that fails any rule; a rejected decision is never planned or executed. |
| `executionPlanner/` | Execution Planning | No | Builds a hashable, replayable plan with prerequisite checks. No blockchain call. |
| `executionEngine/`, `routeEngine/`, `routeExecutionEngine/` | Routing & Execution | No | Route discovery/quoting/ranking and per-protocol execution providers (blend/soroswap). |
| `learningEngine/`, `outcomeRecorder/`, `memoryWriter/` | Learning | No | Records outcomes and writes back to the [Memory Engine](../memoryLayer/README.md). |

Supporting files: `contextBuilder.ts`, `promptBuilder.ts`, `promptTemplate.ts`, `orchestrator.ts`, `validation.ts`, `hashing.ts`, `metadata.ts`, `interfaces.ts`, `types.ts`. A `benchmark/` directory supports the reasoning benchmark harness ([`backend/benchmarks/reasoning`](../../benchmarks/reasoning/README.md)).

### Verification rules

`verification/rules/` holds one deterministic checker per concern: `schema`, `policy`, `capital`, `risk`, `evidence`, `consistency`, `market`, `portfolio`, `protocol`, `execution`. All must pass for a decision to proceed.

## LLM provider layer

`providers/` is a config-driven, swappable provider abstraction — models can change without code changes.

- **Providers** ([`providers/registry.ts`](./providers/registry.ts), `factory.ts`): `openai`, `openrouter` (**default**), `nvidia`, `deepseek`, `anthropic`, `ollama`, `huggingface`.
- All are OpenAI-compatible HTTP (`openAiCompatible.ts`, `baseProvider.ts`); structured-output mode differs per provider (`json_schema` for openai/nvidia; `json_object` otherwise).
- The default `openrouter` provider resolves a **free** model dynamically with fallback (`openrouterModelRegistry.ts`, `OPENROUTER_AUTO_MODEL`) and never routes to a paid model.
- When no API key is configured or a call fails, Decision Intelligence uses a **deterministic heuristic fallback** — the pipeline always produces a decision.

Configuration is read from env by the backend (`REASONING_PROVIDER`, `REASONING_MODEL`, `REASONING_TEMPERATURE`, `REASONING_MAX_TOKENS`, `REASONING_TIMEOUT_MS`, `REASONING_MAX_RETRIES`, `REASONING_STRUCTURED_OUTPUT`, plus provider API keys). See the [backend README](../../README.md) for the full env table.

## Related

- [`docs/architecture/REASONING_ENGINE.md`](../../../docs/architecture/REASONING_ENGINE.md) — design doc.
- [`agentContext/`](../agentContext/README.md) — the Context Layer that feeds reasoning.
- [`memoryLayer/`](../memoryLayer/README.md) — memory the reasoning consumes and writes back to.
- [`protocolAdapters/`](../protocolAdapters/README.md) — the venues the route/execution phases target.
- [`backend/benchmarks/reasoning`](../../benchmarks/reasoning/README.md) — scores this engine across scenarios/providers.
