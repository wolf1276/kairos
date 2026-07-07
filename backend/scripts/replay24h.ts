// 24-hour autonomous Replay/Paper-Trading session runner.
//
// Composition-only script — wires the existing, frozen engines (Context, Memory, Reasoning,
// Decision Intelligence, Verification, Execution Planner, Route Engine, ReplayTarget,
// Outcome Recorder, Memory Writer, Learning Engine) through the existing Pipeline Composition
// Root (`runtime/pipelineComposition`) and Autonomous Runtime (`runtime/autonomousRuntime`).
// No engine logic lives here — this only builds config, harvests stats for reporting, and
// checkpoints to disk.
import { randomUUID, createHash } from 'crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { AutonomousRuntime, type PipelineRunner, type RuntimePersistenceProvider, type RuntimeSnapshot } from '../src/runtime/autonomousRuntime/index.js';
import { createPipelineRunner } from '../src/runtime/pipelineComposition/composition.js';
import { createExecutionTarget } from '../src/runtime/executionTarget/index.js';
import { ProtocolRegistry } from '../src/protocolAdapters/registry.js';
import { createSoroswapAdapter } from '../src/protocolAdapters/soroswap/adapter.js';
import { createDeterministicRouterClient, createDeterministicSorobanRpcClient } from '../src/protocolAdapters/soroswap/testDoubles.js';
import { assembleMemoryPackage } from '../src/memoryLayer/index.js';
import { computeLearningSnapshot } from '../src/reasoning/learningEngine/index.js';
import { getProviderConfigFromEnv } from '../src/reasoning/providers/index.js';
import type { UserPolicy } from '../src/reasoning/types.js';
import type { ExecutionResult } from '../src/reasoning/routeExecutionEngine/types.js';
import type { OutcomeTelemetry } from '../src/reasoning/outcomeRecorder/types.js';
import type { PipelineResult } from '../src/runtime/pipelineRunner/index.js';

const SESSION_DIR = path.resolve(process.cwd(), 'data/replaySession');
const EXEC_LOG_PATH = path.join(SESSION_DIR, 'executions.jsonl');
const STATS_PATH = path.join(SESSION_DIR, 'stats.json');
const RUNTIME_SNAPSHOT_PATH = path.join(SESSION_DIR, 'runtime-snapshot.json');
const REPORTS_DIR = path.join(SESSION_DIR, 'reports');

const DURATION_MS = 24 * 60 * 60 * 1000;
const INTERVAL_MS = 30_000; // one "market update" tick every 30s
const CHECKPOINT_EXEC_COUNT = 100;
const CHECKPOINT_INTERVAL_MS = 30 * 60 * 1000;

// ── Fail closed: replay-only, paper-only, never a paid provider, never mainnet. Ollama was the
// first choice, but neither locally-pulled model (llama3.1:8b-instruct, qwen3.5:9b) could
// reliably satisfy Decision Intelligence's JSON schema live (see session notes) — llama3.1
// partially fills it and qwen3.5 times out writing into a separate `reasoning` field instead of
// `content`. Falling back to `openrouter`'s free-tier auto-resolved model (OPENROUTER_AUTO_MODEL)
// is zero-cost, not "paid", and is the one already proven against this exact schema by the test
// suite (reasoningProviders.test.ts). ──
const NON_PAID_PROVIDERS = new Set(['ollama', 'openrouter']);
const providerConfig = getProviderConfigFromEnv();
if (!NON_PAID_PROVIDERS.has(providerConfig.provider)) {
  throw new Error(`This session requires a non-paid provider (ollama or openrouter); got "${providerConfig.provider}". Refusing to run against a paid provider.`);
}

function sha256(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function log(msg: string, meta?: Record<string, unknown>): void {
  const line = `[${new Date().toISOString()}] ${msg}${meta ? ' ' + JSON.stringify(meta) : ''}`;
  console.log(line);
}

// ── Pick an existing paper-mode agent from the local agent-wallet DB — never creates a new
// custodial wallet (Turnkey) for a replay/paper harness, and never touches a 'live' mode agent. ──
function pickPaperAgentId(): string {
  const dbPath = process.env.AGENTS_DB_PATH || './data/agents.db';
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare("SELECT id FROM agents WHERE mode = 'paper' ORDER BY created_at ASC LIMIT 1").get() as { id: string } | undefined;
    if (!row) throw new Error('No paper-mode agent found in agents.db — cannot start a paper-trading replay session without one.');
    return row.id;
  } finally {
    db.close();
  }
}

interface Stats {
  startedAt: number;
  executions: number;
  successes: number;
  failures: number;
  retries: number;
  confidences: number[];
  pnls: number[];
  fees: number[];
  slippages: number[];
  pipelineLatenciesMs: number[];
  providerLatenciesMs: number[];
  protocolUsage: Record<string, number>;
  failureReasons: Record<string, number>;
  memoryGrowth: { episodic: number; semantic: number; working: number }[];
  learningGrowth: { episodeCount: number; verificationPassRate: number }[];
  lastCheckpointAt: number;
  lastCheckpointExecCount: number;
}

function emptyStats(): Stats {
  return {
    startedAt: Date.now(),
    executions: 0,
    successes: 0,
    failures: 0,
    retries: 0,
    confidences: [],
    pnls: [],
    fees: [],
    slippages: [],
    pipelineLatenciesMs: [],
    providerLatenciesMs: [],
    protocolUsage: {},
    failureReasons: {},
    memoryGrowth: [],
    learningGrowth: [],
    lastCheckpointAt: Date.now(),
    lastCheckpointExecCount: 0,
  };
}

function loadStats(): Stats {
  if (existsSync(STATS_PATH)) {
    try {
      return JSON.parse(readFileSync(STATS_PATH, 'utf-8'));
    } catch {
      log('stats.json unreadable — starting fresh stats (execution log on disk is unaffected)');
    }
  }
  return emptyStats();
}

function saveStats(stats: Stats): void {
  stats.lastCheckpointAt = Date.now();
  stats.lastCheckpointExecCount = stats.executions;
  writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2));
}

class FileRuntimePersistence implements RuntimePersistenceProvider {
  load(): RuntimeSnapshot | null {
    if (!existsSync(RUNTIME_SNAPSHOT_PATH)) return null;
    try {
      return JSON.parse(readFileSync(RUNTIME_SNAPSHOT_PATH, 'utf-8'));
    } catch {
      return null;
    }
  }
  save(snapshot: RuntimeSnapshot): void {
    writeFileSync(RUNTIME_SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));
  }
}

async function main(): Promise<void> {
  mkdirSync(SESSION_DIR, { recursive: true });
  mkdirSync(REPORTS_DIR, { recursive: true });

  const agentId = pickPaperAgentId();
  log('Session starting', { agentId, provider: providerConfig.provider, model: providerConfig.model, intervalMs: INTERVAL_MS, durationMs: DURATION_MS });

  const registry = new ProtocolRegistry();
  registry.register(createSoroswapAdapter({
    supportedAssets: ['XLM', 'USDC'],
    routerClient: createDeterministicRouterClient({ rates: { 'XLM->USDC': 0.12, 'USDC->XLM': 8.3 } }),
    sorobanRpcClient: createDeterministicSorobanRpcClient({ success: true }),
  }));

  const userPolicy: UserPolicy = {
    userId: agentId,
    riskTolerance: 'medium',
    maxAllocationPct: 20,
    allowedProtocols: ['soroswap'],
    allowedAssets: ['XLM', 'USDC'],
    minConfidence: 0.5,
    objectives: ['grow'],
  };

  // Paper-mode telemetry: no real settlement provider exists in replay mode, so
  // amountExecuted/fees/slippage are read straight off the (already-deterministic) simulation
  // result, and verification/context/memory hashes are deterministically derived from the
  // execution's own identity fields (never fabricated as "real" chain facts).
  const telemetryProvider = (executionResult: ExecutionResult): OutcomeTelemetry => {
    const sim = executionResult.simulationResult;
    const amountRequested = executionResult.route.request.amount;
    const outputs = sim?.estimatedOutputs ?? {};
    const amountExecuted = Object.values(outputs)[0] ?? amountRequested;
    return {
      transactionHash: sha256({ kind: 'paper-tx', executionId: executionResult.executionId }).slice(0, 64),
      transactionXDRHash: sha256({ kind: 'paper-xdr', executionId: executionResult.executionId }).slice(0, 64),
      amountRequested,
      amountExecuted: String(amountExecuted),
      fees: sim?.estimatedFees ?? '0',
      slippage: sim?.estimatedSlippagePct ?? 0,
      priceImpact: sim?.estimatedSlippagePct ?? 0,
      balancesBefore: [],
      balancesAfter: [],
      verificationHash: sha256({ kind: 'paper-verification', routeHash: executionResult.route.routeHash }),
      contextHash: sha256({ kind: 'paper-context', executionHash: executionResult.executionHash }),
      memoryHash: sha256({ kind: 'paper-memory', executionHash: executionResult.executionHash }),
    };
  };

  const kairosRunner = createPipelineRunner({
    agentId,
    userPolicy,
    protocolRegistry: registry,
    network: 'testnet',
    telemetryProvider,
    executionTarget: createExecutionTarget({ kind: 'replay' }),
    intervalMs: INTERVAL_MS,
    pipelineLogger: { info: (m) => log(`[pipeline] ${m}`), error: (m, meta) => log(`[pipeline:error] ${m}`, meta) },
  });

  const stats = loadStats();

  // Wraps the composed KairosPipelineRunner: still the same frozen composition/engines, this
  // only harvests per-cycle stats from the full PipelineResult before handing the narrow
  // {success,error} shape to the Autonomous Runtime, which only ever sees that narrow contract.
  const harvestingRunner: PipelineRunner = {
    async runPipeline() {
      const result: PipelineResult = await kairosRunner.run();
      harvestExecution(result);
      appendFileSync(EXEC_LOG_PATH, JSON.stringify({ at: Date.now(), ...summarizeResult(result) }) + '\n');
      if (stats.executions - stats.lastCheckpointExecCount >= CHECKPOINT_EXEC_COUNT || Date.now() - stats.lastCheckpointAt >= CHECKPOINT_INTERVAL_MS) {
        saveStats(stats);
        log('Checkpoint saved', { executions: stats.executions });
      }
      return result.success ? { success: true } : { success: false, error: result.error };
    },
  };

  function summarizeResult(result: PipelineResult) {
    if (!result.success) return { success: false, failureStage: result.failureStage, error: result.error };
    const decision = (result.decision as { decision?: { confidence?: number } } | undefined)?.decision;
    const execution = result.execution as ExecutionResult | undefined;
    return {
      success: true,
      totalDurationMs: result.totalDurationMs,
      confidence: decision?.confidence,
      protocol: execution?.protocol,
      status: execution?.status,
      retryCount: execution?.metadata?.retryCount,
    };
  }

  function harvestExecution(result: PipelineResult): void {
    stats.executions += 1;
    stats.pipelineLatenciesMs.push(result.totalDurationMs);
    if (!result.success) {
      stats.failures += 1;
      const reason = result.failureStage ?? 'unknown';
      stats.failureReasons[reason] = (stats.failureReasons[reason] ?? 0) + 1;
      return;
    }
    stats.successes += 1;
    const decisionStage = result.decision as { decision?: { confidence?: number }; timingMs?: number } | undefined;
    if (decisionStage?.decision?.confidence !== undefined) stats.confidences.push(decisionStage.decision.confidence);
    const execution = result.execution as ExecutionResult | undefined;
    if (execution) {
      stats.protocolUsage[execution.protocol] = (stats.protocolUsage[execution.protocol] ?? 0) + 1;
      stats.retries += execution.metadata.retryCount;
      if (execution.simulationResult) {
        stats.fees.push(Number(execution.simulationResult.estimatedFees));
        stats.slippages.push(execution.simulationResult.estimatedSlippagePct);
      }
    }
    const outcome = result.outcome as { amountRequested?: string; amountExecuted?: string } | undefined;
    if (outcome?.amountRequested && outcome?.amountExecuted) {
      stats.pnls.push(Number(outcome.amountExecuted) - Number(outcome.amountRequested));
    }
    const learning = result.learning as { episodeCount?: number; verificationPassRate?: number } | undefined;
    if (learning) stats.learningGrowth.push({ episodeCount: learning.episodeCount ?? 0, verificationPassRate: learning.verificationPassRate ?? 0 });
    const memory = result.memory as { episodic?: unknown[]; semantic?: unknown[]; working?: unknown[] } | undefined;
    if (memory) stats.memoryGrowth.push({ episodic: memory.episodic?.length ?? 0, semantic: memory.semantic?.length ?? 0, working: memory.working?.length ?? 0 });
  }

  const runtime = new AutonomousRuntime({
    pipelineRunner: harvestingRunner,
    intervalMs: INTERVAL_MS,
    persistence: new FileRuntimePersistence(),
    logger: { info: (m, meta) => log(`[runtime] ${m}`, meta), warn: (m, meta) => log(`[runtime:warn] ${m}`, meta), error: (m, meta) => log(`[runtime:error] ${m}`, meta) },
    providerName: providerConfig.provider,
    model: providerConfig.model,
  });

  let stopping = false;
  async function finalize(reason: string): Promise<void> {
    if (stopping) return;
    stopping = true;
    log('Finalizing session', { reason });
    try {
      await runtime.stop();
    } catch (e) {
      log('runtime.stop() failed during finalize', { error: e instanceof Error ? e.message : String(e) });
    }
    saveStats(stats);
    await generateReports(agentId, stats);
    log('Session finalized — reports written', { dir: REPORTS_DIR });
    process.exit(0);
  }

  process.on('SIGINT', () => finalize('SIGINT (manual shutdown)'));
  process.on('SIGTERM', () => finalize('SIGTERM (manual shutdown)'));
  setTimeout(() => finalize('24h duration elapsed'), DURATION_MS);

  await runtime.start();
  log('Runtime started', { state: runtime.getState() });
}

function avg(nums: number[]): number | null {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

function stddev(nums: number[]): number | null {
  if (nums.length < 2) return null;
  const m = avg(nums)!;
  return Math.sqrt(nums.reduce((s, n) => s + (n - m) ** 2, 0) / (nums.length - 1));
}

async function generateReports(agentId: string, stats: Stats): Promise<void> {
  const memoryPackage = await assembleMemoryPackage(agentId).catch(() => null);
  const learning = memoryPackage ? computeLearningSnapshot(memoryPackage) : null;

  const winRate = stats.pnls.length ? stats.pnls.filter((p) => p > 0).length / stats.pnls.length : null;
  const drawdown = stats.pnls.length ? Math.min(0, Math.min(...cumulative(stats.pnls))) : null;
  const meanPnl = avg(stats.pnls);
  const sdPnl = stddev(stats.pnls);
  const sharpe = meanPnl !== null && sdPnl ? meanPnl / sdPnl : null;

  writeFileSync(path.join(REPORTS_DIR, 'replay-report.md'), `# Replay Report
Session started: ${new Date(stats.startedAt).toISOString()}
Session ended: ${new Date().toISOString()}
Total executions: ${stats.executions}
Successes: ${stats.successes}
Failures: ${stats.failures}
Retries: ${stats.retries}
`);

  writeFileSync(path.join(REPORTS_DIR, 'performance-report.md'), `# Performance Report
PnL (paper, sum): ${stats.pnls.reduce((a, b) => a + b, 0).toFixed(6)}
Win Rate: ${winRate !== null ? (winRate * 100).toFixed(2) + '%' : 'n/a'}
Drawdown: ${drawdown !== null ? drawdown.toFixed(6) : 'n/a'}
Sharpe (mean/stdev of per-execution paper PnL, unannualized): ${sharpe !== null ? sharpe.toFixed(4) : 'n/a'}
Avg Fees: ${avg(stats.fees)?.toFixed(6) ?? 'n/a'}
Avg Slippage: ${avg(stats.slippages)?.toFixed(4) ?? 'n/a'}
Avg Pipeline Latency (ms): ${avg(stats.pipelineLatenciesMs)?.toFixed(2) ?? 'n/a'}
Trades: ${stats.executions}
Success Rate: ${stats.executions ? ((stats.successes / stats.executions) * 100).toFixed(2) + '%' : 'n/a'}
`);

  writeFileSync(path.join(REPORTS_DIR, 'learning-report.md'), `# Learning Report
${learning ? `Episode Count: ${learning.episodeCount}
Semantic Fact Count: ${learning.semanticFactCount}
Verification Pass Rate: ${(learning.verificationPassRate * 100).toFixed(2)}%
Avg Fees: ${learning.avgFees ? learning.avgFees.value.toFixed(6) : 'n/a'}
Avg Slippage: ${learning.avgSlippage ? learning.avgSlippage.value.toFixed(4) : 'n/a'}
Avg Execution Latency (ms): ${learning.avgExecutionLatencyMs ? learning.avgExecutionLatencyMs.value.toFixed(2) : 'n/a'}
Execution Distribution: ${learning.executionDistribution.map((e) => `${e.protocol}: ${(e.fraction * 100).toFixed(1)}%`).join(', ') || 'n/a'}` : 'No learning snapshot available (no memory package).'}
Learning growth samples over session: ${stats.learningGrowth.length}
`);

  writeFileSync(path.join(REPORTS_DIR, 'memory-growth-report.md'), `# Memory Growth Report
${stats.memoryGrowth.length ? `First sample: ${JSON.stringify(stats.memoryGrowth[0])}
Last sample: ${JSON.stringify(stats.memoryGrowth[stats.memoryGrowth.length - 1])}
Episodic growth: ${stats.memoryGrowth[0].episodic} -> ${stats.memoryGrowth[stats.memoryGrowth.length - 1].episodic}
Semantic growth: ${stats.memoryGrowth[0].semantic} -> ${stats.memoryGrowth[stats.memoryGrowth.length - 1].semantic}
Working memory at end: ${stats.memoryGrowth[stats.memoryGrowth.length - 1].working}` : 'No samples recorded.'}
`);

  writeFileSync(path.join(REPORTS_DIR, 'protocol-report.md'), `# Protocol Report
${Object.entries(stats.protocolUsage).map(([p, c]) => `${p}: ${c} executions (${((c / stats.executions) * 100).toFixed(1)}%)`).join('\n') || 'No executions recorded.'}
Failure reasons by pipeline stage: ${JSON.stringify(stats.failureReasons)}
`);

  writeFileSync(path.join(REPORTS_DIR, 'provider-report.md'), `# Provider Report
Provider: ${providerConfig.provider}
Model: ${providerConfig.model}
Avg confidence: ${avg(stats.confidences)?.toFixed(3) ?? 'n/a'}
Avg pipeline latency (ms, proxy for provider latency — reasoning stage dominates pipeline time): ${avg(stats.pipelineLatenciesMs)?.toFixed(2) ?? 'n/a'}
Total executions: ${stats.executions}
`);
}

function cumulative(nums: number[]): number[] {
  let sum = 0;
  return nums.map((n) => (sum += n));
}

main().catch((error) => {
  log('Fatal error — session did not start / crashed', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
