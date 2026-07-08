// Benchmark Reports (Phase 8), Markdown export half. Pure string formatting over an already-built
// `BenchmarkReportBundle` — no I/O, no rounding based on wall-clock or locale (fixed `toFixed`
// precision throughout), so the same bundle always renders to the same Markdown string.
import type { BenchmarkReportBundle } from './types.js';

function num(value: number, digits = 4): string {
  return Number.isFinite(value) ? value.toFixed(digits) : String(value);
}

function pct(value: number, digits = 2): string {
  return Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : String(value);
}

function tradingSection(bundle: BenchmarkReportBundle): string {
  const t = bundle.trading;
  return [
    '## Trading Report',
    '',
    `- Trade Count: ${t.tradeCount}`,
    `- Total Return: ${pct(t.totalReturn)}`,
    `- PnL: ${num(t.pnl)}`,
    `- Win Rate: ${pct(t.winRate)}`,
    `- Loss Rate: ${pct(t.lossRate)}`,
    `- Average Win: ${num(t.averageWin)}`,
    `- Average Loss: ${num(t.averageLoss)}`,
    `- Profit Factor: ${num(t.profitFactor)}`,
    `- Max Drawdown: ${num(t.maxDrawdown)}`,
    `- Sharpe Ratio: ${num(t.sharpeRatio)}`,
    `- Sortino Ratio: ${num(t.sortinoRatio)}`,
    `- Total Fees: ${num(t.totalFees)}`,
    `- Average Slippage: ${num(t.averageSlippage)}`,
    `- Average Holding Time (ms): ${num(t.averageHoldingTimeMs)}`,
  ].join('\n');
}

function strategySection(bundle: BenchmarkReportBundle): string {
  const rows = bundle.strategy.map(
    (s) =>
      `| ${s.rank} | ${s.strategyId} | ${s.usageCount} | ${pct(s.winRate)} | ${num(s.pnlContribution)} | ${num(
        s.compositeScore
      )} | ${s.bestRegime ?? '-'} | ${s.worstRegime ?? '-'} |`
  );
  return [
    '## Strategy Report',
    '',
    '| Rank | Strategy | Uses | Win Rate | PnL | Score | Best Regime | Worst Regime |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

function runtimeSection(bundle: BenchmarkReportBundle): string {
  const r = bundle.runtime;
  const stageRows = r.stages.map(
    (s) => `| ${s.stage} | ${s.runCount} | ${num(s.avgMs, 2)} | ${num(s.minMs, 2)} | ${num(s.maxMs, 2)} | ${num(s.p95Ms, 2)} |`
  );
  return [
    '## Runtime Report',
    '',
    `- Run Count: ${r.runCount}`,
    `- Success Count: ${r.successCount}`,
    `- Failure Count: ${r.failureCount}`,
    `- Avg Total (ms): ${num(r.avgTotalMs, 2)}`,
    `- P95 Total (ms): ${num(r.p95TotalMs, 2)}`,
    '',
    '| Stage | Runs | Avg ms | Min ms | Max ms | P95 ms |',
    '| --- | --- | --- | --- | --- | --- |',
    ...stageRows,
  ].join('\n');
}

function memorySection(bundle: BenchmarkReportBundle): string {
  const m = bundle.memory;
  return [
    '## Memory Report',
    '',
    `- Episodic Growth: ${m.episodicGrowth.totalCount} total, ${num(m.episodicGrowth.ratePerHour, 2)}/hr`,
    `- Semantic Growth: ${m.semanticGrowth.totalCount} total, ${num(m.semanticGrowth.ratePerHour, 2)}/hr`,
    `- Episodic Duplicates: ${m.episodicDuplicates.duplicateCount} (${pct(m.episodicDuplicates.duplicateRatio)})`,
    `- Semantic Duplicates: ${m.semanticDuplicates.duplicateCount} (${pct(m.semanticDuplicates.duplicateRatio)})`,
    `- Working Memory Usage: ${m.workingMemoryUsage.count}${
      m.workingMemoryUsage.capacity !== null ? ` / ${m.workingMemoryUsage.capacity}` : ''
    }`,
    `- Retrieval Hit Rate: ${pct(m.retrievalPerformance.hitRate)}`,
    `- Retrieval P95 Duration (ms): ${num(m.retrievalPerformance.p95DurationMs, 2)}`,
  ].join('\n');
}

function learningSection(bundle: BenchmarkReportBundle): string {
  const l = bundle.learning;
  const rows = l.cohorts.map(
    (c) =>
      `| ${c.cohort} | ${c.tradeCount} | ${pct(c.winRate)} | ${num(c.averagePnl)} | ${num(c.averageConfidence)} | ${pct(
        c.memoryInfluenceRate
      )} |`
  );
  return [
    '## Learning Report',
    '',
    `- Improving: ${l.isImproving ? 'yes' : 'no'}`,
    '',
    '| Cohort | Trades | Win Rate | Avg PnL | Avg Confidence | Memory Influence |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

function reliabilitySection(bundle: BenchmarkReportBundle): string {
  const r = bundle.reliability;
  const c = r.counts;
  return [
    '## Reliability Report',
    '',
    `- Reliability Score: ${num(r.reliabilityScore, 2)} / 100`,
    `- Total Runs: ${r.totalRuns}`,
    `- Total Events: ${r.totalEvents}`,
    `- Crashes: ${c.crash}`,
    `- Timeouts: ${c.timeout}`,
    `- Retries: ${c.retry}`,
    `- Invalid JSON: ${c.invalidJson}`,
    `- Empty Responses: ${c.emptyResponse}`,
    `- Verification Failures: ${c.verificationFailure}`,
    `- Execution Failures: ${c.executionFailure}`,
    `- Recovery Success Rate: ${pct(r.recoverySuccessRate)} (${r.recoverySuccesses}/${r.recoveryAttempts})`,
  ].join('\n');
}

/** Deterministic Markdown export: fixed section order (Trading, Strategy, Runtime, Memory,
 *  Learning, Reliability), fixed numeric precision throughout — same bundle always renders to the
 *  same string. */
export function exportBenchmarkReportMarkdown(bundle: BenchmarkReportBundle): string {
  return [
    `# Benchmark Report`,
    '',
    `Session: ${bundle.sessionId}`,
    `Generated At: ${bundle.generatedAt}`,
    `Version: ${bundle.version}`,
    '',
    tradingSection(bundle),
    '',
    strategySection(bundle),
    '',
    runtimeSection(bundle),
    '',
    memorySection(bundle),
    '',
    learningSection(bundle),
    '',
    reliabilitySection(bundle),
    '',
  ].join('\n');
}
