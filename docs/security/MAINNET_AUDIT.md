# Mainnet Readiness Audit

Findings from pre-mainnet security review of `contracts/soroban`, `packages/sdk`, and the
deployment tooling that creates/initializes those contracts. Findings are numbered `P<severity>-<n>`
(P0 = exploitable now, no special conditions; P1 = exploitable under specific conditions or with
lower blast radius; P2 = hardening / defense-in-depth). Each finding records what was verified,
how it was reproduced, the fix applied, and what (if anything) remains open.

---

## P0-1 — Unauthenticated `init()` / front-run ownership takeover — **[fixed]**

**Severity: P0 (confirmed exploitable, no special conditions).**
**Contracts: `custom-account`, `delegation-manager`.**
**Investigated: 2026-07-10.**

### Root cause

`CustomAccount::init` (`contracts/soroban/contracts/custom-account/src/lib.rs`) and
`DelegationManager::init` (`contracts/soroban/contracts/delegation-manager/src/lib.rs`) only
guarded against re-initialization (`AlreadyInitialized` / `NotAuthorized` panic on a second
call). Neither called `.require_auth()` on the `owner` parameter — unlike `execute()`, which
does. Deployment and initialization are two separate transactions in every real flow
(`WalletModule.create`, `WalletModule.submitSponsoredDeploy` in `packages/sdk/src/wallet/index.ts`,
and `scripts/deploy-testnet.ts`'s deploy-then-invoke CLI pair), and the target contract address
is deterministic and computed client-side (`buildDeployArtifacts`) before either transaction is
submitted. This left a real on-chain window where the contract exists, uninitialized, at a known
address, and `init()` would accept an `owner` argument from anyone.

Registry's own `init()` (`contracts/soroban/contracts/registry/src/lib.rs`) already called
`admin.require_auth()` and was never vulnerable to this.

### Verified

1. `init()` callable by anyone — confirmed, no auth call existed in either function.
2. Owner/admin authentication missing — confirmed.
3. Deploy and init in separate transactions — confirmed in all three flows listed above.
4. Front-runnable — confirmed: real on-chain window between the two transactions.
5. Contract address deterministic before init — confirmed, computed client-side from
   owner + wasm hash + salt before submission.
6. Ownership stealable — confirmed via proof-of-concept (below).

### Proof of exploit

Reproduced at the contract level (`soroban-env-host` 22.1.3, not mocked assertions):

- Register the contract (mirrors on-chain deploy: exists, uninitialized).
- Attacker calls `init(attacker, manager)`, self-authorizing only their own address.
- Legitimate owner's `init(legit_owner, manager)` then panics `AlreadyInitialized`.
- Storage read confirms `Owner == attacker`, not `legit_owner`.

Kept in the test suite (still passing, by design — see Remaining Issues) as
`test_exploit_front_run_init_steals_ownership_pre_fix` (custom-account) and
`test_exploit_manager_front_run_init_steals_ownership_pre_fix` (delegation-manager).

### Fix (part 1)

Added `owner.require_auth()` in both `init()` functions, immediately after the
already-initialized guard and before any storage write. This closed impersonation, but left
a residual race — see below, closed in part 2.

### Regression tests added (part 1)

Per contract (custom-account + delegation-manager): `test_legitimate_init_succeeds_with_owner_auth`,
`test_unauthorized_init_is_rejected`, `test_front_run_cannot_impersonate_a_different_owner`,
`test_double_initialization_is_rejected`. (These were subsequently rewritten in part 2 below
to register via constructor instead of a separate `init` call — same assertions, same
coverage, since `init` no longer exists as a standalone function.)

---

## P0-1 (continued) — residual self-claim race — **[fixed]**

**Severity: was P2 (griefing/DoS) after part 1's fix — P0 before that.**
**Contracts: `custom-account`, `delegation-manager`.**
**Investigated: 2026-07-10.**

### Root cause

Part 1's `owner.require_auth()` stopped impersonation but not self-claim: deploy
(`CreateContract`) and init were still two separate transactions in every real flow
(`WalletModule.create`, `submitSponsoredDeploy`, `scripts/deploy-testnet.ts`), and the
target address is deterministic and known before either transaction lands. An attacker
who observes the pending deploy could front-run the second (`init`) transaction with
`init(attacker_own_address, manager)` — self-authorizing legitimately as themselves, since
nothing in `init()` ties the call to who the deploy transaction actually intended as owner.
Reproduced (contract-level, `soroban-env-host` 22.1.3, not mocked assertions) as
`test_exploit_front_run_init_steals_ownership_pre_fix` / the manager equivalent, prior to
this fix (both removed now that the two-transaction window they depended on no longer
exists — see "Regression tests" below).

### Investigated: is atomic deploy+init possible on the current stack?

Yes — confirmed by reading the actual pinned dependency source, not assumed:

- **Rust side**: `soroban-sdk = "22.0.1"` (resolves to `22.0.11` in `Cargo.lock`) fully
  supports constructors — a function named exactly `__constructor`, invoked by the host as
  part of contract creation (`soroban-env-host-22.1.3::host::lifecycle::call_constructor`,
  `CONSTRUCTOR_SUPPORT_PROTOCOL = 22`).
- **JS SDK side**: `@stellar/stellar-sdk` is pinned to `^14.6.1`. A prior pass at this
  investigation assumed this needed bumping to `16.x` — **that assumption was wrong and was
  never verified against the installed package.** Inspecting the actually-installed
  `14.6.1` shows `Operation.createCustomContract`, `xdr.CreateContractArgsV2`, and
  `xdr.HostFunctionType.hostFunctionTypeCreateContractV2` are all already present and
  functional. No SDK version bump is needed or was made.

So a factory/deployer contract was not needed either — native constructors close this
completely on the current stack with no dependency changes.

### Chosen fix

Renamed `init` → `__constructor` in both `CustomAccount` and `DelegationManager`
(`contracts/soroban/contracts/{custom-account,delegation-manager}/src/lib.rs`), body
otherwise unchanged (same re-init guard, same `owner.require_auth()`, same storage writes).
The host now invokes this as part of the single `CreateContractV2` operation that creates
the contract — there is no longer any on-chain state where the address exists but is
unowned, because the address does not exist until construction (including the auth check)
has already completed as part of the same operation.

This also holds under sponsorship (funder ≠ owner): per
`soroban-env-host::host::lifecycle::create_contract_with_optional_auth`, creating a contract
at all requires an authorization from the address embedded in the contract-id preimage (the
intended owner), independent of and in addition to whatever the constructor itself checks —
so an attacker who doesn't hold the real owner's key cannot create a competing contract at
that deterministic address regardless of what constructor args they'd supply.

`packages/sdk/src/wallet/index.ts` (`WalletModule`) updated to match: `buildDeployArtifacts`
now builds `CreateContractArgsV2` with `constructorArgs: [owner, delegationManager]` via
`Operation.createCustomContract`'s host-function shape, instead of the old
`CreateContractArgs` (no constructor). `create()` and `submitSponsoredDeploy()` now submit
one transaction and return — the old post-deploy `initializeWallet()` retry loop (which
called the separate `init` transaction, up to 4 attempts with a 5s backoff) is deleted
entirely, since there is nothing left to retry. Public method signatures on `WalletModule`
are unchanged. `scripts/deploy-testnet.ts` updated the same way: `--owner` /
`--delegation_manager` are now passed as constructor args on the `stellar contract deploy`
command itself, and the separate `stellar contract invoke -- init ...` steps for these two
contracts are removed. (`Registry` is untouched — it was never vulnerable, see part 1.)

### Regression tests

Both contracts' test suites were rewritten to register via constructor
(`env.register(CustomAccount, CustomAccountArgs::__constructor(&owner, &manager))`) instead
of registering uninitialized and calling `init` after. Per contract:

- **Normal / self deploy**: `test_legitimate_init_succeeds_with_owner_auth` /
  `test_manager_legitimate_init_succeeds_with_owner_auth` — construction with the owner's
  own auth succeeds, storage reads back correctly.
- **Front-run / self-claim attempt**: `test_unauthorized_init_is_rejected` /
  `test_manager_unauthorized_init_is_rejected` — no mocked auth at all, so `env.register(...)`
  itself panics. This is the direct proof that bringing the contract into existence at all
  now requires the claimed owner's authorization — there's no separate, unauthenticated step
  left to race.
- **Impersonation attempt** (a front-run trying to set someone *else* as owner):
  `test_front_run_cannot_impersonate_a_different_owner` /
  `test_manager_front_run_cannot_impersonate_a_different_owner` — attacker mocks only their
  own auth via `env.register_at` + `MockAuth{ fn_name: "__constructor", .. }`, panics.
- **Double init**: `test_double_initialization_is_rejected` /
  `test_manager_double_initialization_is_rejected` — `__constructor` remains an ordinary,
  separately-callable function after creation (the host does not block re-invoking it), so a
  second direct call is exercised explicitly (`env.as_contract(&id, || Contract::__constructor(...))`)
  and confirmed still rejected by the re-init guard.
- **Sponsored deploy**: covered at the SDK layer, not the contract layer — the contract has
  no notion of "who paid"; `WalletModule.prepareSponsoredDeploy`/`submitSponsoredDeploy` were
  code-reviewed and updated to build the same `CreateContractV2` op with `constructorArgs`,
  simulate for the owner's auth entry (now covering both contract creation and the nested
  `owner.require_auth()` inside `__constructor`, since Soroban auth entries are per-address
  across the whole invocation tree, not per call), sign, and submit as one transaction.

### Verification run

All actually executed (not asserted) in this sandbox, native tests worked around a
Windows-only, environment-specific limitation (below) — this is the same class of
environment gap as the pre-existing `better-sqlite3` native-binding failures noted in part 1,
not a code issue:

- **Contract tests**: 61/61 pass — custom-account 10/10, delegation-manager 17/17, policies
  11/11, registry 23/23. (Native `cargo test` on this Windows sandbox hits an unrelated,
  pre-existing GNU-linker limit — "export ordinal too large" — building these crates'
  `cdylib` output, since `soroban-env-host`'s dependency closure exceeds the 65535-symbol
  Windows PE export-table limit; this is a Windows-DLL-specific ceiling that does not exist
  on Linux/macOS CI. Worked around by temporarily dropping `cdylib` from
  `crate-type` in all 4 contracts' `Cargo.toml` for the test run only, then restoring them —
  confirmed via `git status` / `git diff` showing zero net change to those files.)
- **Wasm build**: `cargo build --release --target wasm32v1-none` for all 4 contracts —
  compiles clean, produces `custom_account.wasm`, `delegation_manager.wasm`,
  `policies.wasm`, `registry.wasm`. This is the real deploy target and was not touched by
  the native-test workaround above.
- **SDK typecheck**: `tsc --noEmit` in `packages/sdk` — clean.
- **SDK build**: `tsup` — clean (CJS + ESM + `.d.ts`).
- **SDK tests**: 34/34 pass (`packages/sdk`'s own vitest suite; `vitest` wasn't hoisted into
  this sandbox's `node_modules` until `pnpm install --filter @wolf1276/kairos-sdk` was run —
  a one-time environment gap, not a code issue).

### Remaining issues

None open for this finding. `Registry` was never in scope (already required
`admin.require_auth()`, never had a separate uninitialized-deploy window — see part 1).

## P0-2 — Empty delegation chain bypasses Delegation Policy — **[fixed]**

**Severity: P0 (confirmed exploitable, no special conditions).**
**Contracts: `delegation-manager` (with `custom-account` as the drained target).**
**Investigated: 2026-07-10.**

### Root cause

`DelegationManager::redeem_delegations` (`contracts/soroban/contracts/delegation-manager/src/lib.rs`)
special-cased a zero-length delegation chain. Phase 1 (validation) `continue`d past every
signature, nonce, authority, and duplicate-hash check; phase 2 (execution) then invoked the
paired call **directly from the DelegationManager**, skipping the entire
`before_all`/`before_hook`/`after_hook`/`after_all` policy pipeline that non-empty chains run.
The only gate on the whole path was `redeemer.require_auth()` — satisfied by the attacker's own
signature.

Because `CustomAccount::execute_from_executor` authorizes solely on
`delegation_manager.require_auth()` (auto-satisfied whenever the manager is the direct caller),
an attacker sets the empty-chain execution to target a *victim* wallet's `execute_from_executor`
and turns the manager into a confused deputy: any wallet on this manager was drainable by anyone,
with no delegation, no victim signature, and zero policy enforcement.

### Verified

1. `redeem_delegations` callable with an empty chain — confirmed (the `chain.len() == 0` branch).
2. Authorization required — only `redeemer.require_auth()`, i.e. the attacker's own key.
3. Principal executing the downstream call — the **DelegationManager** (via `env.invoke_contract`).
4. Empty chain bypassed **all** of: policy validation, caveats, spend limits, permission checks,
   capability checks, and delegation validation — confirmed.
5. Reachable without the SDK — confirmed. The SDK's `validateDelegationChains`
   (`packages/sdk/src/execution/index.ts`) rejects empty chains client-side only; it is not an
   on-chain boundary.
6. Reachable via a raw Soroban `invoke_contract` transaction — confirmed.
7. Moves funds / invokes arbitrary contracts — confirmed, via the `execute_from_executor`
   confused-deputy route.
8. Reachable in production — confirmed.

### Proof of exploit

Reproduced at the contract level (`soroban-env-host`, not mocked assertions). Real
`CustomAccount` wallet + real SAC token; auth scoped with `mock_auths` to **only the attacker**
to prove the victim signs nothing. Pre-fix: wallet balance `500_000_000 → 0`, attacker
`0 → 500_000_000`. The PoC is retained as the regression test
`test_empty_chain_confused_deputy_drain_is_rejected` (now asserting rejection).

### Fix

Reject empty chains in phase 1 with `ManagerError::EmptyChain` (releasing the reentrancy guard
first, matching every other early-exit), and remove the phase-2 direct-invoke branch. Every
execution is now backed by at least one validated delegation. A caller wanting a no-delegation
self-execution uses their own wallet's `execute()`, not this path. No public-API, storage-layout,
delegation-architecture, or SDK change (the new error is appended; existing discriminants are
unchanged).

### Regression tests added

In `contracts/soroban/contracts/delegation-manager/src/test.rs`:

- `test_empty_chain_confused_deputy_drain_is_rejected` — the exploit payload now reverts with
  `EmptyChain` and moves zero funds.
- `test_empty_chain_in_batch_rejects_entire_batch` — an empty chain mixed with a valid one
  reverts the whole batch; the valid chain's nonce is untouched.

Existing coverage exercises the rest of the matrix (valid chain succeeds, policy + spend-limit
enforced, invalid-signature / disabled / replay rejected, SDK-side empty-chain rejection).

### Verification run

- Contract tests: delegation-manager 20/20, custom-account 11/11, policies 11/11, registry 23/23
  — all pass.
- Wasm build (`wasm32v1-none --release`): all contracts compile clean; no warnings in
  `delegation-manager`.
- SDK tests (`packages/sdk`): 34/34 pass (unaffected — no SDK code changed). SDK typecheck
  (`tsc --noEmit`): clean.
- Backend: no TS changed; the backend only ever sends non-empty `[[delegation]]`
  (`backend/src/protocolExecutionService.ts`). Pre-existing `better-sqlite3` native-binding
  failures in the audit sandbox are unrelated (same environment gap noted in P0-1).

### Remaining issues

None. The removed branch had no legitimate caller (SDK rejects empty chains; backend sends
non-empty), so nothing depends on the old behavior.

---

## Template for future findings

```
## P<severity>-<n> — <title> — **[fixed | recommended | open]**

**Severity: ...**
**Contracts/packages: ...**
**Investigated: YYYY-MM-DD.**

### Root cause
### Verified
### Proof of exploit
### Fix
### Regression tests added
### Verification run
### Remaining issues
```
