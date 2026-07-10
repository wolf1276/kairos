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

## P0-3 — Live role/quant/limit trading bypasses Smart Wallet custody — **[fixed]**

**Severity: P0 (confirmed exploitable in production, no special conditions — every live trade
after initial funding).**
**Backend: `backend/src/tick.ts`, `backend/src/roleTick.ts`.**
**Investigated: 2026-07-10.**

### Executive summary

Two live-mode execution paths never went through `CustomAccount.execute()` /
`execute_from_executor()` / `DelegationManager.redeem_delegations()` — they built, signed
(via the agent's own Turnkey-MPC key), and submitted classic Stellar path-payment operations
**directly to Horizon**, entirely outside Smart Wallet / Delegation / Policy custody. This
affected every live quant/limit-strategy agent, and every live role agent (`strategic`,
`balancer` always; `yield` whenever `ENABLE_PROTOCOL_EXECUTION` was unset, the default).

### Root cause

- `backend/src/tick.ts` — `executeQuantTrade` (quant strategy, live mode) and
  `executeLimitOrder` (limit strategy, live mode) used `@stellar/stellar-sdk`'s
  `TransactionBuilder` + `Operation.pathPaymentStrictSend/StrictReceive`, signed via
  `getAgentSigner(row)` (Turnkey), and called `server.submitTransaction` on Horizon directly.
- `backend/src/roleTick.ts` — `runRoleTick`'s fallback branch called the same
  `executeQuantTrade` for every live role-agent trade except `yield` with
  `ENABLE_PROTOCOL_EXECUTION=true`.

Real user capital does reach the agent's own account in production: the "Add Agent" flow
(`apps/web/app/dashboard/agents/AgentCreationWizard.tsx`) registers a spend-limit delegation,
then calls `withdrawFromSmartWallet(...)` to move capital out of the smart wallet into the
agent's raw Turnkey Stellar address before the agent starts. That one-time withdrawal is
correctly owner-authorized and delegation-bounded — but the delegation only gates the
one-time transfer. Every subsequent trade moved that capital via a raw Horizon transaction
the backend signed unilaterally: no further on-chain Delegation validation, no on-chain
Policy enforcement (spend limits / target whitelist / time restriction) ever ran again for
that capital. The only remaining guardrails were backend-DB, soft, mutable checks
(`capabilityGate`/`allocationGate`/`maxSlippagePct`), not cryptographic ones — despite the UI's
claim that the agent "will only ever be able to spend from your smart wallet, up to the limit."

### Verified

1. Direct backend execution outside Smart Wallet — confirmed (`tick.ts` built and submitted
   classic Stellar ops via `@stellar/stellar-sdk` directly, not `client.execution.execute`).
2. Skips Delegation validation — confirmed (on-chain `redeem_delegations` never invoked for
   the trade itself).
3. Skips Policy enforcement — confirmed (on-chain `policies` contract never invoked).
4. Moves user funds without ongoing Smart Wallet authorization — confirmed, for every trade
   after the initial funding transfer.
5. Legacy path bypassing custody — confirmed; the code's own comments call it the "legacy
   spot-trade path," and `protocolExecutionService.ts`'s header independently corroborates it
   ("unlike the legacy direct-custody trading loop (executionEngine.ts) which trades from the
   agent's own Turnkey-signed keypair").
6. Reachable in production — confirmed (real funding flow traced end to end, not
   dead/unreachable code).
7. SDK-level bypass — none found. `packages/sdk/src/execution/index.ts`'s `execute()` always
   routes through `redeem_delegations`; no SDK call invokes a protocol contract directly.
8. `protocolAdapters/*/realTransactionBuilder.ts` (blend/soroswap/phoenix/aquarius) — confirmed
   safe. They only build unsigned XDR (no `signTransaction`/`submitTransaction`/
   `getAgentSigner` calls anywhere in that directory) and feed the delegation-routed SDK path,
   not a raw-signing fallback.
9. Other feature flags — swept `backend/src/config.ts`; `ENABLE_PROTOCOL_EXECUTION` is the only
   execution-routing flag. The rest (network, port, DB path, JWT secret, dev allowlist, etc.)
   are unrelated to trade execution.

### Proof of exploit

1. Static trace: funding flow (`provisionService.ts` comment + `AgentCreationWizard.tsx` +
   `stellar.ts`'s `withdrawFromSmartWallet`) → capital lands in the agent's own Turnkey account
   → `executeQuantTrade`/`executeLimitOrder` sign and submit against Horizon directly.
2. `backend/src/__tests__/roleTickProtocolExecution.test.ts`'s pre-existing test ("falls back
   to the legacy spot-trade path when protocol execution is disabled") was already passing
   **before any fix**, proving the buggy behavior: a live `role: 'yield'` agent with
   `ENABLE_PROTOCOL_EXECUTION` unset called `executeQuantTrade`, not `executeProtocolAction`.
3. `roleTick.ts`'s `useProtocolExecution = config.role === 'yield' && ...` confirms
   `strategic`/`balancer` roles had no protocol-execution branch at all — they always hit the
   legacy path in live mode regardless of the flag.

### Fix

Block the unsafe live path rather than retrofit classic-Stellar path payments into the
Soroban delegation/policy pipeline (`execute`/`execute_from_executor` only invoke Soroban
contract functions, not classic DEX path payments — a genuine architecture change, out of
scope). Paper mode is unaffected (never moves real funds); DCA and yield-with-protocol-
execution (the already-safe, delegation-routed paths) are unaffected.

- **`backend/src/tick.ts`**: `executeQuantTrade` (still exported, same signature) and
  `executeLimitOrder` (private) now throw immediately with a clear, auditable message before
  any account load, signing, or submission. Removed the now-dead Horizon-specific
  implementation and its unused imports.
- **`backend/src/roleTick.ts`**: added a `legacyPathBlocked = row.mode === 'live' &&
  !useProtocolExecution` gate, folded into `willExecute` (same pattern as the existing
  `delegationBlocks` gate), producing a clean `executionResult = 'blocked:custody'` decision
  record instead of relying solely on the caught exception from `tick.ts`. The `tick.ts` throw
  remains as defense in depth for any future caller that reaches `executeQuantTrade` directly.
- `routes/agents.ts`'s `/trades/:tradeId/reverse` endpoint calls the same `executeQuantTrade`
  for live mode — covered by the same throw, no separate fix needed.

### Files modified

- `backend/src/tick.ts`
- `backend/src/roleTick.ts`
- `backend/src/__tests__/roleTickProtocolExecution.test.ts` (rewrote the test asserting the
  vulnerable fallback to assert blocking; added coverage for `strategic`-role blocking and
  paper-mode non-regression)

### Tests added

- `backend/src/__tests__/roleTickProtocolExecution.test.ts` — 5 tests: yield routes through
  `executeProtocolAction` when enabled; live reallocation blocked (not routed to legacy) when
  disabled; paper mode never uses `executeProtocolAction`; live `strategic` blocked even with
  the flag on (no route exists for that role); paper-mode `strategic` unaffected.
- `backend/src/__tests__/p0-3-liveCustodyBypass.test.ts` (new) — 5 tests: `executeQuantTrade`
  rejects immediately with the custody error; `runQuantTick`/`runLimitTick` in live mode fail
  cleanly with `recordCompletedTrade` never called; `runQuantTick`/`runLimitTick` in paper mode
  execute normally (regression: legitimate path unaffected).

### Verification run

- Backend tests: full suite, `backend/node_modules/.bin/vitest run` — 79 files passed, 5
  pre-existing skips (real-DB tests, same sandbox gap as P0-1/P0-2/P1-3), 1650/1650 passing.
- Backend typecheck (`tsc --noEmit`): one pre-existing, unrelated error in
  `priceHistory.test.ts` (a `fetch` mock type mismatch); confirmed present on `main` before
  this change via `git stash`, untouched by this fix.
- Production build (`tsup`): clean, `dist/index.js` built successfully.
- SDK: confirmed (read-only) that `execute()` always routes through `redeem_delegations`; no
  SDK or contract code changed by this fix, so SDK/contract test suites are unaffected.

### Remaining issues

Blocking live trading for `strategic`/`balancer` roles (and `quant`/`limit` legacy strategies)
is a real **product capability regression**, not just a narrow patch — those roles currently
have no safe replacement (unlike `yield`, which already has `executeProtocolAction`/Blend).
This was judged the correct "smallest safe fix" given the hard invariant (funds must always
remain under Smart Wallet custody) and matches this doc's own P0-2 precedent (fully removing
the unsafe branch rather than patching it in place). **Live `strategic`/`balancer` role agents,
and any live `quant`/`limit` strategy, will fail every tick cleanly (with a clear audit-trail
reason)** until a Smart-Wallet-custodied swap route is built for them (e.g. extending the
`soroswap` protocol adapter the way `blend` was extended for the `yield` role). That follow-up
work is out of scope for this fix.

---

## P1-3 — Malformed Registry RPC response read as "wallet not found" — **[fixed]**

**Severity: P1 (exploitable only under a specific RPC-response shape, not every RPC failure;
fail-open outcome is a duplicate/orphaned smart-wallet deploy, not a fund-drain).**
**Packages: `packages/sdk` (`RegistryModule.getSmartWallet`).**
**Investigated: 2026-07-10.**

### Scope and starting hypothesis

Given hypothesis (from an external audit note, not trusted going in): "Registry/RPC failures
can be interpreted as wallet-not-found, allowing `Create Smart Wallet` to run for an owner who
already has one." Investigated every path from a Registry lookup to a `Wallet Found` /
`Wallet Not Found` / `Registry Error` verdict, without modifying any code until a concrete
failure was reproduced with a test.

### What was already correct (not a bug, verified not just assumed)

An earlier pass (commit `baa0d2a`, "WIP: mainnet readiness fixes") had already hardened most of
this path and left comments/tests documenting it:

- `RegistryModule.getSmartWallet` (`packages/sdk/src/registry/index.ts`) wraps the simulate call
  in try/catch and rethrows any `KairosError` or wraps any other throw as `RpcError` — RPC
  timeout, RPC unavailable, network error, and simulation failure (`TransactionSimulationError`)
  all throw, never return `null`.
- `apps/web/app/lib/sdk/registry.ts`'s `lookupRegistry` passes those throws straight through.
- `apps/web/app/api/connect/check/route.ts` catches that throw and returns an explicit
  `{status: "error"}` / HTTP 502 — never `{status: "new"}`.
- `apps/web/app/hooks/useSmartWallets.ts`'s `mergeSmartWallets` treats a thrown/failed Registry
  check as `checkFailed: true`, distinct from a confirmed-empty result.
- `apps/web/app/api/delegate-sdk/route.ts`'s `PREPARE_WALLET_DEPLOY` handler calls
  `lookupRegistry` as a hard gate before deploying; a throw there is uncaught inside the handler
  and falls through to the route's outer catch, which returns HTTP 500 — `ensureFundedTestnetAccount`
  and `prepareSponsoredDeploy` are never reached.

All of the above were re-verified with new/existing tests in this pass (see "Regression tests
added"), not just re-read — every scenario in "Verified" below has a passing test that would fail
if the fail-open behavor regressed.

### Root cause (the part that was still broken)

`RegistryModule.getSmartWallet` determined "no wallet" using:

```ts
const retval = simRes.result?.retval;
if (!retval || retval.switch().name === 'scvVoid') {
  return null;
}
```

`rpc.Api.isSimulationSuccess` (from `@stellar/stellar-sdk`) only checks `"transactionData" in
sim` — it does not require `result` to be present. The SDK's own response parser
(`parseSuccessful` in `@stellar/stellar-sdk/lib/rpc/parsers.js`) omits the `result` field
entirely whenever the raw RPC response's `results` array is empty (`sim.results.length === 0`)
instead of containing exactly one entry for the one operation being simulated — a malformed or
incomplete response shape (e.g. from a degraded RPC node, misbehaving proxy/load balancer, or a
partial/interrupted response) that is still `"transactionData" in sim === true`, i.e. still
classified as a *successful* simulation.

In that case `simRes.result` is `undefined`, so `simRes.result?.retval` is `undefined`, and the
`!retval` branch fires — collapsing "the response didn't actually tell us anything" into the
same `return null` as "the contract explicitly confirmed no registration" (a real `scvVoid`).
That `null` is Registry's canonical "wallet not found" signal to every caller in the chain above.

### Verified

Confirmed at the type-guard level and via the real (not mocked-away) `@stellar/stellar-sdk`
parsing code, then reproduced against the actual `getSmartWallet` method:

```
isSimulationSuccess({ transactionData: {}, latestLedger: 100 })  // no `result` key
  -> true
```

A test that mocks `simulateTx` to resolve with exactly that shape
(`{ latestLedger: 100, transactionData: {} }`, no `result`) made `getSmartWallet` resolve to
`null` pre-fix — confirmed failing before the fix, confirmed passing (throws `RpcError`) after.

For each failure mode in scope, the verdict `getSmartWallet` (and everything downstream of it)
now produces:

| Failure mode | Verdict |
| --- | --- |
| Wallet registered, simulation succeeds with a real address | Wallet Found |
| Simulation succeeds with `result.retval` = `scvVoid` | Wallet Not Found |
| RPC timeout | Registry Error (throws `RpcError`) |
| RPC unavailable / connection refused | Registry Error (throws `RpcError`) |
| Simulation failure (contract trap / non-success sim response) | Registry Error (throws `TransactionSimulationError`) |
| Horizon/RPC 5xx surfaced as a thrown error during simulate | Registry Error (throws `RpcError`) |
| Invalid/unconfigured Registry contract ID | Registry Error (throws `RpcError`, before any RPC call) |
| Network error (e.g. `ETIMEDOUT`) | Registry Error (throws `RpcError`) |
| Malformed response (`transactionData` present, `result` missing) | Registry Error (throws `RpcError`) — **was Wallet Not Found pre-fix** |

`Registry Error` never reaches `PREPARE_WALLET_DEPLOY`'s deploy step — verified via the
route-level regression test (below), which asserts `ensureFundedTestnetAccount` and
`prepareSponsoredDeploy` are not called when the Registry lookup throws.

### Fix

`packages/sdk/src/registry/index.ts`: added an explicit `if (!simRes.result) throw new
RpcError(...)` check before reading `retval`, so a `result`-less "success" response is treated as
an ambiguous/malformed answer (must throw) rather than folded into the same branch as a
confirmed `scvVoid`. Smallest possible change — no change to the method's public signature, no
change to any caller, no change to the `scvVoid` → `null` mapping for an actually-confirmed empty
result.

### Regression tests added

`packages/sdk/src/registry/index.test.ts`:
- `P1-3: malformed response (transactionData present, no result entry) must throw, not return
  null` — the direct repro/regression test for the root cause above.
- `invalid contract ID: Registry contract not configured throws before any RPC call`.
- `Horizon/RPC 5xx surfaced during simulation throws, never returns null`.

Plus pre-existing coverage in the same file for wallet-found, wallet-not-found (real `scvVoid`),
RPC failure, simulation failure, and network timeout.

`apps/web/app/api/delegate-sdk/route.test.ts`:
- `P1-3: Registry lookup failure (RPC/timeout/malformed) must never fall through to deploy` —
  asserts a thrown Registry lookup during `PREPARE_WALLET_DEPLOY` returns HTTP 500 and never
  calls `ensureFundedTestnetAccount` / `prepareSponsoredDeploy`.

### Verification run

- SDK tests (`packages/sdk`): 37/37 pass, including 9/9 in `registry/index.test.ts` (up from 6).
- Web app tests (`apps/web`): 33/33 pass across all suites, including 12/12 across
  `delegate-sdk/route.test.ts` + `connect/check/route.test.ts`.
- SDK typecheck (`tsc --noEmit`): clean.
- Web app typecheck (`tsc --noEmit`): clean (after clearing a stale, gitignored
  `.next/dev/types` cache referencing an already-removed route — unrelated to this change).
- Backend: no backend TypeScript changed by this fix. `backend/src` typecheck and test run both
  hit pre-existing, unrelated environment gaps in this sandbox — `better-sqlite3` native bindings
  not built for the installed Node version (same gap noted in P0-1/P0-2) and an unbuilt workspace
  package `@wolf1276/kairos-turnkey-signer` — neither touches Registry/wallet-lookup code.

### Remaining issues

None for the Registry-lookup fail-open behavior itself. Previously noted here but out of scope
for this finding: `Address.fromScVal(retval)` (same file, success path) used to throw a plain
`TypeError` rather than an `RpcError` if a *present* `result.retval` was some other non-address,
non-void `ScVal` (verified via direct probing: `scvU32`/`scvBool`/`scvString`/`scvVec`/`scvMap`
all threw `TypeError address not set`). This always failed closed (threw, never returned `null`),
so it never reproduced the P1-3 fail-open behavior — it was a minor error-classification
inconsistency, not a security bug. **Fixed 2026-07-10**: the call is now wrapped in a try/catch
that normalizes any thrown error into the existing `RpcError`, matching every other Registry
failure mode in the table above. See `packages/sdk/src/registry/index.ts` (the
`Address.fromScVal` call at the end of `getSmartWallet`) and the
`malformed retval (present but not an Address ScVal) throws RpcError, not a raw TypeError` test
in `packages/sdk/src/registry/index.test.ts`.

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
