// Runtime Singleton: wires the composed Kairos pipeline (runtime/pipelineComposition) into a
// single, process-wide AutonomousRuntime instance and starts it. This is process-level
// composition/bootstrap, not engine logic — it only ever calls published entry points from
// pipelineComposition, protocolAdapters, executionTarget, config.ts, and provisionService.ts.
//
// Honesty notes (read before trusting any field this exposes):
//  - ProtocolRegistry is constructed empty. No real (non-test-double) protocol adapter
//    construction path exists today that doesn't require live RPC/router clients this process
//    has no way to provision safely by default (see protocolAdapters/soroswap/adapter.ts's
//    `SoroswapAdapterOptions.routerClient`/`sorobanRpcClient`) — registering a half-wired adapter
//    would be worse than registering none. Empty registry = "no protocols wired for autonomous
//    trading yet", not fake data. Route/execution stages will simply fail closed with "no route
//    candidates" until a real adapter is registered here.
//  - ExecutionTarget is always 'replay' — deterministic, synthetic execution. This runtime NEVER
//    touches real capital. 'mainnet' throws by construction; 'testnet' needs real transaction
//    providers nothing in this codebase provisions yet.
//  - Persistence is the default InMemoryRuntimePersistenceProvider (no runtimePersistence
//    override supplied) — restart survival of executionCount/failureCount/state is NOT
//    guaranteed; a process restart starts the runtime's own counters fresh.
import { createRuntime, createPipelineRunner } from './pipelineComposition/index.js';
import { KairosPipelineRunner } from './pipelineRunner/index.js';
import { createExecutionTarget } from './executionTarget/factory.js';
import { ProtocolRegistry } from '../protocolAdapters/registry.js';
import { getNetwork, getSchedulerIntervalMs } from '../config.js';
import { provisionSingleRoleAgent } from '../provisionService.js';
import type { AutonomousRuntime } from './autonomousRuntime/index.js';
import type { KairosCompositionConfig, TelemetryProvider } from './pipelineComposition/index.js';
import type { UserPolicy } from '../reasoning/index.js';
import type { PipelineResult } from './pipelineRunner/index.js';

/** Fixed system owner used to provision (idempotently) the single role agent this process-wide
 *  runtime reasons/acts on behalf of. Not a real end user — a stand-in identity for the
 *  dev/introspection runtime, following the same `owner` string contract every other agent in
 *  this system uses (provisionService.ts never special-cases owner strings). */
export const SYSTEM_RUNTIME_OWNER = 'system';

/** Conservative, paper-safe default policy — this runtime is never expected to move real capital
 *  (ExecutionTarget is always 'replay'), but the policy itself is still written as if it mattered:
 *  medium risk, small allocation cap, high confidence bar. */
function buildDefaultUserPolicy(agentId: string): UserPolicy {
  return {
    userId: agentId,
    riskTolerance: 'medium',
    maxAllocationPct: 10,
    allowedProtocols: [],
    allowedAssets: ['XLM', 'USDC'],
    minConfidence: 0.65,
    objectives: ['capital-preservation'],
  };
}

/** Simplest honest passthrough: derives the OutcomeTelemetry shape the Outcome Recorder (Phase 8,
 *  frozen) requires directly from the ExecutionResult Composition already has in hand, rather than
 *  fabricating post-settlement facts. Because ExecutionTarget is always 'replay' here, there is no
 *  real on-chain settlement to watch — "amountExecuted"/"balances" reflect the deterministic
 *  simulation the replay target already produced, not a real balance change. */
const replayTelemetryProvider: TelemetryProvider = (executionResult) => {
  const requestedAmount = executionResult.route?.request?.amount ?? '0';
  return {
    transactionHash: executionResult.executionId ?? 'unknown-execution',
    transactionXDRHash: executionResult.executionHash ?? 'unknown-execution-hash',
    amountRequested: requestedAmount,
    amountExecuted: executionResult.status === 'success' ? requestedAmount : '0',
    fees: executionResult.estimatedFees ?? '0',
    slippage: executionResult.simulationResult?.estimatedSlippagePct ?? 0,
    priceImpact: 0,
    balancesBefore: [],
    balancesAfter: [],
    verificationHash: executionResult.metadata?.planHash ?? 'unknown-plan-hash',
    contextHash: executionResult.metadata?.requestHash ?? 'unknown-request-hash',
    memoryHash: executionResult.metadata?.routeHash ?? 'unknown-route-hash',
    metadata: { source: 'replay-passthrough', executionMetadata: executionResult.metadata },
  };
};

let runtimeInstance: AutonomousRuntime | null = null;
let pipelineRunnerInstance: KairosPipelineRunner | null = null;
/** Guards concurrent initRuntime() callers onto the same in-flight init, not just a boolean —
 *  two callers racing initRuntime() before the first has resolved must await the same promise and
 *  get back the same instance, never build two. */
let initPromise: Promise<AutonomousRuntime> | null = null;

async function buildAndStartRuntime(): Promise<AutonomousRuntime> {
  const agent = await provisionSingleRoleAgent(SYSTEM_RUNTIME_OWNER, 'strategic', { mode: 'paper' });

  const config: KairosCompositionConfig = {
    agentId: agent.id,
    userPolicy: buildDefaultUserPolicy(agent.id),
    // Known limitation — see file header: no real adapter is registered. Route/Execution stages
    // fail closed ("no route candidates") until a real adapter is wired here.
    protocolRegistry: new ProtocolRegistry(),
    network: getNetwork(),
    telemetryProvider: replayTelemetryProvider,
    // Replay only — never real capital. See file header.
    executionTarget: createExecutionTarget({ kind: 'replay' }),
    intervalMs: getSchedulerIntervalMs(),
  };

  // Note: createRuntime(config) below builds its own internal KairosPipelineRunner from this same
  // config (AutonomousRuntime holds it privately — see runtime/autonomousRuntime/runtime.ts,
  // deliberately left untouched here). `pipelineRunnerInstance` here is a second, functionally
  // equivalent instance built from the identical config, kept only so `runOnce()` below has a
  // real runner to call on demand without reaching into AutonomousRuntime's private field or
  // adding a new public method to the frozen-adjacent runtime.ts. Both instances wrap the exact
  // same stateless composition (createPipelineStages(config)) — no divergent behavior results
  // from there being two instances, only two independent call sites into the same wiring.
  pipelineRunnerInstance = createPipelineRunner(config);
  const runtime = createRuntime(config);
  await runtime.start();
  return runtime;
}

/** Idempotent bootstrap of the process-wide AutonomousRuntime. Concurrent callers all await the
 *  same in-flight init (via `initPromise`) rather than racing to build/start two instances; once
 *  resolved, every subsequent call returns the same cached instance without rebuilding it. */
export async function initRuntime(): Promise<AutonomousRuntime> {
  if (runtimeInstance) return runtimeInstance;
  if (!initPromise) {
    initPromise = buildAndStartRuntime()
      .then((runtime) => {
        runtimeInstance = runtime;
        return runtime;
      })
      .catch((error) => {
        // A failed init must not leave a stale in-flight promise behind — the next initRuntime()
        // call should retry, not await a promise that will never resolve.
        initPromise = null;
        throw error;
      });
  }
  return initPromise;
}

export function getRuntime(): AutonomousRuntime | null {
  return runtimeInstance;
}

/** Runs exactly one pipeline cycle on-demand (e.g. `POST /api/dev/validation/run`), returning the
 *  full per-stage `PipelineResult` rather than the narrow `{success, error?}` the scheduler's
 *  internal tick uses. AutonomousRuntime.executeOnce() is private and intentionally not exposed
 *  (the frozen-adjacent runtime.ts is left untouched) — instead this calls the same
 *  KairosPipelineRunner.run() this singleton already built for the runtime, which is the exact
 *  underlying pipeline the scheduler itself invokes every tick. This does NOT go through the
 *  runtime's scheduler/state machine or its executionCount/failureCount bookkeeping — it is a
 *  side, on-demand run against the same composed pipeline, same as Benchmark Core's own
 *  ad hoc `runner.run()` calls in benchmarkIntegration.test.ts. */
export async function runOnce(): Promise<PipelineResult> {
  if (!pipelineRunnerInstance) {
    throw new Error('Runtime is not initialized — call initRuntime() first.');
  }
  return pipelineRunnerInstance.run();
}
