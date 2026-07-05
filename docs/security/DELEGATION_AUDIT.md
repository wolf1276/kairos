# Delegation — Security & Correctness Audit

_Scope: the delegation stack across `contracts/soroban/contracts/delegation-manager`, `contracts/soroban/contracts/{custom-account,policies}`, `packages/sdk` (`delegation`, `execution`, `policy`, `events`), `apps/web/app/api/delegate-sdk`, `apps/web/app/dashboard/delegations`, `backend/`, and `packages/mcp-agent`._

Findings are ranked by severity. Items marked **[fixed]** were addressed in the same change set that produced this report; **[recommended]** items require a contract change + redeploy and are left as follow-ups.

---

## 1. MCP agent could not execute any dashboard-minted delegation — **[fixed]**

**Severity: High (functional break).**

`packages/mcp-agent/src/tools/executeAction.ts` (and `spendFunds.ts`) filtered a delegation's caveats by calling `client.policy.decode(caveat)` directly and matching `type === 'target-whitelist'` / `'spend-limit'`. But every delegation minted by the current wizard stores caveats as **policy-indirection markers** (`0xFE ++ policy_id:u64_be`) via `PolicyModule.createIndexed` (`packages/sdk/src/policy/index.ts:42-55`), not inline terms. `decode()` throws `Unknown policy type tag: 254` on the marker byte, the `catch` swallows it, and the filtered set is always empty — so the agent always answered "No delegation whitelists target …" and never redeemed.

**Fix:** added `PolicyModule.isIndexedCaveat` / `getIndexedPolicyId` and `DelegationModule.getPolicyTerms` / `resolveCaveat`, which mirror the contract's `resolve_terms` by reading the live `(delegator, policy_id)` terms from on-chain `Policy` storage before decoding. Both MCP tools now resolve each caveat before matching.

---

## 2. On-chain listing missed registered delegations — **[fixed]**

**Severity: Medium.**

`DelegationModule.list()` (`packages/sdk/src/delegation/index.ts`) queried only the `del_dis`, `del_en`, and `redeemed` event topics. `register_delegation` emits `del_reg` (`delegation-manager/src/lib.rs:214`), which was neither queried nor decoded (`packages/sdk/src/events/index.ts`). A freshly registered, never-redeemed, never-revoked delegation therefore did not appear in `LIST_DELEGATIONS`; the dashboard surfaced it only through its `localStorage` merge (`useDelegations.ts`), making it invisible on any other browser or device and to any on-chain consumer.

**Fix:** added `del_reg` to the topic filter in `list()` and a `DelegationRegistered` decode branch in `EventsModule.decode`.

---

## 3. `redeem_delegations` ignores the WalletDelegation registry — **[recommended]**

**Severity: High.**

`redeem_delegations` (`delegation-manager/src/lib.rs:341-582`) validates signature, nonce, disabled-flag, and chain linkage, but never checks that the delegation being redeemed is the wallet's currently-registered active one (`DataKey::WalletDelegation`). Consequences:

- The "one delegation per wallet" invariant enforced at `register_delegation` (lib.rs:199-215) does **not** hold at redemption. A validly signed delegation that was never registered (or was superseded) is redeemable as long as its hash isn't in the `Disabled` set.
- `revoke_by_wallet` (lib.rs:224-239) only disables the *registered* hash. A previously-signed, unregistered delegation for the same wallet remains fully redeemable after a "revoke all".

**Recommendation:** in `redeem_delegations`, require the root delegation's hash to equal `WalletDelegation(root_delegator)`, or otherwise gate redemption on registration. Requires redeploy.

---

## 4. Empty-chain execution path lets the redeemer call arbitrary targets as the manager — **[recommended]**

**Severity: Medium/High.**

For a zero-length chain, `redeem_delegations` (lib.rs:467-474) invokes `execution.target.function(args)` directly with the DelegationManager as the caller and no caveat checks. Any `redeemer` can use this to invoke arbitrary contracts with the manager's authority — including the policy enforcers' `before_hook`/`after_hook`/`set_*` surfaces, which could corrupt the per-delegation spend accumulators, and any contract that trusts the manager address.

**Recommendation:** remove the empty-chain branch, or restrict it to the manager owner. Requires redeploy.

---

## 5. Spend-limit enforcement is shallow and collides across caveats — **[recommended]**

**Severity: Medium.**

In `contracts/soroban/contracts/policies/src/lib.rs`:
- The spend-limit enforcer (`before_hook`, ~lines 104-150) only counts value when the execution is a direct `transfer`/`xfer` call *to the token contract*. Any value movement through a router/DEX/AMM target, or a differently-named function, bypasses the limit entirely. `before_all` for the spend-limit type does no enforcement.
- The accumulator keys `PolicyStateKey::Spent(hash)` / `LastSpentTime(hash)` are keyed only by the delegation hash, not by policy/caveat id. Two spend-limit caveats on one delegation share one accumulator and clobber each other.

**Recommendation:** key the accumulator by `(hash, policy_id)`, and enforce limits on a whitelisted set of value-moving call shapes (or require spend-limit + target-whitelist to be paired). Requires redeploy.

---

## 6. Signature-scheme divergence between redeem and the smart wallet — **[recommended / latent]**

**Severity: Low today, High if EOA delegators are enabled.**

`redeem_delegations`' EOA branch verifies `ed25519_verify` over the **raw** delegation hash (lib.rs:424-432), while `CustomAccount::is_valid_signature` (`custom-account/src/lib.rs`) and the dashboard both use the **SEP-53-wrapped** payload (`apps/web/app/lib/stellar.ts`). EOA delegators are currently unreachable through the UI, but an EOA delegation signed the way the UI signs would fail on-chain verification. The two paths should agree on one scheme.

---

## 7. No native expiry on the Delegation struct — **[recommended]**

**Severity: Low.**

The `Delegation` struct (lib.rs:14-24) has no validity window. Expiry is only available by attaching a time-restriction caveat (policy type 3). A delegation created without that caveat is valid until explicitly disabled. Consider a first-class `valid_until` field, or make the wizard always attach a time restriction.

---

## 8. Dashboard showed fabricated metrics and dead sort options — **[fixed]**

**Severity: Low (trust/UX).**

`useDelegations.ts` hardcoded `stats.totalValue`, `activeAgents`, and `pendingRequests` to `0`, and the "By Value" / "By Activity" sorts plus the "Pending" / "Expired" status filters were no-ops. The UI presented these as real ("$—", "Running autonomously") which is misleading.

**Fix:** removed the fabricated stat cards and no-op filter/sort options across `types/delegation.ts`, `hooks/useDelegations.ts`, `components/StatsCards.tsx`, and `components/SearchFilter.tsx` in `apps/web/app/dashboard/delegations/`. The stats grid now shows only Active / Policies / Revoked (all derived from real data).

---

## 9. Backend revocation only mirrors local state — **[by design, documented]**

**Severity: Informational.**

`backend/src/agentService.ts` keeps a local SQLite copy of the wallet's active delegation and decrypted agent keys. `POST /agents/:id/delegation/revoke` (`backend/src/routes/agents.ts`) only flips the local `disabled` flag — it does **not** perform the on-chain `revoke_by_wallet`. On-chain revocation is a separate client responsibility. This is intentional (the backend can't sign for the owner's smart wallet), but callers must do both. See `docs/architecture/DELEGATION_WORKFLOW.md`.

---

## 10. Minor / cosmetic — **[noted]**

- `DelegationModule.getNonce` / `get` / `getPolicyTerms` hardcode a well-known funded source account (`GBKK…`) for read-only simulations; fine functionally, but brittle if that account is ever an assumption elsewhere.
- Sequential-nonce delegations (`nonce != u64::MAX`) become permanently unusable once the delegator's stored nonce advances past them (`consume_nonce`, lib.rs:594-612). The system relies on reusable-until-revoked delegations (`nonce == u64::MAX`); document this so no one hand-crafts a sequential-nonce delegation expecting reuse.
- Unused params/imports in the contracts (`log`, `symbol_short` in policies; the `hash` param in some hooks).

---

## Summary

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | MCP agent can't execute indexed-caveat delegations | High | fixed |
| 2 | `list()` misses `del_reg` | Medium | fixed |
| 3 | Redeem ignores WalletDelegation registry | High | recommended |
| 4 | Empty-chain arbitrary execution | Medium/High | recommended |
| 5 | Shallow / colliding spend limits | Medium | recommended |
| 6 | EOA raw-hash vs SEP-53 divergence | Low→High | recommended |
| 7 | No native delegation expiry | Low | recommended |
| 8 | Fabricated UI metrics / dead sorts | Low | fixed |
| 9 | Backend revoke is local-only | Info | documented |
| 10 | Minor / cosmetic | Low | noted |
