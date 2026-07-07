// ReplayTarget (Phase 4) — deterministic replay execution. Never wires real transaction
// providers, even if a caller mistakenly constructs one alongside providers meant for another
// target: replay must always produce the synthetic, fully-deterministic ExecutionResult so the
// same plan/route pair replays identically every time.
import { executeRoute } from '../../reasoning/routeExecutionEngine/index.js';
import type { ProtocolRegistry } from '../../protocolAdapters/registry.js';
import type { ExecutionPlan } from '../../reasoning/executionPlanner/index.js';
import type { ExecutionRoute } from '../../reasoning/routeEngine/index.js';
import type { ExecutionResult } from '../../reasoning/routeExecutionEngine/index.js';
import type { ExecutionTarget, ExecutionTargetOptions } from './types.js';

export class ReplayTarget implements ExecutionTarget {
  readonly kind = 'replay' as const;

  constructor(private readonly options: ExecutionTargetOptions = {}) {}

  async execute(plan: ExecutionPlan, route: ExecutionRoute, protocolRegistry: ProtocolRegistry): Promise<ExecutionResult> {
    return executeRoute(plan, route, protocolRegistry, {
      retryPolicy: this.options.retryPolicy,
      routeTtlMs: this.options.routeTtlMs,
      now: this.options.now,
      executionId: this.options.executionId,
      // deliberately no realTransactionProviders — replay is always synthetic/deterministic.
    });
  }
}
