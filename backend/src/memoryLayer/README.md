# Memory Engine

The Memory Engine gives an agent relevant past experience — episodes, semantic facts, and derived patterns — assembled into a single `MemoryPackage` that the [Reasoning Engine](../reasoning/README.md) and the dashboard consume.

> [!NOTE]
> Full design lives in [`docs/architecture/MEMORY_ENGINE.md`](../../../docs/architecture/MEMORY_ENGINE.md) (plus `MEMORY_ENGINE_REFERENCE.md` and `MEMORY_ENGINE_FINAL_REPORT.md`). This README documents the code under `backend/src/memoryLayer/`.

## Entry point

`orchestrator.ts` exposes `assembleMemoryPackage(agentId)` — the single function callers use to build the `MemoryPackage` for an agent (retrieval + intelligence combined), plus `isAssemblyInProgress()` and `MemoryOrchestratorError`.

## Structure

| Directory / file | Role |
| :--- | :--- |
| `providers/` | The three memory stores — `inMemoryEpisodicProvider`, `inMemorySemanticProvider`, `inMemoryWorkingProvider`. |
| `retrieval/` | Relevance retrieval pipeline: `queryBuilder` → `tagIndex` → `scoring` → `ranking` → `topK`, coordinated by `retrievalOrchestrator`. |
| `intelligence/` | Experience intelligence over retrieved memory: `conflicts`, `evidence`, `patterns`, `regimeTags`, `statistics`, `tagAggregation`, coordinated by `intelligenceOrchestrator`. |
| `analytics.ts` | Aggregate memory analytics. |
| `metrics.ts`, `validation.ts`, `types.ts` | Metrics, input validation, and the memory type surface. |

> [!IMPORTANT]
> Memory providers are **in-memory today** (`inMemory*Provider`). Persistent memory storage providers are a roadmap item — see the root [README](../../../README.md#roadmap). The provider interfaces in `providers/types.ts` are the seam a persistent backend would implement.

## Related

- [`reasoning/`](../reasoning/README.md) — consumes the `MemoryPackage` and writes outcomes back (`memoryWriter`).
- [`agentContext/`](../agentContext/README.md) — the authorized context assembled alongside memory.
- [`docs/architecture/MEMORY_ENGINE.md`](../../../docs/architecture/MEMORY_ENGINE.md) — design and rationale.
