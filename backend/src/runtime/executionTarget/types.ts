// Types for Execution Target (Phase 4). Pure abstraction over "where" an ExecutionPlan's routed
// step actually runs — Replay (deterministic, no real providers), Testnet (real providers against
// testnet), Mainnet (stub, fail closed). Zero business logic: an ExecutionTarget only decides
// which ExecuteRouteOptions to hand to the frozen Execution Engine's `executeRoute()`, never
// re-implements any of its rules.
import type { ProtocolRegistry } from '../../protocolAdapters/registry.js';
import type {
  ExecutionPlan,
} from '../../reasoning/executionPlanner/index.js';
import type { ExecutionRoute } from '../../reasoning/routeEngine/index.js';
import type {
  ExecutionResult,
  RealTransactionProvider,
  RetryPolicy,
} from '../../reasoning/routeExecutionEngine/index.js';

export const EXECUTION_TARGET_KINDS = ['replay', 'testnet', 'mainnet'] as const;
export type ExecutionTargetKind = (typeof EXECUTION_TARGET_KINDS)[number];

/** Common constructor options every ExecutionTarget accepts — injected, never read from a global
 *  or env var directly. */
export interface ExecutionTargetOptions {
  retryPolicy?: RetryPolicy;
  routeTtlMs?: number;
  now?: () => number;
  executionId?: string;
}

/** Constructor options for TestnetTarget — real transaction providers are supplied by the caller
 *  (Composition Root), never constructed here. */
export interface TestnetTargetOptions extends ExecutionTargetOptions {
  realTransactionProviders?: Record<string, RealTransactionProvider>;
}

export interface ExecutionTarget {
  readonly kind: ExecutionTargetKind;
  execute(plan: ExecutionPlan, route: ExecutionRoute, protocolRegistry: ProtocolRegistry): Promise<ExecutionResult>;
}

/** Thrown by MainnetTarget (stub) and by invalid ExecutionTarget configuration — fail-closed by
 *  construction, never a silent no-op. */
export class ExecutionTargetError extends Error {}
