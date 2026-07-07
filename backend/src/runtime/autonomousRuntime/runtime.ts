// Autonomous Runtime (Phase 11): orchestrates lifecycle, scheduling, health, and recovery around
// the existing, frozen Kairos pipeline. Contains NO reasoning/trading logic — it only ever calls
// `pipelineRunner.runPipeline()` and never inspects how Context, Memory, Reasoning, Verification,
// Planning, Routing, or Execution work internally.
import { consoleRuntimeLogger } from './logger.js';
import { InMemoryRuntimePersistenceProvider } from './persistence.js';
import { Scheduler } from './scheduler.js';
import { assertValidTransition } from './stateMachine.js';
import {
  AUTONOMOUS_RUNTIME_VERSION,
  type AutonomousRuntimeOptions,
  type HealthReport,
  type Heartbeat,
  type PipelineRunner,
  type ProviderAvailabilityCheck,
  type RuntimeLogger,
  type RuntimePersistenceProvider,
  type RuntimeSnapshot,
  type RuntimeState,
} from './types.js';

export { AUTONOMOUS_RUNTIME_VERSION };

export class AutonomousRuntime {
  private state: RuntimeState = 'STOPPED';
  private readonly pipelineRunner: PipelineRunner;
  private readonly scheduler: Scheduler;
  private readonly persistence: RuntimePersistenceProvider;
  private readonly logger: RuntimeLogger;
  private readonly providerName: string | null;
  private readonly model: string | null;
  private readonly checkProviderAvailability: ProviderAvailabilityCheck | null;

  private startedAt: number | null = null;
  private lastExecutionAt: number | null = null;
  private executionCount = 0;
  private failureCount = 0;
  private lastPipelineError: string | null = null;
  /** Tracks the in-flight execution (if any) so stop() can wait for it — graceful shutdown. */
  private inFlightExecution: Promise<void> | null = null;

  constructor(options: AutonomousRuntimeOptions) {
    this.pipelineRunner = options.pipelineRunner;
    this.persistence = options.persistence ?? new InMemoryRuntimePersistenceProvider();
    this.logger = options.logger ?? consoleRuntimeLogger;
    this.providerName = options.providerName ?? null;
    this.model = options.model ?? null;
    this.checkProviderAvailability = options.checkProviderAvailability ?? null;
    this.scheduler = new Scheduler(options.intervalMs, () => this.executeOnce());
  }

  getState(): RuntimeState {
    return this.state;
  }

  private transition(to: RuntimeState): void {
    assertValidTransition(this.state, to);
    const from = this.state;
    this.state = to;
    this.logger.info(`state transition ${from} -> ${to}`, { from, to });
    this.persistSnapshot();
  }

  private persistSnapshot(): void {
    const snapshot: RuntimeSnapshot = {
      state: this.state,
      executionCount: this.executionCount,
      failureCount: this.failureCount,
      lastExecutionAt: this.lastExecutionAt,
      savedAt: Date.now(),
    };
    this.persistence.save(snapshot);
  }

  /** Idempotent: starting an already-running runtime is a no-op rather than an error, since a
   *  supervisor may call start() unconditionally on boot. Recovers prior counters from the last
   *  persisted snapshot (restart recovery) before entering RUNNING. */
  async start(): Promise<void> {
    if (this.state === 'RUNNING' || this.state === 'STARTING') return;
    if (this.state !== 'STOPPED') {
      throw new Error(`Cannot start runtime from state ${this.state}`);
    }

    const prior = this.persistence.load();
    if (prior) {
      this.executionCount = prior.executionCount;
      this.failureCount = prior.failureCount;
      this.lastExecutionAt = prior.lastExecutionAt;
      this.logger.info('recovered runtime snapshot from persistence', { prior });
    }

    this.transition('STARTING');
    this.startedAt = Date.now();
    this.transition('RUNNING');
    this.scheduler.start();
  }

  /** RUNNING -> PAUSED. Stops scheduling new cycles; an in-flight execution is left to finish. */
  pause(): void {
    if (this.state === 'PAUSED') return;
    this.transition('PAUSED');
    this.scheduler.stop();
  }

  /** PAUSED -> RUNNING. */
  resume(): void {
    if (this.state === 'RUNNING') return;
    this.transition('RUNNING');
    this.scheduler.start();
  }

  /** Graceful shutdown: stops scheduling, awaits any in-flight execution, then STOPPED. Safe to
   *  call from RUNNING or PAUSED; a no-op if already stopped/stopping. */
  async stop(): Promise<void> {
    if (this.state === 'STOPPED' || this.state === 'STOPPING') return;
    this.transition('STOPPING');
    this.scheduler.stop();
    if (this.inFlightExecution) {
      await this.inFlightExecution.catch(() => undefined);
    }
    this.startedAt = null;
    this.transition('STOPPED');
  }

  /** Runs one pipeline cycle. Never throws — pipeline failures increment failureCount and are
   *  logged, but never take down the runtime (fail closed, "never terminate on one failure"). */
  private async executeOnce(): Promise<void> {
    const run = (async () => {
      try {
        const result = await this.pipelineRunner.runPipeline();
        this.lastExecutionAt = Date.now();
        this.executionCount += 1;
        if (!result.success) {
          this.failureCount += 1;
          this.lastPipelineError = result.error ?? 'unknown pipeline failure';
          this.logger.warn('pipeline execution failed', { error: this.lastPipelineError });
        } else {
          this.lastPipelineError = null;
        }
      } catch (error) {
        this.lastExecutionAt = Date.now();
        this.executionCount += 1;
        this.failureCount += 1;
        this.lastPipelineError = error instanceof Error ? error.message : String(error);
        this.logger.error('pipeline execution threw', { error: this.lastPipelineError });
      } finally {
        this.persistSnapshot();
        this.inFlightExecution = null;
      }
    })();
    this.inFlightExecution = run;
    await run;
  }

  getHeartbeat(): Heartbeat {
    return {
      status: this.state,
      uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
      lastExecutionAt: this.lastExecutionAt,
      nextExecutionAt: this.scheduler.getNextExecutionAt(),
      executionCount: this.executionCount,
      failureCount: this.failureCount,
      provider: this.providerName,
      model: this.model,
    };
  }

  async getHealth(): Promise<HealthReport> {
    let provider: HealthReport['provider'] = 'ok';
    if (this.checkProviderAvailability) {
      try {
        provider = (await this.checkProviderAvailability()) ? 'ok' : 'down';
      } catch {
        provider = 'down';
      }
    }
    return {
      runtime: this.state === 'STOPPED' ? 'degraded' : 'ok',
      scheduler: this.state === 'RUNNING' ? (this.scheduler.isActive() ? 'ok' : 'degraded') : 'ok',
      pipelineRunner: this.lastPipelineError ? 'degraded' : 'ok',
      provider,
    };
  }
}
