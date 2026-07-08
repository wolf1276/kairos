# Kairos SDK Examples

Runnable, self-contained scripts demonstrating each part of [`@wolf1276/kairos-sdk`](../README.md). Each script imports the SDK from source (`../src`) and walks one workflow end to end.

> [!NOTE]
> The contract IDs, WASM hash, and keypairs in these files are **placeholders / `Keypair.random()`** for illustration. To run against live testnet, replace them with the deployed IDs from [`configs/contracts.testnet.json`](../../../configs/README.md) and a funded keypair.

## Examples

| Script | Demonstrates |
| :--- | :--- |
| [`create-wallet.ts`](./create-wallet.ts) | Deploy and initialize a `CustomAccount` smart wallet via `client.wallet.create(owner, wasmHash)`. |
| [`create-delegation.ts`](./create-delegation.ts) | Build and sign a `Delegation` with a spend-limit caveat via `client.delegation.create(...)`. |
| [`create-policy.ts`](./create-policy.ts) | Encode spend-limit and time-restriction policy terms via `client.policy.create(...)`. |
| [`execute-transaction.ts`](./execute-transaction.ts) | Redeem a delegation to run a SAC transfer via `client.execution.execute(...)`. |
| [`listen-events.ts`](./listen-events.ts) | Subscribe to and decode delegation events via `client.events.subscribe(...)` / `unsubscribe(...)`. |
| [`revoke-delegation.ts`](./revoke-delegation.ts) | Revoke a delegation and query its disabled status. |

## Running

From the repo root (uses `tsx`; no build required — scripts import `../src` directly):

```bash
npx tsx packages/sdk/examples/create-wallet.ts
```

## Related

- [`packages/sdk/README.md`](../README.md) — full SDK API reference.
- [`scripts/`](../../../scripts/README.md) — repo-level integration and demo scripts that exercise the SDK against live testnet.
