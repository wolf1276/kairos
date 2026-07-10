# P0-3 — Live role/quant/limit trading bypasses Smart Wallet custody — **[IN PROGRESS, not committed]**

Handoff note for continuing this investigation in a new session. This is *not* an audit-doc-final
entry yet — treat everything below as a working state, not a closed finding. Nothing in this
branch has been committed. `git status` currently shows:

```
 M backend/src/__tests__/roleTickProtocolExecution.test.ts
 M backend/src/roleTick.ts
 M backend/src/tick.ts
```

## Task brief (what was asked)

Investigate ONLY P0-3: verify no execution path can bypass Smart Wallet → Delegation → Policy →
Execution. Do not trust the audit doc (it doesn't even have a P0-3 entry — this finding was
discovered fresh, not pulled from `docs/security/MAINNET_AUDIT.md`). Reproduce before fixing.
Smallest safe fix, preserve architecture, no API redesign. Deliver: Executive Summary, Root
Cause, Proof of Exploit, Files Modified, Tests Added, Verification, Remaining Issues.

## Status of the 6-step plan (see TaskList — same IDs live in this session's task tracker)

1. **[done]** Audit contract-level execution paths (custom-account, delegation-manager, policies).
   Post-P0-2-fix, the contract layer is clean: `redeem_delegations` rejects empty chains, single
   call site for `execute_from_executor`, full validation → before_all/before_hook → execute →
   after_hook/after_all. **No further contract work needed for P0-3** — the bug is entirely in
   the backend, not the Soroban contracts.
2. **[not started]** Audit SDK execution paths (`packages/sdk/src/execution`, `wallet`,
   `delegation`, `protocols`). Given the finding below is a backend-only bypass (raw Horizon
   calls that never touch the SDK's `client.execution.execute`), this is lower priority, but
   still worth a pass to be thorough — confirm no SDK-level call can invoke a protocol contract
   directly without going through `DelegationManager`.
3. **[in progress]** Audit backend execution paths. The finding below (root cause) came from
   this pass. Not yet done: `protocolAdapters/*/realTransactionBuilder.ts` (soroswap/blend/
   phoenix/aquarius) — these are the *safe*, delegation-routed protocol-execution builders used
   by `executeProtocolAction`; worth a quick confirm-only pass that none of them also has a
   raw-signing fallback, but I have no specific reason to suspect them (they were built
   specifically to feed `DelegationManager.redeem_delegations` via the SDK).
4. **[not formally separated, but covered]** Feature-flag/legacy-path audit: `ENABLE_PROTOCOL_EXECUTION`
   (`isProtocolExecutionEnabled()`) is the flag in question — see root cause below. No other
   flags found yet; not exhaustively searched (only grepped `ENABLE_PROTOCOL_EXECUTION` and
   `ENABLE_PROTOCOL_EXECUTION`-adjacent names). Worth a broader grep for other `ENABLE_*`/`DEBUG`
   env vars in `backend/src/config.ts` before calling this done.
5. **[done for the finding below]** Reproduced (see "Proof" section) via an already-existing,
   already-passing test (`roleTickProtocolExecution.test.ts`, the "falls back to the legacy
   spot-trade path" test, pre-fix) plus static trace of the funding flow. Not yet done: a direct
   unit test against `tick.ts`'s `executeQuantTrade`/`runQuantTick`/`runLimitTick` (see "Next
   steps" — this is what was being written when the session was interrupted).
6. **[partially done]** Fix implemented (see "Fix" below) and one test file updated/extended.
   **Not done**: the dedicated `tick.ts` regression test, the full verification run (contract
   tests, SDK tests, full backend suite, typecheck, production build), and the final
   Executive-Summary-format writeup requested by the task brief.

## Root cause (confirmed, not hypothesis)

Two live execution paths never went through `CustomAccount.execute()` /
`execute_from_executor()` / `DelegationManager.redeem_delegations()` at all — they built, signed,
and submitted **classic Stellar operations directly to Horizon**, signed by the agent's own
Turnkey-MPC key, entirely outside Smart Wallet / Delegation / Policy:

- `backend/src/tick.ts` — `executeQuantTrade` (quant strategy, live mode) and `executeLimitOrder`
  (limit strategy, live mode). Both used `@stellar/stellar-sdk`'s `TransactionBuilder` +
  `Operation.pathPaymentStrictSend/StrictReceive`, signed via `getAgentSigner(row)` (Turnkey), and
  called `server.submitTransaction` on Horizon directly.
- `backend/src/roleTick.ts` — `runRoleTick`'s fallback branch (`willExecute && side` without
  `useProtocolExecution`) called the *same* `executeQuantTrade` for **every live role-agent trade
  except the yield role when `ENABLE_PROTOCOL_EXECUTION=true`** — i.e. **strategic and balancer
  roles, always, and yield whenever the flag is unset (the default)**.

Critically, real user capital *does* reach the agent's own account in production — this isn't
dead/unreachable code:

- `backend/src/provisionService.ts`'s own comment: *"Live mode is funded by a direct transfer
  from the smart wallet to the agent's own account, done by the Autonomous page's 'Add Agent'
  flow before it starts the agent."*
- `apps/web/app/dashboard/agents/AgentCreationWizard.tsx` (the only live agent-creation UI
  currently exposed) does exactly this: registers a spend-limit delegation
  (`createDelegation`), then calls `withdrawFromSmartWallet(...)`
  (`apps/web/app/lib/stellar.ts`) to move `capitalStr` out of the smart wallet into the agent's
  raw Turnkey Stellar address, *before* starting the agent.
- The withdrawal itself is correctly owner-authorized (`CustomAccount.execute()`, requires
  `owner.require_auth()`) and bounded by the registered spend-limit delegation. **But that
  delegation only ever gates the one-time transfer.** Once funds land in the agent's own
  account, every subsequent trade moves them via a raw Horizon transaction the backend signs
  unilaterally via Turnkey — no further on-chain Delegation validation, no on-chain Policy
  enforcement (spend limits / target whitelist / time restriction) ever runs again for that
  capital. The UI even says *"This agent will only ever be able to spend from your smart wallet,
  up to the limit"* (`AgentCreationWizard.tsx` line ~818) — which is not true once the funds are
  withdrawn; the only remaining guardrails are backend-DB, soft, mutable checks
  (`capabilityGate`/`allocationGate`/`maxSlippagePct` in `validation.ts`/`tick.ts`), not
  cryptographic ones.

This satisfies essentially every verification question in the task brief: direct backend
execution (yes), execution without the Smart Wallet (yes — tx source is the agent's own account),
skips Delegation validation (yes — on-chain `redeem_delegations` never called for the trade
itself), skips Policy enforcement (yes — on-chain `policies` contract never invoked), moves user
funds without Smart Wallet authorization (yes, for every trade after the initial funding), legacy
path that bypasses custody (yes — explicitly called "legacy spot-trade path" in the code's own
comments, and `protocolExecutionService.ts`'s header comment independently corroborates this:
*"unlike the legacy direct-custody trading loop (executionEngine.ts) which trades from the
agent's own Turnkey-signed keypair"*).

## Proof (reproduced, not assumed)

1. Static trace above (funding flow → agent's own account → raw Horizon signing), confirmed by
   reading the actual code at each hop (not just comments).
2. `backend/src/__tests__/roleTickProtocolExecution.test.ts`'s pre-existing test *"falls back to
   the legacy spot-trade path when protocol execution is disabled"* was **already passing before
   any fix was applied**, proving current (buggy) behavior: a live `role: 'yield'` agent with
   `ENABLE_PROTOCOL_EXECUTION` unset calls `executeQuantTrade`, not
   `executeProtocolAction`. Ran via:
   ```
   cd backend && node_modules/.bin/vitest run src/__tests__/roleTickProtocolExecution.test.ts
   ```
   (see "Sandbox setup" below for why `vitest` wasn't on PATH initially).
3. `roleTick.ts`'s `useProtocolExecution = config.role === 'yield' && ...` — read directly —
   confirms strategic/balancer roles have **no** protocol-execution branch at all, i.e. they
   always hit the legacy path in live mode regardless of the flag.

## Fix applied so far (uncommitted)

Principle: block the unsafe live path rather than attempt to retrofit classic-Stellar path
payments into the Soroban delegation/policy pipeline (that would be a genuine architecture change
— Smart Wallet `execute`/`execute_from_executor` only invoke Soroban contract functions, not
classic DEX path payments — out of scope per "no API redesign, preserve architecture"). Paper
mode is completely unaffected (never moves real funds); DCA and yield-with-protocol-execution
(the already-safe, delegation-routed paths) are unaffected.

- **`backend/src/tick.ts`**: `executeQuantTrade` (still exported, same signature) and
  `executeLimitOrder` (private) now throw immediately with a clear message, before doing any
  account load / signing / submission. Removed the now-fully-dead Horizon-specific
  implementation and its now-unused imports/helpers (`hasTrustline`, `HORIZON_TESTNET_URL`,
  `QUANT_TRADE_SLIPPAGE`, `LIMIT_ORDER_SLIPPAGE`, `Asset`/`BASE_FEE`/`Horizon`/`Operation`/
  `TransactionBuilder` from `@stellar/stellar-sdk`, `signTransaction` from the SDK, `getNetwork`
  from `./config.js`, `TESTNET_USDC_ISSUER` from `./priceHistory.js` — all confirmed unused
  elsewhere in the file before removal).
- **`backend/src/roleTick.ts`**: added a `legacyPathBlocked = row.mode === 'live' &&
  !useProtocolExecution` gate, folded into `willExecute` (same pattern as the existing
  `delegationBlocks` gate), so a blocked live trade produces a clean, auditable
  `executionResult = 'blocked:custody'` decision record instead of relying solely on a caught
  exception from `tick.ts`. (The `tick.ts` throw is still there too, as defense in depth — if
  some future caller reaches `executeQuantTrade` directly without going through this gate, it
  still fails closed.)
- **`backend/src/__tests__/roleTickProtocolExecution.test.ts`**: rewrote the test that asserted
  the *vulnerable* fallback behavior to instead assert blocking, and added two new tests proving
  the `strategic` role is blocked live even with the flag on (no route exists for that role at
  all), and that paper-mode `strategic` trading is unaffected. **Ran and passing**: 5/5 tests
  (see command above).

## What's explicitly NOT done yet — pick this up next

1. **Write the dedicated `tick.ts` regression test** (this is what was in progress when
   interrupted). Needs, at minimum:
   - `executeQuantTrade(...)` called directly with dummy args → rejects with the custody-error
     message. This one needs *no* mocking at all now (it throws before touching any dependency),
     so it's the cheapest, highest-signal test to add.
   - `runQuantTick` in live mode with a valid/active delegation present still fails cleanly
     (`recordTick` called with `ok: false`) and `recordCompletedTrade` is **never** called (the
     key fund-safety assertion). Requires mocking `./agentService.js`, `./priceHistory.js`,
     `./strategies/index.js`, `./auditService.js`, `./paperExecutor.js`, `./executionEngine.js` —
     follow the mocking pattern already established in `roleTickProtocolExecution.test.ts`.
   - `runQuantTick` in **paper** mode still executes normally (regression: legitimate path
     unaffected) — `executePaperQuantTradeMock` called, `recordCompletedTrade` called.
   - Same pair of tests (`live` blocked / `paper` unaffected) for `runLimitTick`. Note
     `executeLimitOrder` itself isn't exported — test through `runLimitTick`, not directly.
   - Suggested file: `backend/src/__tests__/p0-3-liveCustodyBypass.test.ts` (or fold into a new
     `tick.test.ts` if one doesn't already exist — confirmed it doesn't as of this session).
2. **Finish task #2** (SDK audit) and the rest of task #3 (protocolAdapters real transaction
   builders) — lower priority given the bug is confirmed backend-only, but the task brief asked
   for full coverage across SDK/backend/execution-engine/protocol-execution, so don't skip
   without at least a confirm-only pass.
3. **Broader feature-flag/debug-path grep** (task #4) — only `ENABLE_PROTOCOL_EXECUTION` was
   checked in depth; sweep `backend/src/config.ts` for other env-gated behavior before closing
   this out.
4. **Full verification run** (task #6, per the task brief's explicit checklist):
   - Contract tests (`cargo test`, with the same Windows `cdylib`-export-table workaround the
     main audit doc documents for P0-1/P0-2, if still needed — untouched by this fix, should
     still be 61/61 or whatever the current baseline is).
   - SDK tests + typecheck (`packages/sdk`) — untouched by this fix, should be unaffected;
     confirm anyway.
   - Backend tests: run the **full** suite, not just the one file touched so far —
     `cd backend && node_modules/.bin/vitest run` — watch specifically for any other test that
     imports `executeQuantTrade`/`executeLimitOrder` and asserts the *old* (unsafe) behavior
     (only `roleTickProtocolExecution.test.ts` was found to do so this session, but a full run
     will catch anything missed, e.g. `routes/agents.ts`'s `/trades/:tradeId/reverse` endpoint
     also calls `executeQuantTrade` for live mode — check if it has test coverage that needs the
     same treatment).
   - Backend typecheck (`tsc --noEmit`) — the import cleanup in `tick.ts` needs a clean
     typecheck pass; not yet run this session.
   - apps/web typecheck/build if `withdrawFromSmartWallet`/`AgentCreationWizard.tsx` behavior is
     touched by any follow-up decision (not modified this session — the funding-transfer step
     itself is correctly owner-authorized and was left alone; only the *post-funding* trading
     path was blocked).
   - Production build (`tsup` for backend, per the existing audit doc's pattern for other
     findings).
5. **Write the final report** in the Executive Summary / Root Cause / Proof of Exploit / Files
   Modified / Tests Added / Verification / Remaining Issues format the task brief requested —
   this doc is a working handoff, not that deliverable. Once verification (step 4) is clean,
   promote the confirmed parts of this doc into a proper `## P0-3 — ... — **[fixed]**` section in
   `docs/security/MAINNET_AUDIT.md`, matching the existing P0-1/P0-2/P1-3 format.

## Known open question worth flagging explicitly to the user before closing this out

Blocking live trading for `strategic`/`balancer` roles (and `quant`/`limit` legacy strategies) is
a real **product capability regression**, not just a narrow patch — those roles currently have
*no* safe replacement (unlike `yield`, which already has `executeProtocolAction`/Blend). This was
judged to be the correct "smallest safe fix" given the hard invariant ("funds must always remain
under Smart Wallet custody", "no backend custody", "no API redesign") and matches the existing
audit doc's own precedent (P0-2 fully removed the unsafe branch rather than trying to patch it in
place). But the user should be told plainly, before this is committed/merged: **live strategic
and balancer role agents, and any live quant/limit strategy, will start failing every tick**
(cleanly, with a clear audit-trail reason, not silently) **until a Smart-Wallet-custodied swap
route is built for them** (e.g. extending the `soroswap` protocol adapter the way `blend` was
extended for the `yield` role). That follow-up work is out of scope for "smallest safe fix" and
was not attempted this session.

## Sandbox setup notes (for continuing in a fresh session/environment)

- `better-sqlite3`'s native build fails on this Windows sandbox (no MSVC/Visual Studio Build
  Tools installed) — same pre-existing environment gap the main audit doc notes repeatedly for
  P0-1/P0-2/P1-3. Workaround used this session:
  ```
  corepack pnpm install --ignore-scripts
  ```
  run from the repo root (not `--filter`-scoped — a filtered `--ignore-scripts` install left
  `vitest` unlinked in `backend/node_modules/.bin`; the full workspace install fixed it). This
  successfully links `backend/node_modules/.bin/vitest` (v1.6.1) without needing
  `better-sqlite3`'s native binary — fine for any test file that fully mocks `./agentService.js`,
  `./db.js`, etc. (as `roleTickProtocolExecution.test.ts` does), but **any test that touches the
  real DB via `getDb()`** (e.g. `scheduler.test.ts`) will still fail in this sandbox — that's the
  same known gap, not a regression from this session's changes.
- Run backend tests via `backend/node_modules/.bin/vitest run <path>` directly — `pnpm`/`npx
  vitest` were not on PATH in the Bash tool's shell in this sandbox; PowerShell also didn't have
  `pnpm` on PATH, only `corepack pnpm` worked.
- **Before running `pnpm install` again**, be aware it silently rewrote `pnpm-lock.yaml` (dropped
  an `apps/comming-soon` workspace entry the lockfile referenced that isn't in the current tree)
  — this was reverted with `git checkout -- pnpm-lock.yaml` this session since it was unrelated
  noise. If you need to re-run install, check `git diff pnpm-lock.yaml` afterward and revert it
  again unless that workspace-entry cleanup is actually wanted.
