# Phoenix Real Transaction Builder — ABI Verification Assessment

## Decision: Synthetic path stays. Real transaction builder is NOT implemented.

Phoenix's contract ABI cannot be verified from the information available in this repository. Per the task's precondition ("Only proceed if Phoenix's contract ABI can be verified"), the synthetic execution path remains unchanged.

## Current State

- `backend/src/protocolAdapters/phoenix/adapter.ts` — synthetic `buildTransaction()`, `simulate()`, `quote()`
- `backend/src/protocolAdapters/phoenix/types.ts` — comment-documented function shapes (not verified ABI)
- `backend/src/protocolAdapters/phoenix/testDoubles.ts` — deterministic in-memory mocks
- `backend/src/reasoning/routeExecutionEngine/engine.ts` — synthetic fallback when no `RealTransactionProvider` is registered
- `backend/src/__tests__/executionEngineFourProtocols.test.ts` — asserts Phoenix falls back to `dataSource: 'synthetic'`

## Missing ABI Information

The following verified artifacts are **absent from this repo**:

1. **Verified contract interface** — No WASM interface definition, ABI JSON, or published spec for the Phoenix multihop, factory, or pool contracts. The only source is `types.ts` header comments, which are documentation, not a verified contract spec.

2. **Struct/enum ScVal encoding** — Phoenix's multihop entrypoints use:
   - `Option<T>` parameters (max belief price, max spread, deadline)
   - `PairType` enum
   - `Vec<Swap>` where `Swap` is a contract-defined struct
   - `SimulateSwapResponse` struct
   - `LiquidityPoolInfo` struct
   Soroban's `#[contracttype]` encoding is positional and depends on exact field declaration order. Without verified specs for these types, any ScVal encoder would be fabricated — the exact failure mode the task forbids ("Never infer: Option<T>, enums, tagged unions").

3. **Verified contract IDs** — No live testnet or mainnet contract IDs for Phoenix multihop/factory/pool contracts exist in the repo (only environment-variable placeholders in `config.ts`).

4. **Live verification transcript** — No evidence of real `simulateTransaction` calls against a deployed Phoenix contract (the bar Aquarius's integration was held to, documented in `docs/architecture/REASONING_ENGINE.md`).

5. **Asset resolution strategy** — Unknown how Phoenix encodes non-native assets in contract calls (classic SAC addresses, direct Soroban token contract addresses, or something else). Soroswap's invocation builder required `AssetResolver` for this; Phoenix's equivalent is undocumented.

## What Would Unblock This

To proceed, the repo would need at minimum:

- A verified contract spec (WASM interface / published ABI docs) for Phoenix multihop, factory, and pool contracts
- A live testnet verification transcript proving the ABI matches deployed contracts
- Confirmed ScVal encoding for all structs, enums, and `Option<T>` parameters
- Verified testnet contract IDs

## References

- `docs/architecture/REASONING_ENGINE.md` lines 1267–1286 — explicit rationale for Phoenix staying synthetic
- `backend/src/protocolAdapters/aquarius/invocation.ts` — production reference for a live-verified integration
- `backend/src/protocolAdapters/soroswap/realTransactionBuilder.ts` — documented-but-unverified integration pattern
