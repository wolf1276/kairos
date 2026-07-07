// Execution Target selection (Phase 4). Pure wiring: given a kind + options, returns the matching
// ExecutionTarget. Never falls back silently on an unknown kind — fails closed.
import { ReplayTarget } from './replayTarget.js';
import { TestnetTarget } from './testnetTarget.js';
import { MainnetTarget } from './mainnetTarget.js';
import { EXECUTION_TARGET_KINDS, ExecutionTargetError } from './types.js';
import type { ExecutionTarget, ExecutionTargetKind, ExecutionTargetOptions, TestnetTargetOptions } from './types.js';

export type ExecutionTargetSelection =
  | { kind: 'replay'; options?: ExecutionTargetOptions }
  | { kind: 'testnet'; options?: TestnetTargetOptions }
  | { kind: 'mainnet'; options?: ExecutionTargetOptions };

export function createExecutionTarget(selection: ExecutionTargetSelection): ExecutionTarget {
  if (!EXECUTION_TARGET_KINDS.includes(selection.kind)) {
    throw new ExecutionTargetError(`Unknown execution target kind: "${selection.kind}"`);
  }
  switch (selection.kind) {
    case 'replay':
      return new ReplayTarget(selection.options);
    case 'testnet':
      return new TestnetTarget(selection.options);
    case 'mainnet':
      return new MainnetTarget(selection.options);
  }
}
