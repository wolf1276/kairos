# Kairos Documentation

Cross-cutting documentation for Kairos: architecture design docs and reports, the SDK API reference, and security audits. Package- and component-specific docs live with their code (see the READMEs linked at the bottom).

> [!NOTE]
> The root-level `*.md` files (`SDK.md`, `BACKEND.md`, `AI_PIPELINE.md`, …) are thin **pointer stubs** that redirect to the authoritative docs here and in each package. Start from the root [`README.md`](../README.md).

## architecture/

| Document | Contents |
| :--- | :--- |
| [`ARCHITECTURE.md`](./architecture/ARCHITECTURE.md) | The Soroban-native delegation framework architecture. |
| [`ARCHITECTURE_REPORT.md`](./architecture/ARCHITECTURE_REPORT.md) | Architecture audit report. |
| [`DELEGATION_WORKFLOW.md`](./architecture/DELEGATION_WORKFLOW.md) | Delegation end-to-end workflow. |
| [`CONTEXT_LAYER.md`](./architecture/CONTEXT_LAYER.md) | Context Layer design — see [`backend/src/agentContext`](../backend/src/agentContext/README.md). |
| [`MEMORY_ENGINE.md`](./architecture/MEMORY_ENGINE.md) · [`MEMORY_ENGINE_REFERENCE.md`](./architecture/MEMORY_ENGINE_REFERENCE.md) · [`MEMORY_ENGINE_FINAL_REPORT.md`](./architecture/MEMORY_ENGINE_FINAL_REPORT.md) | Memory Engine design, frozen technical reference, and final report — see [`backend/src/memoryLayer`](../backend/src/memoryLayer/README.md). |
| [`REASONING_ENGINE.md`](./architecture/REASONING_ENGINE.md) | Reasoning Engine / AI decision pipeline — see [`backend/src/reasoning`](../backend/src/reasoning/README.md). |
| [`IMPLEMENTATION_PROGRESS.md`](./architecture/IMPLEMENTATION_PROGRESS.md) | Implementation progress tracking. |

## api/

| Document | Contents |
| :--- | :--- |
| [`API.md`](./api/API.md) | Hand-written `KairosClient` API reference. |

> [!WARNING]
> `docs/api/API.md` is **slightly stale**: it documents only 3 of the 5 policy types, types `execute`'s redeemer as `Keypair` (the SDK now uses `Signer`), and omits the `registry` module, protocol adapters, and sponsored prepare/submit methods. The accurate source of truth is [`packages/sdk/README.md`](../packages/sdk/README.md) and the generated `dist/index.d.ts`.

## security/

| Document | Contents |
| :--- | :--- |
| [`SECURITY.md`](./security/SECURITY.md) | Framework security considerations. |
| [`AUDIT.md`](./security/AUDIT.md) | Comprehensive security & architecture audit. |
| [`DELEGATION_AUDIT.md`](./security/DELEGATION_AUDIT.md) | Delegation security & correctness audit. |

See also the root [`SECURITY.md`](../SECURITY.md) (threat model overview).

## Top-level docs

| Document | Contents |
| :--- | :--- |
| [`CHANGELOG.md`](./CHANGELOG.md) | Contract changelog. |
| [`MIGRATION.md`](./MIGRATION.md) | SDK migration guide (manual XDR → SDK). |
| [`TASKS.md`](./TASKS.md) | Development task checklist. |

## Component READMEs

- [`README.md`](../README.md) — project overview.
- [`backend/`](../backend/README.md) · [`apps/web/`](../apps/web/README.md)
- [`packages/sdk`](../packages/sdk/README.md) · [`packages/mcp-agent`](../packages/mcp-agent/README.md) · [`packages/turnkey-signer`](../packages/turnkey-signer/README.md) · [`packages/types`](../packages/types/README.md)
- [`contracts/soroban`](../contracts/soroban/README.md) · [`configs/`](../configs/README.md) · [`scripts/`](../scripts/README.md)
