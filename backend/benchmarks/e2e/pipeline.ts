// Full backend pipeline runner for the E2E test harnesses (Determinism / Concurrency /
// Reliability / Performance). Chains every reasoning-engine phase end-to-end, in-process, with
// zero real network/LLM/DB calls (see fetchStub.ts, registry.ts). No phase's own code is
// modified — this file only wires already-existing, frozen entry points together.
import { InMemoryEpisodicProvider } from '../../src/memoryLayer/providers/inMemoryEpisodicProvider.js';
import { InMemorySemanticProvider } from '../../src/memoryLayer/providers/inMemorySemanticProvider.js';
import { InMemoryWorkingProvider } from '../../src/memoryLayer/providers/inMemoryWorkingProvider.js';
import { buildReasoningContext } from '../../src/reasoning/contextBuilder.js';
import { buildPrompt } from '../../src/reasoning/promptBuilder.js';
import { generateDecisionIntelligence } from '../../src/reasoning/decisionIntelligence/orchestrator.js';
import { verifyDecision } from '../../src/reasoning/verification/verify.js';
import { buildExecutionPlan } from '../../src/reasoning/executionPlanner/planner.js';
import { computeRoutesForPlan } from '../../src/reasoning/routeEngine/planAdapter.js';
import { executeRoute } from '../../src/reasoning/routeExecutionEngine/engine.js';
import { recordOutcome } from '../../src/reasoning/outcomeRecorder/recorder.js';
import { writeMemory, type WriteMemoryProviders } from '../../src/reasoning/memoryWriter/writer.js';
import { computeLearningSnapshot } from '../../src/reasoning/learningEngine/engine.js';
import { sha256 } from '../../src/reasoning/hashing.js';
import { buildProtocolRegistry, type RegistryFaultOptions } from './registry.js';
import { installFetch, restoreFetch, type FaultKind } from './fetchStub.js';
import { buildFixtures, FIXTURE_ASSET, FIXTURE_OUTPUT_ASSET, type PipelineFixtures } from './fixtures.js';
import type { ProtocolRegistry } from '../../src/protocolAdapters/registry.js';

export const PIPELINE_STAGES = [
  'context',
  'memory',
  'reasoningContext',
  'prompt',
  'decisionIntelligence',
  'decisionVerification',
  'executionPlan',
  'route',
  'executionResult',
  'outcomeRecord',
  'memoryWrite',
  'learningSnapshot',
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export interface StageTiming {
  stage: PipelineStage;
  durationMs: number;
}

export interface PipelineRunResult {
  ok: true;
  hashes: Record<PipelineStage, string>;
  timings: StageTiming[];
  totalDurationMs: number;
  memoryWriteStatus: string;
  executionStatus: string;
}

export interface PipelineRunFailure {
  ok: false;
  failedStage: PipelineStage | 'unknown';
  errorName: string;
  errorMessage: string;
  timings: StageTiming[];
  totalDurationMs: number;
}

export type PipelineOutcome = PipelineRunResult | PipelineRunFailure;

export interface RunPipelineOptions {
  /** Injectable clock — every stage that accepts one is pinned to this value so wall-clock time
   *  never leaks into a hash or a timing-sensitive fault path. */
  now?: number;
  fault?: FaultKind;
  registryFaults?: RegistryFaultOptions;
  /** Shared memory providers (pass the same instance across concurrent calls to genuinely
   *  exercise thread-safety; omit for a fresh, isolated set per call). */
  memoryProviders?: WriteMemoryProviders;
  agentId?: string;
  /** Registry override — lets reliability tests inject a mid-flight-unregistered/corrupted registry. */
  registry?: ProtocolRegistry;
  /** When false, skips install/restore of the global fetch stub — the caller is expected to have
   *  already installed one (e.g. once, before firing many parallel runs), avoiding a global-state
   *  install/restore race under concurrency. Defaults to true (manage it per call). */
  manageFetch?: boolean;
}

function freshMemoryProviders(): WriteMemoryProviders {
  return { episodic: new InMemoryEpisodicProvider(), semantic: new InMemorySemanticProvider(), working: new InMemoryWorkingProvider() };
}

async function timeStage<T>(timings: StageTiming[], stage: PipelineStage, fn: () => T | Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await fn();
  timings.push({ stage, durationMs: performance.now() - start });
  return result;
}

/**
 * Runs the complete backend pipeline once, end-to-end, against the given (or freshly built)
 * fixtures. Every non-deterministic primitive (fetch, clock, registry, memory store) is either
 * pinned or explicitly supplied so that identical inputs always produce identical stage hashes.
 */
export async function runPipeline(fixtures: PipelineFixtures = buildFixtures(), options: RunPipelineOptions = {}): Promise<PipelineOutcome> {
  const now = options.now ?? 1_700_000_000_000; // fixed epoch — never Date.now()
  const agentId = options.agentId ?? fixtures.agentContext.agentId;
  const timings: StageTiming[] = [];
  const overallStart = performance.now();
  let currentStage: PipelineStage | 'unknown' = 'unknown';

  const manageFetch = options.manageFetch ?? true;
  if (manageFetch) installFetch(options.fault ?? 'none');
  try {
    const registry = options.registry ?? buildProtocolRegistry(options.registryFaults);

    currentStage = 'context';
    const agentContextHash = await timeStage(timings, 'context', () => sha256(fixtures.agentContext));

    currentStage = 'memory';
    const memoryHash = await timeStage(timings, 'memory', () => sha256(fixtures.memoryPackage));

    currentStage = 'reasoningContext';
    const reasoningContext = await timeStage(timings, 'reasoningContext', () =>
      buildReasoningContext(fixtures.agentContext, fixtures.memoryPackage, fixtures.userPolicy));

    currentStage = 'prompt';
    const prompt = await timeStage(timings, 'prompt', () => buildPrompt(reasoningContext, 'v2'));

    currentStage = 'decisionIntelligence';
    const { decision } = await timeStage(timings, 'decisionIntelligence', () =>
      generateDecisionIntelligence(reasoningContext, prompt, {
        provider: 'openai', model: 'gpt-4o-mini', apiKey: 'test-key',
        temperature: 0.2, maxTokens: 1500, timeoutMs: options.fault === 'provider_timeout' ? 50 : 2000,
        maxRetries: options.fault === 'provider_timeout' || options.fault === 'provider_unavailable' ? 0 : 1,
        structuredOutput: true,
      }));

    currentStage = 'decisionVerification';
    const verification = await timeStage(timings, 'decisionVerification', () => verifyDecision(decision, reasoningContext, { now }));
    if (verification.status !== 'verified') {
      throw Object.assign(new Error(`decision rejected at verification: ${verification.failedRules.join('; ')}`), { name: 'VerificationRejected' });
    }

    currentStage = 'executionPlan';
    const plan = await timeStage(timings, 'executionPlan', () => buildExecutionPlan(verification, reasoningContext));

    currentStage = 'route';
    const routes = await timeStage(timings, 'route', () =>
      computeRoutesForPlan(plan, registry, {
        network: 'testnet',
        now: () => now,
        outputAssetFor: () => FIXTURE_OUTPUT_ASSET,
        adapterParamsFor: () => ({ trustlineEstablished: true, deadline: now + 3_600_000, minOutput: '0.001' }),
      }));
    if (routes.length === 0) {
      throw Object.assign(new Error('no routable step in plan (decision action produced no execute step)'), { name: 'NoRoute' });
    }
    const route = routes[0].route;

    currentStage = 'executionResult';
    const executionResult = await timeStage(timings, 'executionResult', () => executeRoute(plan, route, registry, { now: () => now }));

    currentStage = 'outcomeRecord';
    const outcomeRecord = await timeStage(timings, 'outcomeRecord', () =>
      recordOutcome(executionResult, {
        transactionHash: 'a'.repeat(64),
        transactionXDRHash: 'b'.repeat(64),
        amountRequested: '10.000000',
        amountExecuted: '9.990000',
        fees: '0.010000',
        slippage: 0.1,
        priceImpact: 0.05,
        balancesBefore: [{ asset: FIXTURE_ASSET, amount: '1000.000000' }],
        balancesAfter: [{ asset: FIXTURE_ASSET, amount: '990.000000' }],
        verificationHash: verification.verificationHash,
        contextHash: agentContextHash,
        memoryHash,
      }));

    currentStage = 'memoryWrite';
    const memoryWriteResult = await timeStage(timings, 'memoryWrite', () =>
      writeMemory(outcomeRecord, { agentId, timestamp: now }, options.memoryProviders ?? freshMemoryProviders()));

    currentStage = 'learningSnapshot';
    const snapshot = await timeStage(timings, 'learningSnapshot', () => computeLearningSnapshot(fixtures.memoryPackage));

    const hashes: Record<PipelineStage, string> = {
      context: agentContextHash,
      memory: memoryHash,
      reasoningContext: reasoningContext.meta.reasoningContextHash,
      prompt: prompt.promptHash,
      decisionIntelligence: decision.metadata.decisionHash,
      decisionVerification: verification.verificationHash,
      executionPlan: plan.planHash,
      route: route.routeHash,
      executionResult: executionResult.executionHash,
      outcomeRecord: outcomeRecord.outcomeHash,
      memoryWrite: memoryWriteResult.writeHash,
      learningSnapshot: snapshot.snapshotHash,
    };

    return {
      ok: true,
      hashes,
      timings,
      totalDurationMs: performance.now() - overallStart,
      memoryWriteStatus: memoryWriteResult.status,
      executionStatus: executionResult.status,
    };
  } catch (err) {
    const e = err as Error;
    return {
      ok: false,
      failedStage: currentStage,
      errorName: e?.name ?? 'Error',
      errorMessage: e?.message ?? String(err),
      timings,
      totalDurationMs: performance.now() - overallStart,
    };
  } finally {
    if (manageFetch) restoreFetch();
  }
}
