# registry

A durable on-chain mapping from **owner address → deployed Smart Wallet address**. It is the source of truth for onboarding recovery: given an owner's Stellar key, anyone can find that owner's [Smart Wallet](../custom-account/README.md) without off-chain state.

Part of the [Kairos Soroban contracts](../../README.md) workspace. 23 tests in [`src/test.rs`](./src/test.rs).

## Types

`DataKey`, `RegistryError` (in [`src/lib.rs`](./src/lib.rs)).

## Entrypoints

| Function | Purpose |
| :--- | :--- |
| `__constructor(admin)` | Set the admin address; runs atomically as part of `CreateContractV2` deployment, not a separate call. |
| `register(admin, owner, smart_wallet)` | Admin-attested mapping of an owner to their Smart Wallet. |
| `get_smart_wallet(owner) -> Option<Address>` | Read-only lookup of an owner's Smart Wallet. |
| `upgrade(new_wasm_hash)` | Upgrade the contract code. |

## Where it's used

- The web onboarding flow verifies a registry write after a sponsored Smart Wallet deploy and reads it as a fast/recovery path (`apps/web/app/api/connect/*`, see [apps/web README](../../../../apps/web/README.md)).
- The SDK exposes this via its `registry` module (`getSmartWallet`, `register`), added in SDK v1.1.0 — see [`packages/sdk`](../../../../packages/sdk/README.md).

## Related

- [`custom-account`](../custom-account/README.md) — the Smart Wallet addresses stored here.
- [`packages/sdk` `registry` module](../../../../packages/sdk/README.md) — the typed client.
