# `revoke_by_wallet` — intended behavior (usability observation, not a vulnerability)

Scope: `contracts/soroban/contracts/delegation-manager/src/lib.rs`. Follow-up to the P1-A
finding (independently verified a false positive — no security bypass). This records the one
adjacent usability observation from that investigation and why no code change was made.

## Behavior

`revoke_by_wallet(delegator, delegate)` disables whichever delegation hash is *currently*
registered in `WalletDelegation(delegator, delegate)` at the moment the call executes. It takes
no hash argument, so it cannot distinguish "the delegation I observed a moment ago" from "the
delegation that's active right now" — those can differ if a revoke + re-register happened
between when a caller last read `get_wallet_delegation` and when their `revoke_by_wallet`
transaction lands. In that case the call disables the newer delegation, not whichever one the
caller had in mind.

## Why this is not a security issue

Revocation only ever removes authority — it can disable a delegation, never (re-)enable or
authorize one:

- Old delegations cannot be redeemed after revocation (`redeem_delegations` checks
  `Disabled(hash)` before allowing redemption).
- Revocation is hash-based, so disabling one hash never affects any other.
- No authority survives revocation regardless of *which* currently-registered delegation ends
  up disabled by a given call.

The worst outcome of the stale-target scenario is availability/usability: a legitimate, newer
delegation gets disabled when the caller meant to confirm an older one's disablement, requiring
re-registration. It cannot result in continued or expanded spend authority the owner didn't
disable.

## Resolution

**No change required.** `revoke_by_wallet`'s interface and behavior are unchanged — this is the
intended API. A prior pass in this investigation added an opt-in `revoke_by_wallet_checked`
compare-and-revoke variant plus a new error code and SDK helpers; those were reverted since the
only benefit was API ergonomics / stale-client protection, not a security fix, and the task
scope for this finding is documentation, not protocol changes.

If a genuine need for stale-target protection emerges later (e.g. a UI that shows a specific
delegation hash before revoking), it should be scoped and reviewed as its own change rather than
folded into a security-audit finding.
