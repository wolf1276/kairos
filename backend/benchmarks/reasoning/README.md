# Reasoning Benchmark Framework

A permanent, reusable benchmarking harness for the Reasoning Engine's Decision Intelligence
pipeline. Run one command, get a timestamped report; run it again after any provider/model/prompt/
architecture change, and get a second report plus an automatic regression comparison against the
first.

This framework only *calls* `reasoning/decisionIntelligence` (Phase 3's public surface) — it never
modifies Context, Memory, Reasoning, Verification, or Provider code. Every provider/model call goes
through the exact same `generateDecisionIntelligence()` entry point production code uses.

## Architecture

```
benchmarks/reasoning/
  scenarios/    Deterministic, versioned AgentContext + MemoryPackage + UserPolicy fixtures
  runners/      Provider registry, scenario executor, orchestration, CLI
  metrics/      Aggregation, scoring, calibration checks, alternative-quality checks, regression diff
  reports/      Timestamped JSON + Markdown output (committed to the repo, never overwritten)
  utils/        Small generic helpers (deep-merge, timestamps, Markdown tables)
```

Data flow for one run:

```
scenarios/index.ts (ALL_SCENARIOS)
        x
runners/providerRegistry.ts (resolveConfiguredModels — reads env, skips unconfigured entries)
        |
        v
runners/executeScenario.ts  --calls-->  reasoning/decisionIntelligence (unmodified)
        |
        v
runners/runBenchmark.ts  (sequential, paced — see "Why sequential" below)
        |
        v
metrics/aggregate.ts -> metrics/scoring.ts -> metrics/calibration.ts -> metrics/alternativeQuality.ts
        |
        v
reports/loadPreviousReport.ts (find most recent existing report)
        |
        v
metrics/regression.ts (diff current vs. previous)
        |
        v
reports/writeReport.ts  ->  reports/<timestamp>.json + reports/<timestamp>.md
```

### Why sequential, paced execution by default

Live testing across this project's history (the Phase 2B model benchmark, the Phase 3 production
smoke tests) repeatedly found that free-tier and even some paid provider APIs (OpenRouter's free
models, NVIDIA NIM under back-to-back load) rate-limit aggressively under concurrent or rapid
sequential requests. The runner defaults to a 3-second pace between requests
(`RunBenchmarkOptions.paceMs`, override with `--pace-ms`) to get *reliable* data rather than a
report full of `rate_limit` noise. This is a benchmarking-infrastructure decision, not a change to
how Decision Intelligence itself calls providers in production (that retry/backoff logic lives
untouched in `reasoning/decisionIntelligence/orchestrator.ts`).

## Scenarios

13 scenarios across four groups, each with an `id`, `category`, `version`, and `description`:

| Group | Scenarios |
| --- | --- |
| Market conditions | `bull_trend`, `bear_trend`, `sideways`, `high_volatility`, `low_volatility`, `conflicting_evidence` |
| Memory shape | `empty_memory`, `rich_memory` |
| Policy profile | `conservative_policy` (15% ceiling), `balanced_policy` (35%), `aggressive_policy` (65%) |
| Portfolio size | `small_portfolio`, `large_portfolio` |

Every scenario builds on shared base fixtures (`scenarios/baseFixtures.ts`) via `deepMerge` — a
scenario file only needs to specify what's *different* from the base, keeping each scenario's
intent legible.

**Versioning.** Each `BenchmarkScenario.version` bumps when that scenario's fixture data changes in
a way that would make old reports non-comparable. `SCENARIO_SET_VERSION`
(`scenarios/index.ts`) bumps when a scenario is added or removed. The runner warns (not fails) if
comparing against a report generated under a different `SCENARIO_SET_VERSION`.

### Adding a new scenario

1. Add a new entry to the appropriate `scenarios/*Scenarios.ts` file (or create a new category file
   and import it into `scenarios/index.ts`'s `ALL_SCENARIOS`).
2. Give it a unique `id`, correct `category`, `version: '1.0.0'`, and a `description`.
3. Bump `SCENARIO_SET_VERSION` in `scenarios/index.ts`.

No runner, metrics, or report code needs to change — everything iterates `ALL_SCENARIOS` generically.

## Adding a new provider or model

Add **one entry** to `runners/providerRegistry.ts`'s `PROVIDER_REGISTRY` array:

```ts
{ id: 'my-new-model', provider: 'openrouter', model: 'some/model:free', apiKeyEnvVar: 'OPENROUTER_API_KEY' }
```

- `provider` must be one of `reasoning/decisionIntelligence/requestClient.ts`'s
  `DecisionIntelligenceProviderName` values (`openai`, `anthropic`, `deepseek`, `nvidia`,
  `openrouter`, `huggingface`) — Decision Intelligence's own provider set, not a new one you invent
  here.
- If the entry's `apiKeyEnvVar` isn't set in the environment, the runner logs a warning and skips
  it — it never fails the whole run.
- Nothing else changes. The runner, scoring, reports, and regression tracker all iterate the
  registry generically — this is the "automatically plug in" requirement.

## Running benchmarks

```bash
npm run benchmark                          # every configured provider/model, every scenario
npm run benchmark:reasoning                # same as above (alias)
npm run benchmark:model -- qwen3           # filter by model id/name substring
npm run benchmark:provider -- huggingface  # filter by exact provider name
```

Or directly:

```bash
tsx benchmarks/reasoning/runners/cli.ts --provider nvidia --scenario bull_trend --pace-ms 5000
```

If you have `bun` installed, `bun run benchmark:model qwen3` works identically (bun executes
package.json scripts and forwards trailing arguments the same way).

Flags: `--provider <name>`, `--model <substring>`, `--scenario <id-or-category>`, `--pace-ms <ms>`.
Omit a flag to run against everything it would otherwise filter.

## Report format

Every run writes two files to `reports/`, named by a filesystem-safe ISO timestamp (e.g.
`2026-07-06T22-16-53-336Z.json` / `.md`) — **never overwritten**, so report history accumulates
run over run.

**JSON report** (`BenchmarkReport` in `reports/writeReport.ts`): every raw `BenchmarkRunResult`
(one per model×scenario pair — provider, model, latency, tokens, retries, validation result,
full decision summary), per-model `ModelAggregate`s, `ModelScore`s, calibration flags, alternative-
quality reports, and the regression findings against the previous report. This is the
machine-readable source of truth — the Markdown report is a rendering of it.

**Markdown report**: summary table (score, validity %, latency, tokens, confidence, evidence
count per model), score breakdown (all 7 weighted components), decision distribution (HOLD/
DEPOSIT/WITHDRAW/SWAP/REBALANCE % per model), confidence calibration flags, alternative-quality
table, regressions (or "No regressions detected"), and error-kind counts per model.

## Interpreting reports

- **Score** (0-100): a weighted blend of validation pass rate (25%), JSON quality (15%), policy
  compliance (15%), evidence quality (15%), reasoning quality (10%), latency (10%), and token
  efficiency (10%). Weights live in `metrics/scoring.ts::WEIGHTS` — change them there if priorities
  shift; the change is visible in every subsequent report's "Weights:" line.
- **Policy compliance** is measured separately from generic validation failures — it specifically
  counts protocol/asset-allowlist and allocation-ceiling violations (`metrics/aggregate.ts::
  isPolicyViolation`), since those are policy-specific failures worth tracking distinctly from
  schema-shape errors (missing fields, broken evidence references, etc).
- **Confidence calibration flags** (`metrics/calibration.ts`) are heuristics on distribution shape,
  not a true calibration curve (that needs ground-truth outcomes a live LLM benchmark doesn't have):
  `overconfidence` (avg ≥ 0.9), `underconfidence` (avg ≤ 0.4), `confidence collapse` (stddev < 0.03
  — the model outputs nearly the same confidence regardless of scenario).
- **Alternative quality** checks alternatives are unique from each other, distinct from the primary
  decision, and carry a non-empty `tradeoffs` explanation.

## Comparing benchmark history

The runner automatically finds the most recently written report in `reports/` (by filename
timestamp) before writing the new one, and diffs `ModelAggregate`s per model
(`metrics/regression.ts`). Flagged regressions (all thresholds are named constants in
`regression.ts::THRESHOLDS`, easy to retune):

| Kind | Trigger |
| --- | --- |
| `latency` | avg latency increased ≥ 20% |
| `validation` | validation pass rate dropped ≥ 10 percentage points |
| `token` | avg total tokens increased ≥ 20% |
| `reasoning` | avg evidence count or reasoning-chain length dropped ≥ 20% |
| `confidence` | avg confidence dropped ≥ 0.1 absolute |

A model with no matching entry in the previous report (a brand-new registry entry) is never flagged
— there's nothing to regress against yet.

To compare two arbitrary historical reports manually (not just "current vs. most recent"), load
both JSON files and call `compareReports(currentReport.aggregates, olderReport.aggregates)`
directly — it's a pure function, no file I/O.

## Extension points summary

| Change | What to edit |
| --- | --- |
| New scenario | `scenarios/*Scenarios.ts` + bump `SCENARIO_SET_VERSION` |
| New provider/model | One entry in `runners/providerRegistry.ts` |
| New score component | `metrics/scoring.ts::scoreModel` + `WEIGHTS` |
| New regression check | `metrics/regression.ts::compareReports` + `THRESHOLDS` |
| New report section | `reports/writeReport.ts::buildMarkdown` |

None of these require touching `reasoning/`, `agentContext/`, `memoryLayer/`, or
`reasoning/providers/` — this framework is strictly a consumer of those, never a modifier.
