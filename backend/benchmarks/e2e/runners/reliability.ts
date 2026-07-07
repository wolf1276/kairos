// Reliability Harness: injects a fault at every pipeline stage and verifies the system fails
// closed (throws / returns a structured rejection) rather than silently producing an invalid
// result. Each scenario is a minimal, targeted probe against the real (frozen) phase code —
// either the full pipeline (for provider-facing faults) or a direct call into the specific
// phase whose rule is expected to catch the fault (for malformed/corrupted-data faults).
import { randomUUID } from 'crypto';
import { buildReasoningContext, ReasoningContextError } from '../../../src/reasoning/contextBuilder.js';
import { buildPrompt } from '../../../src/reasoning/promptBuilder.js';
import { verifyDecision } from '../../../src/reasoning/verification/verify.js';
import { recordOutcome, OutcomeRecordValidationError } from '../../../src/reasoning/outcomeRecorder/recorder.js';
import { writeMemory, MemoryWriteValidationError } from '../../../src/reasoning/memoryWriter/writer.js';
import { computeLearningSnapshot, LearningSnapshotValidationError } from '../../../src/reasoning/learningEngine/engine.js';
import { computeRoute } from '../../../src/reasoning/routeEngine/routeEngine.js';
import { executeRoute } from '../../../src/reasoning/routeExecutionEngine/engine.js';
import { installFetch, restoreFetch } from '../fetchStub.js';
import { runPipeline } from '../pipeline.js';
import { buildFixtures, FIXTURE_OUTPUT_ASSET } from '../fixtures.js';
import { buildProtocolRegistry } from '../registry.js';
import { writeReport, toMarkdownTable } from '../reportWriter.js';
import type { RouteRequest } from '../../../src/reasoning/routeEngine/types.js';
import type { ExecutionResult as RouteExecutionResult } from '../../../src/reasoning/routeExecutionEngine/types.js';
import type { OutcomeRecord } from '../../../src/reasoning/outcomeRecorder/types.js';

export interface ScenarioResult {
  name: string;
  category: string;
  passed: boolean;
  detail: string;
}

const HEX64 = 'a'.repeat(64);

function validTelemetry() {
  return {
    transactionHash: HEX64,
    transactionXDRHash: HEX64,
    amountRequested: '10.000000',
    amountExecuted: '9.990000',
    fees: '0.010000',
    slippage: 0.1,
    priceImpact: 0.05,
    balancesBefore: [{ asset: 'XLM', amount: '1000.000000' }],
    balancesAfter: [{ asset: 'XLM', amount: '990.000000' }],
    verificationHash: HEX64,
    contextHash: HEX64,
    memoryHash: HEX64,
  };
}

function validExecutionResult(): RouteExecutionResult {
  return {
    executionId: randomUUID(),
    executionHash: HEX64,
    transactionXDR: 'x',
    transaction: null,
    simulationResult: null,
    estimatedFees: '0.01',
    resourceEstimate: null,
    protocol: 'soroswap',
    route: {
      routeId: randomUUID(),
      routeHash: HEX64,
      version: '1.0.0',
      request: { action: 'SWAP', asset: 'XLM', outputAsset: 'USDC', amount: '10', network: 'testnet' },
      selectedProtocol: 'soroswap',
      candidates: [],
      ranking: [],
      rejected: [],
      metadata: { routeEngineVersion: '1.0.0', requestHash: HEX64, candidateCount: 1, rejectedCount: 0, timestamp: Date.now() },
    } as unknown as RouteExecutionResult['route'],
    status: 'success',
    metadata: {
      engineVersion: '1.0.0', planExecutionId: 'plan-1', planHash: HEX64, routeHash: HEX64, requestHash: HEX64,
      executionHash: HEX64, retryCount: 0, failureReason: null, errorMessage: null, dataSource: 'synthetic',
      startedAt: 0, completedAt: 1, durationMs: 1,
    },
  };
}

function validOutcomeRecord(): OutcomeRecord {
  return {
    outcomeId: randomUUID(), outcomeHash: HEX64, executionId: 'exec-1', executionHash: HEX64,
    protocol: 'soroswap', action: 'SWAP', assets: ['XLM', 'USDC'],
    transactionHash: HEX64, transactionXDRHash: HEX64, executionStatus: 'success', dataSource: 'synthetic',
    amountRequested: '10', amountExecuted: '9.99', fees: '0.01', slippage: 0.1, priceImpact: 0.05,
    balancesBefore: [{ asset: 'XLM', amount: '1000' }], balancesAfter: [{ asset: 'XLM', amount: '990' }],
    executionDurationMs: 1, resourceEstimate: null, verificationHash: HEX64, routeHash: HEX64,
    contextHash: HEX64, memoryHash: HEX64, failureReason: null, retryCount: 0,
    metadata: { recorderVersion: '1.0.0' },
  };
}

async function expectThrows(fn: () => unknown | Promise<unknown>): Promise<{ threw: boolean; message: string }> {
  try {
    await fn();
    return { threw: false, message: '(no error thrown)' };
  } catch (err) {
    return { threw: true, message: err instanceof Error ? `${err.constructor.name}: ${err.message}` : String(err) };
  }
}

async function scenarioMalformedContext(): Promise<ScenarioResult> {
  const fixtures = buildFixtures();
  const { threw, message } = await expectThrows(() =>
    buildReasoningContext({ ...fixtures.agentContext, agentId: 'someone-else' }, fixtures.memoryPackage, fixtures.userPolicy));
  return { name: 'malformed_context (agentId mismatch)', category: 'malformed_input', passed: threw && message.includes('ReasoningContextError'), detail: message };
}

async function scenarioStaleContext(): Promise<ScenarioResult> {
  const fixtures = buildFixtures();
  const staleFixtures = { ...fixtures, agentContext: { ...fixtures.agentContext, market: { ...fixtures.agentContext.market, oracle: { timestamp: 1_000_000_000, ageSeconds: 999_999 } } } };
  const reasoningContext = buildReasoningContext(staleFixtures.agentContext, fixtures.memoryPackage, fixtures.userPolicy);
  const prompt = buildPrompt(reasoningContext, 'v2');
  installFetch('none');
  let rejected = false;
  let detail = '';
  try {
    const { generateDecisionIntelligence } = await import('../../../src/reasoning/decisionIntelligence/orchestrator.js');
    const { decision } = await generateDecisionIntelligence(reasoningContext, prompt, {
      provider: 'openai', model: 'gpt-4o-mini', apiKey: 'k', temperature: 0.2, maxTokens: 100, timeoutMs: 2000, maxRetries: 0, structuredOutput: true,
    });
    const verification = verifyDecision(decision, reasoningContext, { now: 1_700_000_000_000 });
    rejected = verification.status === 'rejected';
    detail = `verification.status=${verification.status}, failedRules=${JSON.stringify(verification.failedRules)}`;
  } finally {
    restoreFetch();
  }
  return { name: 'stale_context (oracle age)', category: 'malformed_input', passed: rejected, detail };
}

async function scenarioCorruptedMemory(): Promise<ScenarioResult> {
  const fixtures = buildFixtures();
  const corrupted = { ...fixtures.memoryPackage, meta: { ...fixtures.memoryPackage.meta, packageHash: 'not-a-hash' } };
  const { threw, message } = await expectThrows(() => computeLearningSnapshot(corrupted));
  return { name: 'corrupted_memory (invalid packageHash)', category: 'malformed_input', passed: threw && message.includes('LearningSnapshotValidationError'), detail: message };
}

async function scenarioProviderFault(fault: 'malformed_json' | 'provider_timeout' | 'provider_unavailable' | 'malformed_protocol_response'): Promise<ScenarioResult> {
  const fixtures = buildFixtures();
  const result = await runPipeline(fixtures, { fault, now: 1_700_000_000_000 });
  const passed = !result.ok && result.failedStage === 'decisionIntelligence';
  return { name: `${fault} (provider fault)`, category: 'provider_fault', passed, detail: result.ok ? 'pipeline unexpectedly succeeded' : `failedStage=${result.failedStage}, error=${result.errorName}: ${result.errorMessage}` };
}

async function scenarioAllocationOverflow(): Promise<ScenarioResult> {
  const fixtures = buildFixtures();
  const reasoningContext = buildReasoningContext(fixtures.agentContext, fixtures.memoryPackage, fixtures.userPolicy);
  const prompt = buildPrompt(reasoningContext, 'v2');
  const overflowOutput = {
    primaryDecision: { action: 'SWAP', protocol: 'soroswap', asset: 'XLM', allocation: 5.0, confidence: 0.9 },
    alternatives: [
      { action: 'HOLD', protocol: 'soroswap', asset: 'XLM', allocation: 0, confidence: 0.5, tradeoffs: 't1' },
      { action: 'WITHDRAW', protocol: 'soroswap', asset: 'USDC', allocation: 0.1, confidence: 0.5, tradeoffs: 't2' },
    ],
    reasoningChain: [{ step: 's', evidenceRefs: [0] }],
    evidence: [{ type: 'market_indicator', source: 'trend', detail: 'd', weight: 0.5 }],
    risks: [{ description: 'r', probability: 0.1, severity: 'low', mitigation: 'm' }],
    assumptions: [], uncertainty: { missingInformation: [], conflictingEvidence: [], lowConfidenceSignals: [], score: 0.1 },
    expectedOutcome: { direction: 'up', expectedBenefit: 'b', expectedDownside: 'd' },
    confidence: { overall: 0.9, perSection: { primaryDecision: 0.9, alternatives: 0.5, evidence: 0.5, risk: 0.5, expectedOutcome: 0.5 } },
    summary: 'overflow test',
  };
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    void init;
    return { ok: true, status: 200, json: async () => ({ id: 'x', choices: [{ message: { content: JSON.stringify(overflowOutput) } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), text: async () => '' } as unknown as Response;
  }) as typeof fetch;
  let threw = false;
  let message = '';
  try {
    const { generateDecisionIntelligence } = await import('../../../src/reasoning/decisionIntelligence/orchestrator.js');
    await generateDecisionIntelligence(reasoningContext, prompt, { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'k', temperature: 0.2, maxTokens: 100, timeoutMs: 2000, maxRetries: 0, structuredOutput: true });
  } catch (err) {
    threw = true;
    message = err instanceof Error ? `${err.constructor.name}: ${err.message}` : String(err);
  } finally {
    restoreFetch();
  }
  return { name: 'allocation_overflow (allocation=5.0)', category: 'invalid_value', passed: threw, detail: message || '(no error thrown)' };
}

async function scenarioNaN(): Promise<ScenarioResult> {
  const { threw, message } = await expectThrows(() => recordOutcome(validExecutionResult(), { ...validTelemetry(), slippage: NaN }));
  return { name: 'NaN (telemetry.slippage)', category: 'invalid_value', passed: threw && message.includes('OutcomeRecordValidationError'), detail: message };
}

async function scenarioInfinity(): Promise<ScenarioResult> {
  const { threw, message } = await expectThrows(() => recordOutcome(validExecutionResult(), { ...validTelemetry(), priceImpact: Infinity }));
  return { name: 'Infinity (telemetry.priceImpact)', category: 'invalid_value', passed: threw && message.includes('OutcomeRecordValidationError'), detail: message };
}

async function scenarioInvalidBalances(): Promise<ScenarioResult> {
  const { threw, message } = await expectThrows(() =>
    recordOutcome(validExecutionResult(), { ...validTelemetry(), balancesAfter: [{ asset: 'USDC', amount: '5' }] }));
  return { name: 'invalid_balances (asset set mismatch)', category: 'invalid_value', passed: threw && message.includes('OutcomeRecordValidationError'), detail: message };
}

async function scenarioUnsupportedProtocol(): Promise<ScenarioResult> {
  const registry = buildProtocolRegistry();
  const request: RouteRequest = { action: 'LENDING', asset: 'XLM', amount: '10', network: 'testnet' };
  const route = await computeRoute(request, registry, { now: () => 1_700_000_000_000 });
  const result = await executeRoute({ executionId: 'p1', planHash: HEX64 } as unknown as Parameters<typeof executeRoute>[0], route, registry, { now: () => 1_700_000_000_000 });
  const passed = result.status === 'failed' && route.selectedProtocol === null;
  return { name: 'unsupported_protocol (LENDING, no lending adapter registered)', category: 'unsupported', passed, detail: `route.selectedProtocol=${route.selectedProtocol}, executionResult.status=${result.status}, failureReason=${result.metadata.failureReason}` };
}

async function scenarioUnsupportedAsset(): Promise<ScenarioResult> {
  const registry = buildProtocolRegistry();
  const request: RouteRequest = { action: 'SWAP', asset: 'NOTREAL', outputAsset: 'USDC', amount: '10', network: 'testnet' };
  const route = await computeRoute(request, registry, { now: () => 1_700_000_000_000 });
  const passed = route.selectedProtocol === null && route.candidates.length === 0;
  return { name: 'unsupported_asset (NOTREAL)', category: 'unsupported', passed, detail: `route.selectedProtocol=${route.selectedProtocol}, candidates=${route.candidates.length}, rejected=${JSON.stringify(route.rejected)}` };
}

async function scenarioReplayAttack(): Promise<ScenarioResult> {
  const registry = buildProtocolRegistry();
  const request: RouteRequest = { action: 'SWAP', asset: 'XLM', outputAsset: FIXTURE_OUTPUT_ASSET, amount: '0.1', network: 'testnet', adapterParams: { trustlineEstablished: true, deadline: 1_700_003_600_000, minOutput: '0.001' } };
  const oldNow = 1_700_000_000_000;
  const route = await computeRoute(request, registry, { now: () => oldNow });
  const muchLaterNow = oldNow + 10 * 60_000; // 10 minutes later, default routeTtlMs is 60s
  const result = await executeRoute({ executionId: 'p1', planHash: HEX64 } as unknown as Parameters<typeof executeRoute>[0], route, registry, { now: () => muchLaterNow });
  const passed = result.status === 'failed' && result.metadata.failureReason === 'stale_route';
  return { name: 'replay_attack (stale route resubmitted)', category: 'replay', passed, detail: `status=${result.status}, failureReason=${result.metadata.failureReason}` };
}

async function scenarioMalformedExecutionResult(): Promise<ScenarioResult> {
  const malformed = { ...validExecutionResult(), executionHash: '' };
  const { threw, message } = await expectThrows(() => recordOutcome(malformed, validTelemetry()));
  return { name: 'malformed_execution_result (missing executionHash)', category: 'malformed_input', passed: threw && message.includes('OutcomeRecordValidationError'), detail: message };
}

async function scenarioMalformedOutcomeRecord(): Promise<ScenarioResult> {
  const malformed = { ...validOutcomeRecord(), outcomeHash: '' };
  const { threw, message } = await expectThrows(() => writeMemory(malformed, { agentId: 'agent-1' }));
  return { name: 'malformed_outcome_record (missing outcomeHash)', category: 'malformed_input', passed: threw && message.includes('MemoryWriteValidationError'), detail: message };
}

async function scenarioInvalidHashes(): Promise<ScenarioResult> {
  const malformed = { ...validOutcomeRecord(), contextHash: 'zz-not-hex' };
  const { threw, message } = await expectThrows(() => writeMemory(malformed, { agentId: 'agent-1' }));
  return { name: 'invalid_hashes (non-hex contextHash on OutcomeRecord)', category: 'invalid_value', passed: threw && message.includes('MemoryWriteValidationError'), detail: message };
}

export async function runReliabilityHarness(): Promise<ScenarioResult[]> {
  const scenarios: (() => Promise<ScenarioResult>)[] = [
    scenarioMalformedContext,
    scenarioStaleContext,
    scenarioCorruptedMemory,
    () => scenarioProviderFault('malformed_json'),
    () => scenarioProviderFault('provider_timeout'),
    () => scenarioProviderFault('provider_unavailable'),
    () => scenarioProviderFault('malformed_protocol_response'),
    scenarioInvalidHashes,
    scenarioReplayAttack,
    scenarioNaN,
    scenarioInfinity,
    scenarioInvalidBalances,
    scenarioUnsupportedProtocol,
    scenarioUnsupportedAsset,
    scenarioAllocationOverflow,
    scenarioMalformedExecutionResult,
    scenarioMalformedOutcomeRecord,
  ];

  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    try {
      results.push(await scenario());
    } catch (err) {
      results.push({ name: scenario.name, category: 'harness_error', passed: false, detail: `Harness itself threw unexpectedly: ${err instanceof Error ? err.message : String(err)}` });
    }
  }
  return results;
}

export function buildReliabilityMarkdown(results: ScenarioResult[]): string {
  const lines: string[] = [];
  lines.push('# Reliability Harness Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Scenarios: ${results.length}`);
  const passCount = results.filter((r) => r.passed).length;
  lines.push(`Passed (failed closed as expected): ${passCount} / ${results.length}`);
  lines.push(`Overall verdict: ${passCount === results.length ? '✅ ALL FAULTS FAIL CLOSED' : '❌ SOME FAULTS DID NOT FAIL CLOSED'}`);
  lines.push('');
  lines.push(
    toMarkdownTable(
      ['Scenario', 'Category', 'Result', 'Detail'],
      results.map((r) => [r.name, r.category, r.passed ? '✅ fail-closed' : '❌ FAILED OPEN', r.detail.replace(/\|/g, '\\|').slice(0, 200)])
    )
  );
  lines.push('');
  return lines.join('\n');
}

async function main() {
  console.log('Running Reliability Harness...');
  const results = await runReliabilityHarness();
  const markdown = buildReliabilityMarkdown(results);
  const path = writeReport('reliability', markdown);
  console.log(`Reliability report written to ${path}`);
  const passCount = results.filter((r) => r.passed).length;
  console.log(`Overall: ${passCount}/${results.length} fail-closed as expected`);
  if (passCount !== results.length) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
