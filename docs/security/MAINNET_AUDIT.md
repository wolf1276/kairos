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

### Fix

Added `owner.require_auth()` in both `init()` functions, immediately after the
already-initialized guard and before any storage write. No API, storage-layout, or
deployment-flow change. This closes:

- Anonymous strangers initializing a wallet they hold no key for.
- Impersonation (setting `owner` to a victim's address without that victim's consent).
- A malicious/compromised sponsor or relayer silently substituting a different owner than
  the one the real owner authorized.

### Regression tests added

Per contract (custom-account + delegation-manager):

- `test_legitimate_init_succeeds_with_owner_auth`
- `test_unauthorized_init_is_rejected` — no auth at all → panics.
- `test_front_run_cannot_impersonate_a_different_owner` — attacker cannot set someone else
  as owner without that owner's signature.
- `test_double_initialization_is_rejected`

### Verification run

- Contract tests: custom-account 11/11, delegation-manager 18/18, policies 11/11, registry
  23/23 — all pass.
- Wasm build (`wasm32v1-none --release`, the real deploy target): all 4 contracts compile clean.
- SDK tests (`packages/sdk`): 34/34 pass (unaffected — no SDK code changed).
- Backend tests: 1488 passed / 123 failed / 38 skipped. All 123 failures are
  `better-sqlite3` native binding errors (no C++ build tools in the audit sandbox — pre-existing
  environment gap, unrelated to this change; every failing file is DB-backed, none touch
  contract init logic).
- Typecheck: SDK clean. Backend has 2 pre-existing, unrelated errors (unbuilt
  `@wolf1276/kairos-turnkey-signer` dist, a vitest mock-type mismatch in
  `priceHistory.test.ts`) — confirmed pre-existing, no backend files were touched by this fix.

### Remaining issue: residual self-claim race — **[open, recommended]**

**Severity: downgraded to P2 (griefing/DoS) by the fix above — was P0 before it.**

The fix stops impersonation (attacker cannot claim a wallet *as* someone else) but an
attacker can still front-run deployment by calling `init(attacker_own_address, manager)` on
someone else's freshly-deployed-but-uninitialized address, self-authorizing legitimately as
themselves. Soroban caps a transaction at exactly one Soroban operation (confirmed against
`@stellar/stellar-sdk`'s own RPC docs: "should include exactly one operation"), so true
atomicity requires either:

- Native constructors (`CreateContractV2`), which needs `@stellar/stellar-sdk` bumped from
  the pinned `14.6.1` to `16.x` in `packages/sdk` — out of scope for a minimal P0 patch given
  the blast radius of a major SDK version bump.
- A factory/deployer contract, which changes the deterministic address-derivation scheme
  (`buildDeployArtifacts`) that the frontend/backend currently rely on — an architecture
  change, not a minimal fix.

Practical impact of the residual: capped at griefing/DoS. `WalletModule.initializeWallet()`
already throws (`ExecutionFailedError`) rather than silently treating a hijacked address as
ready, so a lost race costs the victim a wasted deploy attempt (retry with a fresh salt), not
funds or a false sense of ownership.

**Recommendation:** scope a follow-up to bump `@stellar/stellar-sdk` to 16.x and migrate
`CustomAccount`/`DelegationManager` init to native constructors, closing this fully. Not
blocking for mainnet given the bounded impact.

---

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
