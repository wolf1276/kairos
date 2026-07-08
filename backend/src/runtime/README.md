# Autonomous Runtime

The Autonomous Runtime composes the full AI decision pipeline into a schedulable loop that runs against a selectable execution target (testnet, mainnet, or a deterministic replay environment). It is primarily an **introspection and replay surface** — exposed through the backend's Developer Mode and dashboard routes — rather than the production trading path.

> [!NOTE]
> This README documents the code under `backend/src/runtime/`. Behavior is derived from the module structure and header comments; there is no dedicated architecture doc for the runtime beyond [`docs/architecture/REASONING_ENGINE.md`](../../../docs/architecture/REASONING_ENGINE.md).

## Structure

| Directory / file | Role |
| :--- | :--- |
| `autonomousRuntime/` | The runtime core: `runtime.ts`, `scheduler.ts`, `stateMachine.ts`, `persistence.ts`, `logger.ts`, `types.ts`. |
| `executionTarget/` | Pluggable execution targets — `testnetTarget.ts`, `mainnetTarget.ts`, `replayTarget.ts` — resolved by `factory.ts`. The replay target is what benchmarks and deterministic runs execute against. |
| `pipelineComposition/` | Composes pipeline stages (`composition.ts`) and combines strategy signals (`strategyConsensus.ts`). |
| `pipelineRunner/` | Runs one composed pipeline pass (`orchestrator.ts`). |
| `experienceBuilder/` | Builds experience records from runtime output (feeds learning/memory). |
| `runtimeSingleton.ts` | Process-wide runtime singleton. |

## Exposure

The runtime is wired into the backend's config-injected routes and returns `null`/`503` when not wired:

- `GET /api/dashboard/status` · `/health` · `/metrics` · `/memory` · `/learning` · `/history`
- `POST /api/dashboard/{start,stop,pause,resume}`
- Developer Mode (allowlist-gated): `GET /api/dev/{status,runtime,pipeline,benchmark}`, `POST /api/dev/paper/{start,stop,pause,resume}`, `POST /api/dev/validation/run`, `GET /api/dev/{export/logs,export/benchmark,stream}`

See the [backend README](../../README.md) for auth and Developer Mode details.

## Related

- [`reasoning/`](../reasoning/README.md) — the pipeline this runtime composes and runs.
- [`memoryLayer/`](../memoryLayer/README.md) — where experience records land.
- [`backend/benchmarks/e2e`](../../benchmarks/e2e/README.md) — exercises the runtime deterministically.
