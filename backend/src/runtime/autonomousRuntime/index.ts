// Public surface of the Autonomous Runtime (Phase 11). Callers import only from here.
export { AutonomousRuntime, AUTONOMOUS_RUNTIME_VERSION } from './runtime.js';
export { Scheduler } from './scheduler.js';
export { assertValidTransition, canTransition } from './stateMachine.js';
export { InMemoryRuntimePersistenceProvider, FileRuntimePersistenceProvider } from './persistence.js';
export { consoleRuntimeLogger } from './logger.js';
export { RUNTIME_STATES, InvalidStateTransitionError } from './types.js';
export type {
  RuntimeState,
  PipelineRunner,
  PipelineRunResult,
  Heartbeat,
  HealthReport,
  ComponentHealthStatus,
  RuntimeSnapshot,
  RuntimePersistenceProvider,
  RuntimeLogger,
  ProviderAvailabilityCheck,
  AutonomousRuntimeOptions,
} from './types.js';
