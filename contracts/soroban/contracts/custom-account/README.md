# custom-account

The Kairos **Smart Wallet** — a per-owner Soroban custom account (account abstraction). Funds live here; the owner keeps custody. Agents never hold the key; they can only cause the wallet to act through a delegation the owner signed and the [delegation-manager](../delegation-manager/README.md) redeems.

Part of the [Kairos Soroban contracts](../../README.md) workspace. 6 tests in [`src/test.rs`](./src/test.rs).

> [!NOTE]
> Onboarding/recovery context: the root [`SMART_WALLET.md`](../../../../SMART_WALLET.md) pointer and [`apps/web`](../../../../apps/web/README.md) sponsored Freighter onboarding flow.

## Types

`DataKey`, `AccountEd25519Signature`, `AccountError` (in [`src/lib.rs`](./src/lib.rs)).

## Entrypoints

| Function | Purpose |
| :--- | :--- |
| `init(owner, delegation_manager)` | Bind the wallet to its owner and the delegation manager allowed to drive it. |
| `execute(target, function, args)` | Owner-authorized direct call from the wallet. |
| `execute_from_executor(target, function, args)` | Called by the delegation-manager during `redeem_delegations` — the only path an agent's delegated action reaches the wallet. |
| `is_valid_signature(hash, signature)` | Verify an Ed25519 signature against the owner key. |
| `__check_auth(...)` | Soroban custom-account authorization hook — Ed25519 signature verification that makes this a smart account. |

## How it fits

`__check_auth` is what makes this a Soroban *account*: the runtime calls it to authorize operations. During delegated execution, the delegation-manager (after enforcing [policies](../policies/README.md)) invokes `execute_from_executor`, so the wallet — never the agent — is what actually moves tokens.

## Related

- [`delegation-manager`](../delegation-manager/README.md) — drives `execute_from_executor` during redemption.
- [`registry`](../registry/README.md) — maps an owner to their deployed Smart Wallet.
- [`packages/sdk` `wallet` module](../../../../packages/sdk/README.md) — deploy/load/sponsored-deploy helpers.
