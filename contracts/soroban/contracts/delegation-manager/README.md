# delegation-manager

The core delegation registry and execution router for Kairos. It records signed delegations, enforces replay protection, stores editable policy terms, and drives the redemption path that ultimately calls the owner's Smart Wallet.

Part of the [Kairos Soroban contracts](../../README.md) workspace. 13 tests in [`src/test.rs`](./src/test.rs).

## Types

`Caveat`, `Delegation`, `Execution`, `ExecutionContext`, `DataKey`, `ManagerError` (defined in [`src/lib.rs`](./src/lib.rs)).

## Entrypoints

| Function | Purpose |
| :--- | :--- |
| `init(owner)` | Initialize the manager with an owner. |
| `pause()` / `unpause()` / `is_paused()` | Emergency circuit breaker. |
| `transfer_ownership(new_owner)` | Rotate the owner. |
| `update_current_contract_wasm(new_wasm_hash)` | Upgrade the contract code. |
| `register_delegation(delegator, delegation)` | Record a signed delegation on-chain. |
| `get_wallet_delegation(delegator, delegate)` | Look up the active delegation hash for a wallet↔agent pair, if any. |
| `disable_delegation(delegator, delegation)` | Disable a specific delegation. |
| `enable_delegation(delegator, delegation)` | Re-enable a disabled delegation. |
| `revoke_by_wallet(delegator, delegate)` | Revoke the delegation for a wallet↔agent pair. |
| `is_delegation_disabled(delegation_hash)` | Check disabled state by hash. |
| `set_policy(delegator, policy_id, terms)` | Store editable policy terms under a policy id. |
| `get_policy(delegator, policy_id)` | Read stored policy terms. |
| `set_policies(delegator, policy_ids, terms_list)` | Batch-store policy terms. |
| `get_nonce(delegator)` | Current nonce for a delegator (replay protection). |
| `get_delegation_hash(delegation)` | Compute the canonical, domain-separated delegation hash. |
| `redeem_delegations(...)` | The execution path: validates the chain, resolves policies, enforces caveats, and invokes `execute_from_executor` on the root delegator's Smart Wallet. |

## Security model

- **Replay protection** via per-delegator nonces (`get_nonce`) and the domain-separated `get_delegation_hash`.
- **Editable policy indirection**: caveats can point at policy storage (`set_policy`/`get_policy`) instead of inlining terms, so terms change without invalidating the delegation's hash/signature.
- **Pause**: `pause()`/`unpause()` gate state-changing operations.

## Related

- [`custom-account`](../custom-account/README.md) — the Smart Wallet `redeem_delegations` ultimately calls.
- [`policies`](../policies/README.md) — the caveat enforcers invoked during redemption.
- [`packages/sdk` `delegation`/`policy` modules](../../../../packages/sdk/README.md) — off-chain building/signing of these structures.
