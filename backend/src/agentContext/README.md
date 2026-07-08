# Context Layer

The Context Layer assembles an **immutable, read-only snapshot** of everything an agent is authorized to know at decision time — the `AgentContext`. It is the first stage of the AI decision pipeline: the [Reasoning Engine](../reasoning/README.md) reasons only over what the Context Layer exposes.

> [!NOTE]
> Full design lives in [`docs/architecture/CONTEXT_LAYER.md`](../../../docs/architecture/CONTEXT_LAYER.md). This README documents the code under `backend/src/agentContext/`.

## What it produces

`contextBuilder.ts` assembles an `AgentContext` spanning five domains (`domains/`):

| Domain | File | Contents |
| :--- | :--- | :--- |
| Market | `marketContext.ts` | Live price, trend, volatility, regime. |
| Capital | `capitalContext.ts` | Available capital and allocation. |
| Policy | `policyContext.ts` | The delegation/caveat constraints in force. |
| System | `systemContext.ts` | Runtime/system state. |
| Historical | `historicalContext.ts` | Recent history relevant to the decision. |

## Supporting modules

| File | Role |
| :--- | :--- |
| `featureEngine.ts` | Derives features from raw inputs. |
| `featureCache.ts` + `cache/` | In-memory feature cache provider. |
| `regimeDetector.ts` | Classifies market regime. |
| `monitor.ts` | Periodic self-check of context health. |
| `metrics.ts`, `validation.ts`, `types.ts` | Metrics, validation, and the context type surface. |

## Exposure

The assembled context is served over the backend REST API:

- `GET /api/agents/:id/context?pair=&refresh=` — the assembled `AgentContext` (validated pair, 15s timeout).
- `GET /api/context-metrics`, `GET /api/context-health` — Context Layer observability.

The dashboard's Context Layer inspector (`apps/web/app/dashboard/context`) renders this response. See the [backend README](../../README.md) and [apps/web README](../../../apps/web/README.md).

## Related

- [`reasoning/`](../reasoning/README.md) — consumes the `AgentContext`.
- [`memoryLayer/`](../memoryLayer/README.md) — memory assembled alongside context.
- [`docs/architecture/CONTEXT_LAYER.md`](../../../docs/architecture/CONTEXT_LAYER.md) — design doc.
