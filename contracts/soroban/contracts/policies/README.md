# policies

The composable caveat enforcement engine (the on-chain **PolicyEngine**). During delegation redemption the [delegation-manager](../delegation-manager/README.md) invokes these hooks; each enforces one class of constraint and **fails closed** — an undecodable amount or malformed terms aborts the execution rather than allowing it.

Part of the [Kairos Soroban contracts](../../README.md) workspace. 11 tests in [`src/test.rs`](./src/test.rs).

## Hooks (entrypoints)

| Hook | When | Role |
| :--- | :--- | :--- |
| `before_all` | Once, before executions | Validates policy `terms` shape per type. |
| `before_hook` | Before each execution | Enforces spend/target/time constraints (with storage access for accumulated spend). |
| `after_hook` | After each execution | Post-execution checks. |
| `after_all` | Once, after executions | Final enforcement. |

## Policy types

The policy type is encoded in `terms[0]` ([`src/lib.rs`](./src/lib.rs)):

| Tag | Policy |
| :--- | :--- |
| `1` | Target Whitelist |
| `2` | Spend Limit (token + i128 limit + period) |
| `3` | Time Restriction (start/expiry) |
| `4` | Target-Function-Set Whitelist |
| `5` | Pooled Protocol Spend Limit (validated in `before_hook`, needs storage) |

## State keys

`PolicyStateKey`, keyed by delegation hash: `Spent`, `LastSpentTime`, `PooledSpent`, `PooledLastSpentTime`.

## Errors

`Error`: `NotAuthorized = 1`, `TargetNotAllowed = 2`, `SpendLimitExceeded = 3`, `TimeRestrictionActive = 4`, `InvalidTerms = 5`, `AmountDecodeFailed = 6`.

> [!IMPORTANT]
> `AmountDecodeFailed` is a deliberate **fail-closed** control: if a spend amount can't be decoded (e.g. an unexpected Blend `submit(Vec<Request>)` shape), the policy aborts instead of treating the spend as zero — closing a bypass.

## Related

- [`delegation-manager`](../delegation-manager/README.md) — invokes these hooks during `redeem_delegations`.
- [`packages/sdk` `policy` module](../../../../packages/sdk/README.md) — encodes/decodes these term byte-layouts off-chain (all 5 types).
