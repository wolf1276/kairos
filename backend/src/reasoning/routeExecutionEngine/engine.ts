// Execution Engine (Phase 7) orchestrator: ExecutionPlan + ExecutionRoute -> ExecutionResult.
// Deterministic given a deterministic adapter registry — no AI/LLM, no blockchain execution
// (never signs or submits). Pipeline: Protocol Adapter -> Transaction Builder -> [real XDR/
// resource assembly, if a provider is registered] -> Simulation -> Validation -> Fee Estimation
// -> Unsigned Transaction -> ExecutionResult. Never calls `adapter.execute()` — this engine only
// ever builds and simulates an *unsigned* transaction.
import { randomUUID } from 'crypto';
import type { ProtocolRegistry } from '../../protocolAdapters/registry.js';
import { AdapterNotFoundError } from '../../protocolAdapters/registry.js';
import { adapterActionFor } from '../routeEngine/discovery.js';
import { hashRouteRequest } from '../routeEngine/hashing.js';
import { hashExecutionResult } from './hashing.js';
import { computeSyntheticResourceEstimate, encodeSyntheticXdr } from './resourceEstimate.js';
import { withRetry } from './retry.js';
import {
  checkAdapterIdentity,
  checkFeeEstimate,
  checkRealTransactionDetail,
  checkRouteFreshness,
  checkRouteSelected,
  checkSimulationSuccess,
  checkSimulationWellFormed,
  checkTransactionIntegrity,
  checkTransactionWellFormed,
  checkValidationOk,
  type RuleFailure,
} from './rules.js';
import { DEFAULT_RETRY_POLICY, EXECUTION_ENGINE_VERSION } from './types.js';
import type { AdapterActionRequest, SimulationResult, TransactionBuilder } from '../../protocolAdapters/types.js';
import type { ExecutionPlan } from '../executionPlanner/types.js';
import type { ExecutionRoute } from '../routeEngine/types.js';
import type { DataSource, ExecuteRouteOptions, ExecutionResult, ResourceEstimate } from './types.js';

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

function buildAdapterRequest(route: ExecutionRoute): AdapterActionRequest {
  const { request } = route;
  const params: Record<string, unknown> = { ...(request.adapterParams ?? {}) };
  if (request.outputAsset) params.outputAsset = request.outputAsset;
  if (request.path) params.path = request.path;
  return {
    action: adapterActionFor(request.action),
    asset: request.asset,
    network: request.network,
    amount: request.amount,
    params,
  };
}

interface StageResult {
  failure: RuleFailure | null;
  retryCount: number;
  transaction: TransactionBuilder | null;
  simulation: SimulationResult | null;
  estimatedFees: string | null;
  unsignedXdr: string | null;
  resourceEstimate: ResourceEstimate | null;
  dataSource: DataSource;
}

/**
 * Runs the Execution Engine pipeline for one ExecutionRoute. Always resolves — a pipeline failure
 * (unhealthy adapter, failed simulation, forged transaction, ...) never throws; it's recorded as
 * `status: 'failed'` with `metadata.failureReason`/`errorMessage` instead, so a caller always gets
 * a structured, hashable result back (fail-closed, never a silent partial success).
 */
export async function executeRoute(plan: ExecutionPlan, route: ExecutionRoute, registry: ProtocolRegistry, options: ExecuteRouteOptions = {}): Promise<ExecutionResult> {
  const now = options.now ?? Date.now;
  const executionId = options.executionId ?? randomUUID();
  const maxAttempts = Math.max(1, options.retryPolicy?.maxAttempts ?? DEFAULT_RETRY_POLICY.maxAttempts);
  const routeTtlMs = options.routeTtlMs ?? 60_000;
  const startedAt = now();

  const outcome = await runPipeline(plan, route, registry, { now, maxAttempts, routeTtlMs, realTransactionProviders: options.realTransactionProviders ?? {} });

  const completedAt = now();
  const protocol = route.selectedProtocol ?? 'unknown';
  const requestHash = hashRouteRequest(route.request);

  const resultBase: Omit<ExecutionResult, 'executionHash' | 'executionId'> = {
    transactionXDR: outcome.unsignedXdr,
    transaction: outcome.transaction,
    simulationResult: outcome.simulation,
    estimatedFees: outcome.estimatedFees,
    resourceEstimate: outcome.resourceEstimate,
    protocol,
    route,
    status: outcome.failure === null ? 'success' : 'failed',
    metadata: {
      engineVersion: EXECUTION_ENGINE_VERSION,
      planExecutionId: plan.executionId,
      planHash: plan.planHash,
      routeHash: route.routeHash,
      requestHash,
      executionHash: 'pending',
      retryCount: outcome.retryCount,
      failureReason: outcome.failure?.reason ?? null,
      errorMessage: outcome.failure?.message ?? null,
      dataSource: outcome.dataSource,
      startedAt,
      completedAt,
      durationMs: completedAt - startedAt,
    },
  };

  const executionHash = hashExecutionResult(resultBase);
  const finalResult: ExecutionResult = {
    ...resultBase,
    executionId,
    executionHash,
    metadata: { ...resultBase.metadata, executionHash },
  };
  return deepFreeze(finalResult);
}

interface PipelineContext {
  now: () => number;
  maxAttempts: number;
  routeTtlMs: number;
  realTransactionProviders: NonNullable<ExecuteRouteOptions['realTransactionProviders']>;
}

function emptyStage(failure: RuleFailure, retryCount: number, extra: Partial<StageResult> = {}): StageResult {
  return { failure, retryCount, transaction: null, simulation: null, estimatedFees: null, unsignedXdr: null, resourceEstimate: null, dataSource: 'synthetic', ...extra };
}

async function runPipeline(_plan: ExecutionPlan, route: ExecutionRoute, registry: ProtocolRegistry, ctx: PipelineContext): Promise<StageResult> {
  let retryCount = 0;

  const notSelected = checkRouteSelected(route);
  if (notSelected) return emptyStage(notSelected, retryCount);

  const stale = checkRouteFreshness(route, ctx.now(), ctx.routeTtlMs);
  if (stale) return emptyStage(stale, retryCount);

  const protocol = route.selectedProtocol as string;

  let adapter;
  try {
    adapter = registry.lookup(protocol);
  } catch (err) {
    if (err instanceof AdapterNotFoundError) {
      return emptyStage({ reason: 'adapter_not_found', message: err.message }, retryCount);
    }
    throw err;
  }

  const identitySpoof = checkAdapterIdentity(protocol, adapter.protocol);
  if (identitySpoof) return emptyStage(identitySpoof, retryCount);

  if (!adapter.buildTransaction) {
    return emptyStage({ reason: 'transaction_build_unsupported', message: `protocol '${protocol}' does not implement buildTransaction()` }, retryCount);
  }

  const request = buildAdapterRequest(route);

  // ── Transaction Builder ──────────────────────────────────────────────────────────────────
  const buildOutcome = await withRetry(() => adapter.buildTransaction!(request), ctx.maxAttempts);
  retryCount += buildOutcome.attempts - 1;
  if (!buildOutcome.ok) {
    return emptyStage({ reason: 'transaction_build_failed', message: buildOutcome.error }, retryCount);
  }
  const malformedTx = checkTransactionWellFormed(buildOutcome.value);
  if (malformedTx) return emptyStage(malformedTx, retryCount);
  const forgedTx = checkTransactionIntegrity(buildOutcome.value);
  if (forgedTx) return emptyStage(forgedTx, retryCount, { transaction: buildOutcome.value });
  const transaction = buildOutcome.value;

  // ── Real transaction assembly (if this protocol has a live Soroban integration registered) ──
  // Independent of `adapter.simulate()` below — a real provider runs its own
  // `simulateTransaction` to fold real resource/fee data into the transaction before returning
  // its XDR (see `protocolAdapters/aquarius/realTransactionBuilder.ts`). A protocol with no
  // provider here always falls back to the synthetic path — recorded via `dataSource`, never
  // silently mixed with real data.
  let unsignedXdr: string;
  let resourceEstimate: ResourceEstimate;
  let dataSource: DataSource;
  const provider = ctx.realTransactionProviders[protocol];
  if (provider) {
    const realOutcome = await withRetry(() => provider(transaction), ctx.maxAttempts);
    retryCount += realOutcome.attempts - 1;
    if (!realOutcome.ok) {
      return emptyStage({ reason: 'transaction_build_failed', message: `real transaction provider failed: ${realOutcome.error}` }, retryCount, { transaction });
    }
    if (!realOutcome.value.success) {
      return emptyStage({ reason: 'malformed_xdr', message: `real transaction provider reported simulation failure: ${realOutcome.value.errors.join('; ')}` }, retryCount, { transaction });
    }
    const malformedReal = checkRealTransactionDetail(realOutcome.value.unsignedXdr, realOutcome.value.resourceEstimate);
    if (malformedReal) return emptyStage(malformedReal, retryCount, { transaction });
    unsignedXdr = realOutcome.value.unsignedXdr;
    resourceEstimate = realOutcome.value.resourceEstimate;
    dataSource = 'real';
  } else {
    unsignedXdr = encodeSyntheticXdr(transaction);
    resourceEstimate = computeSyntheticResourceEstimate(transaction);
    dataSource = 'synthetic';
  }

  // ── Simulation (through the adapter's Soroban RPC integration) ──────────────────────────
  const simOutcome = await withRetry(() => adapter.simulate(request), ctx.maxAttempts);
  retryCount += simOutcome.attempts - 1;
  if (!simOutcome.ok) {
    return emptyStage({ reason: 'simulation_failed', message: `Soroban RPC unavailable: ${simOutcome.error}` }, retryCount, { transaction, unsignedXdr, resourceEstimate, dataSource });
  }
  const malformedSim = checkSimulationWellFormed(simOutcome.value);
  if (malformedSim) return emptyStage(malformedSim, retryCount, { transaction, unsignedXdr, resourceEstimate, dataSource });
  const simFailed = checkSimulationSuccess(simOutcome.value);
  if (simFailed) return emptyStage(simFailed, retryCount, { transaction, simulation: simOutcome.value, unsignedXdr, resourceEstimate, dataSource });
  const simulation = simOutcome.value;

  // ── Validation ────────────────────────────────────────────────────────────────────────────
  const validateOutcome = await withRetry(() => adapter.validate(request), ctx.maxAttempts);
  retryCount += validateOutcome.attempts - 1;
  if (!validateOutcome.ok) {
    return emptyStage({ reason: 'validation_failed', message: validateOutcome.error }, retryCount, { transaction, simulation, unsignedXdr, resourceEstimate, dataSource });
  }
  const invalid = checkValidationOk(validateOutcome.value.ok, validateOutcome.value.errors);
  if (invalid) return emptyStage(invalid, retryCount, { transaction, simulation, unsignedXdr, resourceEstimate, dataSource });

  // ── Fee estimation ────────────────────────────────────────────────────────────────────────
  const feeOutcome = await withRetry(() => adapter.estimateFees(request), ctx.maxAttempts);
  retryCount += feeOutcome.attempts - 1;
  if (!feeOutcome.ok) {
    return emptyStage({ reason: 'fee_estimation_failed', message: feeOutcome.error }, retryCount, { transaction, simulation, unsignedXdr, resourceEstimate, dataSource });
  }
  const malformedFee = checkFeeEstimate(feeOutcome.value);
  if (malformedFee) return emptyStage(malformedFee, retryCount, { transaction, simulation, unsignedXdr, resourceEstimate, dataSource });

  // ── Unsigned Transaction (already built above; nothing further happens to it — never signed) ─
  return { failure: null, retryCount, transaction, simulation, estimatedFees: feeOutcome.value, unsignedXdr, resourceEstimate, dataSource };
}
