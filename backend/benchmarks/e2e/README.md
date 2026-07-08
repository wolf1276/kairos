# End-to-End Benchmark Harness

A reproducible harness that exercises the full backend decision pipeline against a deterministic execution environment and scores it across four dimensions: **determinism, concurrency, reliability, and performance**. Reports are written to `reports/` as timestamped markdown.

> [!NOTE]
> This is distinct from the sibling [`benchmarks/reasoning/`](../reasoning/README.md) harness, which scores the LLM **Decision Intelligence** step across providers/models/scenarios. This e2e harness scores the **whole pipeline's runtime behavior**, not model quality.

## Structure

| File / directory | Role |
| :--- | :--- |
| `runners/cli.ts` | Entry point: `cli.ts all` or `cli.ts <dimension>`. |
| `runners/determinism.ts` | Same inputs → identical outputs. |
| `runners/concurrency.ts` | Behavior under concurrent pipeline runs. |
| `runners/reliability.ts` | Resilience to failures/retries. |
| `runners/performance.ts` | Latency/throughput. |
| `pipeline.ts` | The pipeline under test (wired to the deterministic replay target). |
| `registry.ts`, `fixtures.ts` | Scenario registry and fixtures. |
| `fetchStub.ts` | Deterministic network stub so runs don't depend on live services. |
| `reportWriter.ts` | Writes timestamped markdown reports to `reports/`. |
| `reports/` | Committed run outputs (`determinism-*.md`, `concurrency-*.md`, `reliability-*.md`, `performance-*.md`). |

## Running

From `backend/` (npm scripts in [`backend/package.json`](../../package.json)):

```bash
pnpm --filter @wolf1276/kairos-agent-backend benchmark:e2e           # all four dimensions
pnpm --filter @wolf1276/kairos-agent-backend benchmark:determinism   # single dimension
pnpm --filter @wolf1276/kairos-agent-backend benchmark:concurrency
pnpm --filter @wolf1276/kairos-agent-backend benchmark:reliability
pnpm --filter @wolf1276/kairos-agent-backend benchmark:performance
```

## Related

- [`benchmarks/reasoning/`](../reasoning/README.md) — model/provider scoring harness.
- [`src/runtime/`](../../src/runtime/README.md) — the runtime and replay target this harness drives.
