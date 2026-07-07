// Types for the Autonomous Runtime (Phase 11). This layer owns lifecycle, scheduling, health,
// and recovery only — it never contains reasoning/trading logic. It calls the existing pipeline
// through a single narrow PipelineRunner interface and knows nothing about Context, Memory,
// Reasoning, Verification, Planning, Routing, or Execution internals.

export const AUTONOMOUS_RUNTIME_VERSION = '1.0.0';

export const RUNTIME_STATES = ['STOPPED', 'STARTING', 'RUNNING', 'PAUSED', 'STOPPING'] as const;
export type RuntimeState = (typeof RUNTIME_STATES)[number];

/** Result of a single pipeline execution. The Runtime never inspects the reason for failure
 *  beyond this boolean+message pair — it fails closed and moves on to the next scheduled cycle. */
export interface PipelineRunResult {
  success: boolean;
  error?: string;
}

/** The only surface the Runtime is allowed to call into the existing Kairos pipeline through. */
export interface PipelineRunner {
  runPipeline(): Promise<PipelineRunResult>;
}

export type ComponentHealthStatus = 'ok' | 'degraded' | 'down';

export interface HealthReport {
  runtime: ComponentHealthStatus;
  scheduler: ComponentHealthStatus;
  pipelineRunner: ComponentHealthStatus;
  provider: ComponentHealthStatus;
}

export interface Heartbeat {
  status: RuntimeState;
  uptimeMs: number;
  lastExecutionAt: number | null;
  nextExecutionAt: number | null;
  executionCount: number;
  failureCount: number;
  provider: string | null;
  model: string | null;
}

/** Persisted across restarts so the Runtime can resume where it left off. */
export interface RuntimeSnapshot {
  state: RuntimeState;
  executionCount: number;
  failureCount: number;
  lastExecutionAt: number | null;
  savedAt: number;
}

export interface RuntimePersistenceProvider {
  load(): RuntimeSnapshot | null;
  save(snapshot: RuntimeSnapshot): void;
}

export interface RuntimeLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface ProviderAvailabilityCheck {
  (): Promise<boolean> | boolean;
}

export interface AutonomousRuntimeOptions {
  pipelineRunner: PipelineRunner;
  /** Scheduler interval in milliseconds (e.g. 60_000 for "every minute"). */
  intervalMs: number;
  persistence?: RuntimePersistenceProvider;
  logger?: RuntimeLogger;
  providerName?: string;
  model?: string;
  checkProviderAvailability?: ProviderAvailabilityCheck;
}

export class InvalidStateTransitionError extends Error {
  readonly from: RuntimeState;
  readonly to: RuntimeState;
  constructor(from: RuntimeState, to: RuntimeState) {
    super(`Invalid runtime state transition: ${from} -> ${to}`);
    this.name = 'InvalidStateTransitionError';
    this.from = from;
    this.to = to;
  }
}
