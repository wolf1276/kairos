# End-to-End Production Validation Plan

## Executive Summary

Perform a complete end-to-end production validation of Kairos starting from a fresh environment, validating 24 stages of the complete user/system flow. Only identify and fix Critical/High issues preventing correct operation. Do NOT implement new features or refactor.

## Scope

Validate the complete flow:
1. User connects wallet
2. Smart Wallet lookup/creation
3. Registry lookup
4. Agent creation
5. Agent persistence
6. Runtime start
7. Pipeline execution
8. Context
9. Memory
10. Strategy
11. Reasoning
12. Decision
13. Verification
14. Planning
15. Routing
16. Execution
17. Outcome recording
18. Memory writing
19. Learning
20. Benchmark recording
21. Dashboard updates
22. Database persistence
23. Runtime restart
24. Recovery after restart

For every step verify:
- correct input
- correct output
- database state
- on-chain state
- API responses
- frontend state
- logs
- event flow
- persistence

## Pre-Validation Checklist

### Environment Setup
- [ ] Verify all required env vars are documented and have defaults/validation
- [ ] Verify database schema migrations are complete and idempotent
- [ ] Verify all external dependencies (Stellar testnet, Turnkey, LLM providers) have fallback modes
- [ ] Verify the application can start from a clean state (no pre-existing DB, no cached state)

### Critical Bug Identification (Pre-Validation Research)

Based on codebase inspection, the following **Critical/High** issues were identified BEFORE running validation:

#### CRITICAL BUG #1: AutonomousRuntime NOT Wired Into Production Server
**File:** `backend/src/index.ts`
**Root Cause:** The `index.ts` creates `createDashboardRouter()` and `createMonitoringRouter()` WITHOUT passing an `AutonomousRuntime` instance. The comments in `index.ts` explicitly acknowledge this: "No AutonomousRuntime is wired into this process yet, so status/health/metrics report `null` and start/stop/pause/resume report 503."
**Impact:** Steps 22 (Dashboard updates), 23 (Runtime restart), 24 (Recovery after restart) are completely broken. The dashboard API returns `null` for all runtime data and 503 for all lifecycle operations.
**Fix Required:** Wire up `AutonomousRuntime` in `index.ts` with proper dependency injection.

#### HIGH BUG #2: Runtime Persistence Not Wired
**File:** `backend/src/index.ts`
**Root Cause:** `FileRuntimePersistenceProvider` exists in `runtime/autonomousRuntime/persistence.ts` but is never instantiated or passed to `AutonomousRuntime` in production.
**Impact:** Runtime state (executionCount, failureCount, lastExecutionAt) is lost on restart. Step 24 (Recovery after restart) fails.
**Fix Required:** Instantiate `FileRuntimePersistenceProvider` with a configurable path and pass it to `AutonomousRuntime`.

#### HIGH BUG #3: Benchmark Recording Not Wired Into Pipeline Runner
**File:** `backend/src/index.ts`
**Root Cause:** `createPipelineRunner()` in `pipelineRunner/orchestrator.ts` accepts an optional `PipelineBenchmarkOptions` but the production server never supplies it.
**Impact:** Step 20 (Benchmark recording) never happens in production. Benchmark DB remains empty.
**Fix Required:** Wire `SqliteBenchmarkStore` + `BenchmarkSession` into the pipeline runner.

## Validation Execution Plan

### Phase 0: Environment Bootstrap
1. Start with completely clean environment:
   - Remove any existing `data/agents.db`
   - Remove any existing `data/benchmark.db`
   - Clear any runtime snapshot files
   - Verify no cached state in memory

2. Start backend server
3. Verify all routes are registered
4. Verify health endpoint returns 200

### Phase 1: Wallet Connection (Steps 1-3)
1. **User connects wallet**
   - Call `POST /api/auth/challenge` with test public key
   - Verify nonce is returned
   - Verify nonce expires correctly
   - Simulate wallet signature (use test keypair)
   - Call `POST /api/auth/verify`
   - Verify JWT token is returned
   - Verify `users` table has new row
   - Verify `last_login_at` is set

2. **Smart Wallet lookup/creation**
   - Call `POST /api/connect/check`
   - Verify returns `"new"` for fresh user
   - Call `POST /api/connect/prepare`
   - Verify returns `unsignedEntryXdr`, `smartWalletAddress`, `saltHex`
   - Call `POST /api/connect/submit` with signed entry
   - Verify smart wallet is deployed
   - Verify `smart_wallets` table has new row
   - Verify on-chain registry has mapping (if registry contract deployed)

3. **Registry lookup**
   - Call `POST /api/connect/check` again
   - Verify returns `"existing"` with correct addresses
   - Verify DB lookup is fast path (no on-chain fallback needed)
   - Delete DB row, verify on-chain fallback works
   - Verify backfill restores DB row

### Phase 2: Agent Lifecycle (Steps 4-6)
1. **Agent creation**
   - Call `POST /api/agents` with mode='paper'
   - Verify agent row in DB
   - Verify Turnkey key created (or encrypted_secret for legacy)
   - Verify agent status is 'new'
   - Verify no strategy set
   - Verify no delegation attached

2. **Agent persistence**
   - Restart backend
   - Verify agent still exists in DB
   - Verify agent data is unchanged
   - Verify no duplicate agents created

3. **Runtime start**
   - Call `POST /api/dashboard/start`
   - Verify runtime transitions to RUNNING
   - Verify scheduler is active
   - Verify runtime snapshot is persisted
   - Verify heartbeat returns correct data

### Phase 3: Pipeline Execution (Steps 7-16)
1. **Pipeline execution**
   - Trigger agent tick (wait for scheduler or manual trigger)
   - Verify all 11 pipeline stages execute in order
   - Verify stage durations are recorded
   - Verify no stage is skipped or duplicated

2. **Context**
   - Verify `buildAgentContext` returns valid context
   - Verify context has required fields (pair, price, features, indicators)
   - Verify context hash is deterministic for same inputs

3. **Memory**
   - Verify `assembleMemoryPackage` returns valid package
   - Verify package has episodic, semantic, working memory
   - Verify memory providers are correctly injected

4. **Strategy**
   - Verify strategy registry evaluates all strategies
   - Verify strategy signals are returned
   - Verify strategy consensus is computed
   - Verify strategy signals are injected into prompt

5. **Reasoning**
   - Verify `buildReasoningContext` returns valid context
   - Verify prompt is built correctly
   - Verify prompt hash is computed

6. **Decision**
   - Verify `generateDecisionIntelligence` returns decision
   - Verify decision has required fields (action, confidence, reasoning)
   - Verify LLM provider is called (or fallback used)

7. **Verification**
   - Verify `verifyDecision` returns verified decision
   - Verify verification checks policy, capital, risk
   - Verify failed decisions are rejected

8. **Planning**
   - Verify `buildExecutionPlan` returns valid plan
   - Verify plan has required steps

9. **Routing**
   - Verify `computeRoutesForPlan` returns routes
   - Verify routes are valid for the plan

10. **Execution**
    - Verify `executeRoute` returns execution result
    - Verify execution result has required fields
    - Verify paper mode produces synthetic tx hash

### Phase 4: Outcome & Memory (Steps 17-19)
1. **Outcome recording**
   - Verify `recordOutcome` returns outcome record
   - Verify outcome is recorded in benchmark DB
   - Verify outcome has required fields

2. **Memory writing**
   - Verify `writeMemory` writes to all three memory providers
   - Verify episodic memory has new record
   - Verify semantic memory is updated
   - Verify working memory is updated

3. **Learning**
   - Verify `computeLearningSnapshot` returns valid snapshot
   - Verify learning snapshot has statistics
   - Verify learning is deterministic for same inputs

### Phase 5: Benchmark & Dashboard (Steps 20-22)
1. **Benchmark recording**
   - Verify benchmark DB has new execution record
   - Verify record has all required fields
   - Verify stage durations are recorded
   - Verify benchmark session is tracked

2. **Dashboard updates**
   - Call `GET /api/dashboard/status`
   - Verify returns RUNNING state
   - Call `GET /api/dashboard/health`
   - Verify returns ok health
   - Call `GET /api/dashboard/metrics`
   - Verify returns heartbeat with execution count
   - Call `GET /api/dashboard/memory?agentId=<id>`
   - Verify returns assembled memory package
   - Call `GET /api/dashboard/learning?agentId=<id>`
   - Verify returns learning snapshot
   - Call `GET /api/dashboard/history?agentId=<id>`
   - Verify returns episodic history

3. **Database persistence**
   - Verify `agents` table has updated `last_tick_at`
   - Verify `trades` table has new trade record
   - Verify `positions` table has updated position
   - Verify `audit_log` has new audit events
   - Verify `decisions` table has decision record
   - Verify `performance_snapshots` has new snapshot
   - Verify `execution_journal` has completed journal entry
   - Verify `benchmark_executions` has benchmark record

### Phase 6: Runtime Restart & Recovery (Steps 23-24)
1. **Runtime restart**
   - Call `POST /api/dashboard/stop`
   - Verify runtime transitions to STOPPED
   - Verify scheduler stops
   - Verify runtime snapshot is persisted

2. **Recovery after restart**
   - Restart backend process
   - Verify runtime loads persisted snapshot
   - Verify execution count is restored
   - Verify failure count is restored
   - Verify last execution time is restored
   - Call `POST /api/dashboard/start`
   - Verify runtime resumes from correct state
   - Verify scheduler starts

3. **Execution journal recovery**
   - Verify `reconcilePendingExecutions` runs on startup
   - Verify any pending journal entries are recovered or marked failed

### Phase 7: Failure Injection & Resilience
1. **LLM provider failure**
   - Disable LLM provider
   - Verify decision engine uses deterministic fallback
   - Verify pipeline completes successfully
   - Verify failure is logged

2. **Database failure**
   - Simulate DB write failure
   - Verify execution journal is left at 'broadcast'
   - Verify `reconcilePendingExecutions` recovers on restart

3. **Concurrent pipeline execution**
   - Trigger multiple pipeline runs simultaneously
   - Verify no race conditions
   - Verify benchmark records are not corrupted
   - Verify memory writes are deduplicated

4. **State synchronization**
   - Verify frontend state matches backend state after each operation
   - Verify no stale state after restart
   - Verify no duplicate records after retry

## Regression Tests to Add

### Test 1: Runtime Wiring Integration Test
**File:** `backend/src/__tests__/runtimeWiring.test.ts`
**Purpose:** Verify that `index.ts` wires up `AutonomousRuntime` with proper persistence and benchmark recording.
**Assertions:**
- Dashboard `/status` returns actual runtime state, not null
- Dashboard `/metrics` returns actual heartbeat data
- Dashboard `/start` actually starts the runtime
- Runtime persists snapshot to disk
- Runtime recovers snapshot on restart

### Test 2: End-to-End Flow Integration Test
**File:** `backend/src/__tests__/e2eFlow.test.ts`
**Purpose:** Verify the complete flow from agent creation through pipeline execution to dashboard updates.
**Assertions:**
- Agent is created and persisted
- Pipeline executes all 11 stages
- Trade is recorded
- Benchmark is recorded
- Dashboard returns correct data
- Runtime recovers after restart

### Test 3: Smart Wallet Recovery Test
**File:** `backend/src/__tests__/smartWalletRecovery.test.ts`
**Purpose:** Verify that smart wallet mappings are recovered from on-chain registry when DB is lost.
**Assertions:**
- Delete DB row for existing owner
- Call `/api/connect/check`
- Verify on-chain registry is queried
- Verify DB row is backfilled
- Verify subsequent checks hit fast path

### Test 4: Runtime Persistence Test
**File:** `backend/src/__tests__/runtimePersistence.test.ts`
**Purpose:** Verify runtime state survives process restart.
**Assertions:**
- Start runtime, execute pipeline
- Stop runtime
- Load persisted snapshot
- Verify execution count, failure count, last execution time are restored
- Start runtime again, verify it continues from correct state

### Test 5: Benchmark Recording Test
**File:** `backend/src/__tests__/benchmarkRecording.test.ts`
**Purpose:** Verify benchmark records are written during production pipeline execution.
**Assertions:**
- Execute pipeline with benchmark session
- Verify benchmark DB has new record
- Verify record has correct stage durations
- Verify record has correct provider/model
- Verify benchmark reports can be generated

## Remaining Issues (Known, Out of Scope for This Validation)

1. **Turnkey MPC Integration Not Functional** - Live on-chain execution is disabled per README. Paper mode is the functional path.
2. **Protocol Execution (Blend/Soroswap) Disabled by Default** - `ENABLE_PROTOCOL_EXECUTION` is false by default.
3. **LLM Provider Optional** - Deterministic fallback is used when LLM is unavailable.
4. **Frontend Dashboard Data Fetching** - The dashboard page appears to be mostly static/hardcoded. The actual dynamic data fetching hooks were not found in the expected location.

## Production Readiness Assessment

**Current State: NOT PRODUCTION READY**

### Blockers (Must Fix Before Production)
1. **AutonomousRuntime not wired into production server** - Dashboard/monitoring APIs return null/503
2. **Runtime persistence not configured** - State lost on restart
3. **Benchmark recording not wired** - No performance data collected

### Non-Blockers (Can Ship With)
1. Turnkey MPC for live on-chain execution (paper mode works)
2. Protocol execution adapters (disabled by default, opt-in)
3. LLM provider (deterministic fallback works)

## Execution Notes

- Do NOT implement new features
- Do NOT refactor existing code
- Only fix Critical/High issues preventing correct operation
- Add regression tests for every fix
- Stop immediately if any step fails, identify root cause, fix, add test, continue
