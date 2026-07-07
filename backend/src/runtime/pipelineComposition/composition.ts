// Pipeline Composition (Phase 13; Phase 14 — Strategy Integration). Wires every frozen engine
// into one executable PipelineStages implementation. Owns dependency wiring only: instantiates
// nothing business-logic-shaped, injects constructor dependencies, and calls each frozen
// engine's own public entry point exactly as published from its `index.ts`. Never duplicates
// engine logic, never reaches into an engine's internals, never uses a global or hidden
// singleton — every dependency arrives through `KairosCompositionConfig`. Phase 14 adds the
// Strategy Engine to this same wiring (Context -> Memory -> Strategy Engine -> Decision
// Intelligence) — the Strategy Engine's own files are never modified, only called through its
// published registry entry point, same as every other engine here.
import { createHash } from 'crypto';
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
import { createDefaultStrategyRegistry } from '../../strategyEngine/index.js';
import { computeStrategyConsensus, formatStrategyEvidence } from './strategyConsensus.js';
import { stableStringify } from '../../stableStringify.js';
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
import type { ReasoningContext, Prompt, PromptSections } from '../../reasoning/index.js';
import type { GenerateDecisionIntelligenceResult } from '../../reasoning/decisionIntelligence/index.js';
import type { StrategyInput, StrategySignal } from '../../strategyEngine/index.js';
import type { StrategyConsensus } from './strategyConsensus.js';
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

/** Same technique as reasoning/hashing.ts::sha256 (SHA-256 over a canonical, key-sorted JSON
 *  string) — duplicated locally rather than imported, matching this codebase's own convention
 *  of not depending on another phase's internals (see e.g. learningEngine/engine.ts's own
 *  deepFreeze). Used only to recompute Prompt.promptHash over Composition's own augmented
 *  sections; Reasoning Engine's own hashing.ts is never touched. */
function sha256(input: unknown): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex');
}

/** Builds the 11 PipelineStages functions the Pipeline Runner (Phase 12, frozen) invokes in
 *  order, each one calling straight into a frozen engine's published entry point. */
export function createPipelineStages(config: KairosCompositionConfig): PipelineStages {
  const decisionIntelligenceConfig = config.decisionIntelligenceConfig ?? (getProviderConfigFromEnv() as never);
  // Phase 14 — Strategy Integration. Resolved once per composition, same convention as
  // decisionIntelligenceConfig above. Strategy Engine itself is never modified — this only
  // decides which already-built registry to call.
  const strategyRegistry = config.strategyRegistry ?? createDefaultStrategyRegistry();

  return {
    context: async (): Promise<AgentContext> => {
      const agentContext = await buildAgentContext(config.agentId, config.contextOptions);
      if (!agentContext) throw new CompositionStageError(`buildAgentContext returned null for agent ${config.agentId}`);
      return agentContext;
    },

    memory: async (): Promise<MemoryPackage> => {
      return assembleMemoryPackage(config.agentId);
    },

    reasoning: async (acc): Promise<{
      reasoningContext: ReasoningContext;
      prompt: Prompt;
      strategySignals: StrategySignal[];
      strategyConsensus: StrategyConsensus;
    }> => {
      const agentContext = acc.context as AgentContext;
      const memoryPackage = acc.memory as MemoryPackage;
      const reasoningContext = buildReasoningContext(agentContext, memoryPackage, config.userPolicy);
      const basePrompt = buildPrompt(reasoningContext);

      // Strategy Engine (Phase 14): Context -> Memory -> Strategy Engine -> Decision
      // Intelligence. Reuses the FeatureSet the frozen Context Engine already computed — this
      // never recomputes an indicator or calls the frozen Strategy Engine's internals directly,
      // only its published registry entry point.
      const strategyInput: StrategyInput = {
        agentId: config.agentId,
        pair: agentContext.pair,
        timestamp: reasoningContext.meta.timestamp,
        features: agentContext.features,
        allowedAssets: config.userPolicy.allowedAssets,
        allowedProtocols: config.userPolicy.allowedProtocols,
      };
      const { signals: strategySignals, failures: strategyFailures } = strategyRegistry.evaluateAll(strategyInput);
      const strategyConsensus = computeStrategyConsensus(strategySignals);

      // Decision Intelligence's request client (frozen) only ever reads Prompt.sections' fixed,
      // named keys — the only channel through which it can actually "receive" strategy data is
      // the existing Evidence section's text. This builds a new Prompt object (Prompt.sections
      // is a plain, Object.freeze'd data value, not engine logic) with a freshly recomputed hash
      // over the augmented sections — buildPrompt()/hashPromptSections() themselves are never
      // called with different logic, and the original base prompt's own hash is left untouched.
      const augmentedSections: PromptSections = {
        ...basePrompt.sections,
        evidence: `${basePrompt.sections.evidence}\n\nStrategy Signals:\n${formatStrategyEvidence(strategySignals, strategyConsensus, strategyFailures)}`,
      };
      const prompt: Prompt = {
        templateVersion: basePrompt.templateVersion,
        sections: augmentedSections,
        promptHash: sha256(augmentedSections),
      };

      return { reasoningContext, prompt, strategySignals, strategyConsensus };
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
