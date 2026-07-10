Investigate ONLY P1-2.

Do NOT trust the audit.

Do NOT modify code until the issue is reproduced.

Goal

Audit SDK handling of archived Soroban ledger entries.

Audit:

- simulation
- restore flow
- transaction preparation
- transaction submission
- SDK helpers
- contract invocation

Verify:

1. Does the SDK detect archived entries?

2. Does it detect RestoreFootprintRequired errors?

3. Does it automatically restore when appropriate?

4. Does it retry safely after restore?

5. Can users become stuck because restore is never attempted?

6. Are restore failures surfaced correctly?

Reproduce using a real archived footprint if possible.

If the issue is NOT reproducible:

Explain why.

Do not change code.

If reproducible:

Implement the smallest safe fix.

Requirements:

- Preserve SDK API.
- Preserve transaction semantics.
- No unnecessary refactors.
- Restore only when required.

Regression tests:

- normal invocation
- archived ledger entry
- successful restore
- restore failure
- retry after restore
- simulation error propagation

Run:

- SDK tests
- contract tests
- backend tests
- typecheck

Deliver:

- Executive Summary
- Root Cause
- Files Modified
- Tests Added
- Verification
- Remaining Issues

Stop.


