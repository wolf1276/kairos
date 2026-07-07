// TestnetTarget (Phase 4) — executes against testnet using whichever real transaction providers
// the caller injects; a protocol with no entry falls back to the Execution Engine's own synthetic
// path (never this target's concern — it only forwards options).
import { executeRoute } from '../../reasoning/routeExecutionEngine/index.js';
import type { ProtocolRegistry } from '../../protocolAdapters/registry.js';
import type { ExecutionPlan } from '../../reasoning/executionPlanner/index.js';
import type { ExecutionRoute } from '../../reasoning/routeEngine/index.js';
import type { ExecutionResult } from '../../reasoning/routeExecutionEngine/index.js';
import type { ExecutionTarget, TestnetTargetOptions } from './types.js';
import { ExecutionTargetError } from './types.js';

export class TestnetTarget implements ExecutionTarget {
  readonly kind = 'testnet' as const;

  constructor(private readonly options: TestnetTargetOptions = {}) {
    if (options.realTransactionProviders !== undefined) {
      if (typeof options.realTransactionProviders !== 'object' || options.realTransactionProviders === null) {
        throw new ExecutionTargetError('TestnetTarget: realTransactionProviders must be a record of protocol -> RealTransactionProvider');
      }
      for (const [protocol, provider] of Object.entries(options.realTransactionProviders)) {
        if (typeof provider !== 'function') {
          throw new ExecutionTargetError(`TestnetTarget: realTransactionProviders["${protocol}"] must be a function`);
        }
      }
    }
  }

  async execute(plan: ExecutionPlan, route: ExecutionRoute, protocolRegistry: ProtocolRegistry): Promise<ExecutionResult> {
    return executeRoute(plan, route, protocolRegistry, {
      retryPolicy: this.options.retryPolicy,
      routeTtlMs: this.options.routeTtlMs,
      now: this.options.now,
      executionId: this.options.executionId,
      realTransactionProviders: this.options.realTransactionProviders,
    });
  }
}
