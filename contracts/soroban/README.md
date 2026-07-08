# Kairos Soroban Contracts

The on-chain trust boundary of Kairos. These Stellar Soroban (Rust) smart contracts are the **final authority**: even if every off-chain component were compromised, an agent still cannot move funds outside the policies enforced here.

> [!NOTE]
> Design and threat model: [`docs/architecture/ARCHITECTURE.md`](../../docs/architecture/ARCHITECTURE.md), [`docs/security/`](../../docs/security). The TypeScript client over these contracts is [`@wolf1276/kairos-sdk`](../../packages/sdk/README.md).

## Workspace

A Cargo workspace ([`Cargo.toml`](./Cargo.toml)) with `members = ["contracts/*"]`, `soroban-sdk = 22.0.1`. Release profile is tuned for on-chain size/safety: `opt-level = "z"`, `overflow-checks = true`, `panic = "abort"`, `lto = true`.

## Contracts

| Crate | Purpose | Tests | README |
| :--- | :--- | :--- | :--- |
| `delegation-manager` | Delegation registry + redemption/execution path, nonce/replay protection, policy storage. | 13 | [README](./contracts/delegation-manager/README.md) |
| `custom-account` | Per-owner Smart Wallet (account abstraction, `__check_auth`). | 6 | [README](./contracts/custom-account/README.md) |
| `policies` | Composable caveat enforcers (spend limits, whitelists, time windows). | 11 | [README](./contracts/policies/README.md) |
| `registry` | Durable owner → smart-wallet mapping (onboarding recovery). | 23 | [README](./contracts/registry/README.md) |

## How they interact

```
owner ──deploys──▶ custom-account (Smart Wallet)  ──registered in──▶ registry
  │
  └─signs delegation─▶ delegation-manager.register_delegation
                          │
        redeem_delegations│  (checks nonce, resolves policies)
                          ▼
                       policies.before_all / before_hook / after_hook / after_all   (fail-closed enforcement)
                          │
                          ▼
                       custom-account.execute_from_executor   (only the wallet moves funds)
```

A delegation's caveats can reference **policy storage** (`set_policy`/`get_policy` on `delegation-manager`) via an indexing marker, so terms can be edited on-chain later without changing the delegation hash or signature.

## Build, test, deploy

```bash
# from contracts/soroban
cargo test                        # run all crate tests
stellar contract build            # build wasm (wasm32-unknown-unknown)
```

Deployment to Stellar testnet is scripted from the repo root — [`scripts/deploy-testnet.ts`](../../scripts/README.md) builds and deploys the crates and writes the resulting contract IDs to [`configs/contracts.testnet.json`](../../configs/README.md). CI builds and tests these crates on every push/PR (`contracts` job in [`.github/workflows/ci.yml`](../../README.md)).

## Deployed contracts (testnet)

Source of truth: [`configs/contracts.testnet.json`](../../configs/README.md).

| Contract | Address |
| :--- | :--- |
| DelegationManager | `CBR4HWJF4ZLDF4C6GF25PQWWZE5M7AOWGZHLJQH6DTEUXJ756KMOHYLF` |
| PolicyEngine | `CA6BPEFDZIC737VS26DQU77UYX5K4NB7VAKWNZAUO36WG7T24Z7N4BYD` |
| CustomAccount | `CAN25TOZQ6UXNVQO35RJLVND4VKTL52QOIQ7B4CWZRSZC5BDC5EQFNXF` |
| Registry | `CBDFFK2F4NZGXR7SRQAND3UZEIS32EHHVYNX4S475A7YYZDGN2E67SJV` |

## Related

- [`packages/sdk`](../../packages/sdk/README.md) — the typed client that builds, signs, and redeems the structures these contracts expect.
- [`docs/security/DELEGATION_AUDIT.md`](../../docs/security/DELEGATION_AUDIT.md) — delegation security review.
