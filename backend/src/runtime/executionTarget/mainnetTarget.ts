// MainnetTarget (Phase 4) — stub, fails closed. Real mainnet settlement (signing/broadcasting
// funds-moving transactions) is out of scope for this system; this target exists only so
// selection/wiring code has a named mainnet option, and it always refuses to execute rather than
// silently falling back to replay/testnet behavior.
import type { ProtocolRegistry } from '../../protocolAdapters/registry.js';
import type { ExecutionPlan } from '../../reasoning/executionPlanner/index.js';
import type { ExecutionRoute } from '../../reasoning/routeEngine/index.js';
import type { ExecutionResult } from '../../reasoning/routeExecutionEngine/index.js';
import type { ExecutionTarget, ExecutionTargetOptions } from './types.js';
import { ExecutionTargetError } from './types.js';

export class MainnetTarget implements ExecutionTarget {
  readonly kind = 'mainnet' as const;

  constructor(private readonly options: ExecutionTargetOptions = {}) {}

  async execute(_plan: ExecutionPlan, _route: ExecutionRoute, _protocolRegistry: ProtocolRegistry): Promise<ExecutionResult> {
    throw new ExecutionTargetError('MainnetTarget is a stub and fails closed — mainnet execution is not implemented');
  }
}
