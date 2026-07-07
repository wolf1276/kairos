// Types for Pipeline Composition (Phase 13) — the Composition Root. Pure configuration/wiring
// shapes; no business logic. Everything the frozen engines need but cannot derive themselves
// (agent identity, user policy, provider config, protocol registry, network, telemetry source)
// is supplied here via constructor injection so createPipelineStages() never reaches for a
// global or hidden singleton.
import type { ProtocolRegistry } from '../../protocolAdapters/registry.js';
import type { PlanRouteRequestOptions } from '../../reasoning/routeEngine/index.js';
import type { ExecutionTarget } from '../executionTarget/index.js';
import type { RouteEngineOptions } from '../../reasoning/routeEngine/index.js';
import type { ExecutionResult } from '../../reasoning/routeExecutionEngine/index.js';
import type { OutcomeTelemetry } from '../../reasoning/outcomeRecorder/index.js';
import type { UserPolicy } from '../../reasoning/index.js';
import type { DecisionIntelligenceProviderConfig } from '../../reasoning/decisionIntelligence/requestClient.js';
import type { BuildContextOptions } from '../../agentContext/contextBuilder.js';
import type { RuntimeLogger, RuntimePersistenceProvider, ProviderAvailabilityCheck } from '../autonomousRuntime/index.js';
import type { PipelineRunnerLogger } from '../pipelineRunner/index.js';

/** Derives the post-submission facts the Outcome Recorder needs (Phase 8, frozen) from a built
 *  ExecutionResult. Injected because the Execution Engine only ever builds/simulates an unsigned
 *  transaction — real settlement facts (transaction hash, executed amount, slippage, balances)
 *  only exist once something outside this pipeline has actually submitted and watched the
 *  transaction. Composition wires whichever source is appropriate (paper-trading synthetic
 *  deriver, or a real chain-watcher) without the Pipeline Runner ever knowing which. */
export type TelemetryProvider = (executionResult: ExecutionResult) => OutcomeTelemetry | Promise<OutcomeTelemetry>;

export interface KairosCompositionConfig {
  /** Agent this pipeline run reasons/acts on behalf of. */
  agentId: string;
  /** Account owner's outer policy boundary, layered into ReasoningContext. */
  userPolicy: UserPolicy;
  /** Already-registered ProtocolRegistry — building/registering adapters is out of scope for
   *  composition; it only wires the registry into the stages that need it. */
  protocolRegistry: ProtocolRegistry;
  /** Network passed to the Route Engine's plan adapter (e.g. 'testnet' / 'public'). */
  network: string;
  /** Decision Intelligence provider config — defaults to `getProviderConfigFromEnv()` reused
   *  as-is; override to pin a specific provider/model for this composition. */
  decisionIntelligenceConfig?: DecisionIntelligenceProviderConfig;
  telemetryProvider: TelemetryProvider;
  contextOptions?: BuildContextOptions;
  routeOptions?: Partial<PlanRouteRequestOptions & RouteEngineOptions>;
  /** Where the routed step actually executes (Phase 4) — Replay/Testnet/Mainnet. Constructor-
   *  injected by the caller; Composition never selects or constructs one itself. */
  executionTarget: ExecutionTarget;

  /** Autonomous Runtime (Phase 11, frozen) wiring. */
  intervalMs: number;
  runtimeLogger?: RuntimeLogger;
  runtimePersistence?: RuntimePersistenceProvider;
  checkProviderAvailability?: ProviderAvailabilityCheck;

  /** Pipeline Runner (Phase 12, frozen) wiring. */
  pipelineLogger?: PipelineRunnerLogger;
}
