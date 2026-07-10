# Protocol Layer

The Protocol Layer is a pluggable adapter framework that lets the agent interact with on-chain DeFi venues through a uniform interface. Each adapter declares its capabilities, normalizes quotes, and — critically — is written to fail closed against spoofing, quote forgery, and fee manipulation.

> [!NOTE]
> Cross-cutting design lives in the root [`PROTOCOLS.md`](../../../PROTOCOLS.md) pointer. This README documents the code under `backend/src/protocolAdapters/`.

## Framework files

| File | Role |
| :--- | :--- |
| `adapter.ts` | The base adapter contract (capability declaration, quote/execution surface). |
| `registry.ts` | Registry of available adapters. |
| `factory.ts` | Resolves an adapter instance for a protocol. |
| `hashing.ts` | Deterministic hashing shared across adapters (plan/quote integrity). |
| `types.ts` | Shared protocol types. |

## Adapters

One subdirectory per venue. Each contains `adapter.ts`, `config.ts`, `hashing.ts`, `invocation.ts`, `realTransactionBuilder.ts`, `testDoubles.ts`, and `types.ts`:

| Protocol | Directory | Notes |
| :--- | :--- | :--- |
| Blend | `blend/` | Lending. |
| Soroswap | `soroswap/` | AMM. |

`testDoubles.ts` in each adapter provides deterministic test fakes so the pipeline can be exercised without live RPC.

## Relationship to the SDK's protocols module

This backend Protocol Layer is separate from, and richer than, the SDK-side [`packages/sdk/src/protocols`](../../../packages/sdk/README.md) (which ships `blend` and `soroswap` adapters plus `getAdapter(client, protocolId)` for building on-chain actions). The backend layer covers routing, quote normalization, and multi-venue security enforcement for the agent pipeline; the SDK layer is the lower-level, protocol-agnostic action builder used at execution time. The Reasoning Engine's `routeEngine`/`routeExecutionEngine` ([`../reasoning/README.md`](../reasoning/README.md)) drive these adapters.

> [!IMPORTANT]
> On-chain protocol execution is off by default in the backend (`ENABLE_PROTOCOL_EXECUTION`); Blend wiring additionally requires `BLEND_POOL_CONTRACT_ID_*`, `BLEND_SOROBAN_RPC_URL`, and honors `BLEND_MIN_HEALTH_FACTOR`. See the [backend README](../../README.md).

## Related

- [`reasoning/`](../reasoning/README.md) — route discovery/quoting/ranking and per-protocol execution.
- [`packages/sdk/src/protocols`](../../../packages/sdk/README.md) — SDK-level protocol action builders.
