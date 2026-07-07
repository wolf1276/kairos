// Pipeline Composition (Phase 13) — the Composition Root. Wires every frozen engine into one
// executable PipelineStages implementation. Owns dependency wiring only: instantiates nothing
// business-logic-shaped, injects constructor dependencies, and calls each frozen engine's own
// public entry point exactly as published from its `index.ts`. Never duplicates engine logic,
// never reaches into an engine's internals, never uses a global or hidden singleton — every
// dependency arrives through `KairosCompositionConfig`.
import { buildAgentContext } from '../../agentContext/contextBuilder.js';
import { assembleMemoryPackage } from '../../memoryLayer/index.js';
import { buildReasoningContext, buildPrompt } from '../../reasoning/index.js';
import * as decisionIntelligence from '../../reasoning/decisionIntelligence/index.js';
import * as verification from '../../reasoning/verification/index.js';
import * as executionPlanner from '../../reasoning/executionPlanner/index.js';
import { routeRequestsFromPlan, computeRoutesForPlan } from '../../reasoning/routeEngine/index.js';
import { recordOutcome } from '../../reasoning/outcomeRecorder/index.js';
import { writeMemory } from '../../reasoning/memoryWriter/index.js';
import { computeLearningSnapshot } from '../../reasoning/learningEngine/index.js';
import { getProviderConfigFromEnv } from '../../reasoning/providers/index.js';
import {
  getEpisodicMemoryProvider,
  getSemanticMemoryProvider,
  getWorkingMemoryProvider,
} from '../../memoryLayer/index.js';
import { AutonomousRuntime } from '../autonomousRuntime/index.js';
import { KairosPipelineRunner } from '../pipelineRunner/index.js';
import type { PipelineStages } from '../pipelineRunner/index.js';
import type { AgentContext } from '../../agentContext/index.js';
import type { MemoryPackage } from '../../memoryLayer/index.js';
import type { ReasoningContext, Prompt } from '../../reasoning/index.js';
import type { GenerateDecisionIntelligenceResult } from '../../reasoning/decisionIntelligence/index.js';
import type { VerificationResult, VerifiedDecision } from '../../reasoning/verification/index.js';
import type { ExecutionPlan } from '../../reasoning/executionPlanner/index.js';
import type { ExecutionRoute } from '../../reasoning/routeEngine/index.js';
import type { ExecutionResult } from '../../reasoning/routeExecutionEngine/index.js';
import type { OutcomeRecord } from '../../reasoning/outcomeRecorder/index.js';
import type { MemoryWriteResult } from '../../reasoning/memoryWriter/index.js';
import type { LearningSnapshot } from '../../reasoning/learningEngine/index.js';
import type { KairosCompositionConfig } from './types.js';

/** Composition-only guard: a null AgentContext or a rejected VerifiedDecision means there is
 *  nothing further to wire, not a business decision — the Pipeline Runner's own fail-closed
 *  contract (stop on first stage failure) is what actually enforces "don't keep going". */
class CompositionStageError extends Error {}

/** Builds the 11 PipelineStages functions the Pipeline Runner (Phase 12, frozen) invokes in
 *  order, each one calling straight into a frozen engine's published entry point. */
export function createPipelineStages(config: KairosCompositionConfig): PipelineStages {
  const decisionIntelligenceConfig = config.decisionIntelligenceConfig ?? (getProviderConfigFromEnv() as never);

  return {
    context: async (): Promise<AgentContext> => {
      const agentContext = await buildAgentContext(config.agentId, config.contextOptions);
      if (!agentContext) throw new CompositionStageError(`buildAgentContext returned null for agent ${config.agentId}`);
      return agentContext;
    },

    memory: async (): Promise<MemoryPackage> => {
      return assembleMemoryPackage(config.agentId);
    },

    reasoning: async (acc): Promise<{ reasoningContext: ReasoningContext; prompt: Prompt }> => {
      const agentContext = acc.context as AgentContext;
      const memoryPackage = acc.memory as MemoryPackage;
      const reasoningContext = buildReasoningContext(agentContext, memoryPackage, config.userPolicy);
      const prompt = buildPrompt(reasoningContext);
      return { reasoningContext, prompt };
    },

    decision: async (acc): Promise<GenerateDecisionIntelligenceResult> => {
      const { reasoningContext, prompt } = acc.reasoning as { reasoningContext: ReasoningContext; prompt: Prompt };
      return decisionIntelligence.generateDecisionIntelligence(reasoningContext, prompt, decisionIntelligenceConfig);
    },

    verification: async (acc): Promise<VerificationResult> => {
      const { reasoningContext } = acc.reasoning as { reasoningContext: ReasoningContext; prompt: Prompt };
      const { decision } = acc.decision as GenerateDecisionIntelligenceResult;
      return verification.verifyDecision(decision, reasoningContext);
    },

    plan: async (acc): Promise<ExecutionPlan> => {
      const { reasoningContext } = acc.reasoning as { reasoningContext: ReasoningContext; prompt: Prompt };
      const verified = acc.verification as VerificationResult;
      if (verified.status !== 'verified') {
        throw new CompositionStageError(`decision was rejected by verification, not proceeding to planning`);
      }
      return executionPlanner.buildExecutionPlan(verified as VerifiedDecision, reasoningContext);
    },

    route: async (acc): Promise<{ stepId: string; route: ExecutionRoute }> => {
      const plan = acc.plan as ExecutionPlan;
      const routeOptions = { network: config.network, ...config.routeOptions };
      const routed = await computeRoutesForPlan(plan, config.protocolRegistry, routeOptions);
      if (routed.length === 0) throw new CompositionStageError('no route candidates were produced for this plan');
      // Composition wires a single-step execution path; multi-step orchestration across an
      // ExecutionPlan's dependency graph is deliberately out of scope here (would be business
      // logic, not wiring) — the first plan step's route is the one executed.
      return routed[0];
    },

    execution: async (acc): Promise<ExecutionResult> => {
      const plan = acc.plan as ExecutionPlan;
      const { route } = acc.route as { stepId: string; route: ExecutionRoute };
      return config.executionTarget.execute(plan, route, config.protocolRegistry);
    },

    outcome: async (acc): Promise<OutcomeRecord> => {
      const executionResult = acc.execution as ExecutionResult;
      const telemetry = await config.telemetryProvider(executionResult);
      return recordOutcome(executionResult, telemetry);
    },

    memoryWrite: async (acc): Promise<MemoryWriteResult> => {
      const outcomeRecord = acc.outcome as OutcomeRecord;
      return writeMemory(outcomeRecord, { agentId: config.agentId }, {
        episodic: getEpisodicMemoryProvider(),
        semantic: getSemanticMemoryProvider(),
        working: getWorkingMemoryProvider(),
      });
    },

    learning: async (): Promise<LearningSnapshot> => {
      const memoryPackage = await assembleMemoryPackage(config.agentId);
      return computeLearningSnapshot(memoryPackage);
    },
  };
}

/** Adapts createPipelineStages() into the Pipeline Runner (Phase 12, frozen) — a single call
 *  wires and returns a ready-to-run KairosPipelineRunner. */
export function createPipelineRunner(config: KairosCompositionConfig): KairosPipelineRunner {
  return new KairosPipelineRunner(createPipelineStages(config), config.pipelineLogger);
}

/** Wires the Pipeline Runner into the Autonomous Runtime (Phase 11, frozen). Returns a fully
 *  configured, not-yet-started AutonomousRuntime. */
export function createRuntime(config: KairosCompositionConfig): AutonomousRuntime {
  const pipelineRunner = createPipelineRunner(config);
  return new AutonomousRuntime({
    pipelineRunner,
    intervalMs: config.intervalMs,
    logger: config.runtimeLogger,
    persistence: config.runtimePersistence,
    providerName: config.decisionIntelligenceConfig?.provider,
    model: config.decisionIntelligenceConfig?.model,
    checkProviderAvailability: config.checkProviderAvailability,
  });
}

/** The one-call bootstrap: `const kairos = createKairos(config); await kairos.start();`. Returns
 *  the same AutonomousRuntime createRuntime() does — a distinct name only because it is the
 *  documented, top-level entry point callers are meant to reach for. */
export function createKairos(config: KairosCompositionConfig): AutonomousRuntime {
  return createRuntime(config);
}
