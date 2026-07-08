# Kairos Engineering Pending

Status: Active

This document tracks all remaining engineering work required before Kairos reaches v1.0.

Rules

- Never implement mocked functionality.
- Backend is the source of truth.
- Every completed task must be removed from this file.
- Every new feature must have runtime verification before being marked complete.

---

# P0 — Critical

These block production readiness.

## Agent Creation

- [ ] Complete end-to-end browser verification of the entire Agent Creation workflow. (IN PROGRESS — session 2026-07-09: instrumented Playwright run with real Ed25519 signing against the live testnet backend; only reached the Agents page / Connect step before this pass was cut short. Steps 4-19 of the checklist not yet driven live — see apps/web/e2e/live-qa.spec.ts.)
- [x] Verify no Freighter popup occurs when simply opening the Agents page. (2026-07-09: live network capture on http://localhost:3000/dashboard/agents showed zero calls to /api/auth/challenge or /api/auth/verify before the user clicked "Connect Freighter" — confirms no auto sign/connect prompt fires just from loading the page. See apps/web/e2e/live-qa.spec.ts test "1-3".)
- [ ] Verify no runtime exceptions occur during Create Agent.
- [ ] Verify no 404s anywhere in the wizard.
- [ ] Verify review → Smart Wallet → Delegation → Agent Creation completes successfully.

---

## Policy Enforcement

Implement runtime enforcement for every persisted policy.

### Allocation

- [x] Enforce maxAllocationPct. (backend/src/tick.ts `allocationGate`, backend/src/validation.ts `validatePolicy` — blocks any single trade that would commit more than maxAllocationPct of the agent's capital, across dca/quant/limit/role tick paths.)

### Capabilities

- [x] Enforce Swap permission. (quant + limit ticks + strategic role — backend/src/tick.ts `capabilityGate`, backend/src/validation.ts `ROLE_CAPABILITY`.)
- [x] Enforce Yield permission. (yield role tick.)
- [x] Enforce Rebalance permission. (balancer role tick.)
- [x] Enforce DCA permission. (dca tick.)
- [ ] Enforce Hold Stable Assets permission. (no runtime path currently reads/writes stable-asset holding behavior — needs a strategy/decision hook before this can be gated, not just a policy check.)

### Future Capabilities

- [ ] Enforce Borrow permission. (no borrow execution path exists yet.)
- [ ] Enforce Leverage permission. (no leverage execution path exists yet.)

### Slippage

- [x] Apply maxSlippagePct consistently across every execution path. (executeQuantTrade already took this; role-tick quant trades share the same executor.)

---

## Runtime

- [ ] Verify every execution path goes through PolicyEngine.
- [ ] Verify no execution path bypasses policy validation.
- [ ] Verify fail-closed behavior.

---

# P1 — High

## Mission Control

- [ ] Replace placeholder metrics with real data.
- [ ] Remove any remaining fake values.
- [ ] Verify lifecycle states.
- [ ] Improve empty/loading states.

---

## Dashboard

- [ ] Implement real Portfolio Allocation.
- [ ] Implement portfolio history backend.
- [ ] Verify Recent Activity accuracy.

---

## Smart Wallet

- [ ] Browser verification of:
  - Deposit
  - Withdraw
  - Refresh
  - Explorer
  - Registry recovery

---

## Delegation

- [ ] Verify delegation creation.
- [ ] Verify delegation recovery.
- [ ] Verify revoke flow.
- [ ] Verify on-chain state.

---

## Runtime Validation

- [ ] Verify Runtime registration.
- [ ] Verify Memory initialization.
- [ ] Verify Benchmark initialization.
- [ ] Verify Scheduler registration.

---

# P2 — Medium

## Cleanup

- [ ] Remove dead parser files.
- [ ] Remove unused endpoints.
- [ ] Remove unused components.
- [ ] Remove duplicate polling.
- [ ] Consolidate duplicated runtime logic.

---

## Testing

Add Playwright coverage for:

- [ ] Connect Wallet
- [ ] Smart Wallet
- [ ] Create Agent
- [ ] Delegation
- [ ] Start Agent
- [ ] Stop Agent
- [ ] Logout/Login
- [ ] Refresh
- [ ] Browser reload

---

## Performance

- [ ] Reduce unnecessary polling.
- [ ] Optimize runtime refresh.
- [ ] Cache safe read-only data.

---

# P3 — Polish

## UI

- [ ] Improve animations.
- [ ] Improve loading transitions.
- [ ] Improve success screens.
- [ ] Improve error messages.
- [ ] Improve mobile responsiveness.

---

# Security

- [ ] Rotate all production secrets.
- [ ] Verify no secrets are committed.
- [ ] Audit JWT configuration.
- [ ] Audit Smart Wallet permissions.
- [ ] Audit Delegation permissions.

---

# Production Readiness Checklist

## Backend

- [x] Authentication
- [x] Intent Parser
- [x] Agent Lifecycle
- [x] Smart Wallet
- [x] Registry
- [x] Delegation
- [x] Policy Persistence
- [ ] Policy Enforcement
- [ ] Full Runtime Verification

---

## Frontend

- [x] Dashboard
- [x] Smart Wallet Panel
- [x] Agent Creation UI
- [ ] Browser Verification
- [ ] Mission Control Polish
- [ ] End-to-End Tests

---

## Launch Criteria

Kairos is ready for v1.0 when:

- [ ] No mocked values remain.
- [ ] No fake progress indicators remain.
- [ ] All policies are enforced.
- [ ] All execution paths are verified.
- [ ] Smart Wallet flow is verified.
- [ ] Delegation flow is verified.
- [ ] Agent Creation is fully verified.
- [ ] Mission Control is production-ready.
- [ ] Playwright E2E passes.
- [ ] Secrets rotated.
- [ ] Production deployment verified.

---

Last Updated: July 2026
Owner: Kairos Engineering