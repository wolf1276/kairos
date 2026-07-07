// Public surface of Execution Target (Phase 4). Callers import only from here.
export { ReplayTarget } from './replayTarget.js';
export { TestnetTarget } from './testnetTarget.js';
export { MainnetTarget } from './mainnetTarget.js';
export { createExecutionTarget } from './factory.js';
export type { ExecutionTargetSelection } from './factory.js';
export { EXECUTION_TARGET_KINDS, ExecutionTargetError } from './types.js';
export type {
  ExecutionTargetKind,
  ExecutionTarget,
  ExecutionTargetOptions,
  TestnetTargetOptions,
} from './types.js';
