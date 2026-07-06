#!/usr/bin/env -S npx tsx
// CLI entry point for the Reasoning Benchmark Framework.
//
// Usage:
//   tsx benchmarks/reasoning/runners/cli.ts                     # benchmark every configured model
//   tsx benchmarks/reasoning/runners/cli.ts --model qwen3       # filter by model id/name substring
//   tsx benchmarks/reasoning/runners/cli.ts --provider nvidia   # filter by exact provider name
//   tsx benchmarks/reasoning/runners/cli.ts --scenario bull_trend
//   tsx benchmarks/reasoning/runners/cli.ts --pace-ms 5000       # override inter-request pacing
//
// See package.json's `benchmark*` scripts for the documented one-word commands.
import { runBenchmark } from './runBenchmark.js';

function parseArgs(argv: string[]): { model?: string; provider?: string; scenario?: string; paceMs?: number } {
  const out: { model?: string; provider?: string; scenario?: string; paceMs?: number } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--model') out.model = argv[++i];
    else if (arg === '--provider') out.provider = argv[++i];
    else if (arg === '--scenario') out.scenario = argv[++i];
    else if (arg === '--pace-ms') out.paceMs = Number(argv[++i]);
    else if (!arg.startsWith('--') && !out.model && !out.provider) {
      // Positional fallback: `benchmark:model qwen3` / `benchmark:provider huggingface` pass
      // their filter value as a bare positional argument via the npm script's fixed --model/
      // --provider flag already baked in — this branch only covers ad-hoc invocations without it.
      out.model = arg;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[benchmark] starting run — filters: ${JSON.stringify(args)}`);

  const { runId, jsonPath, markdownPath, aggregates, scores, regressions } = await runBenchmark({
    ...args,
    onProgress: (done, total, label, result) => {
      const status = result.success ? (result.validationOk ? 'ok' : 'INVALID') : `FAIL:${result.errorKind}`;
      console.log(`[${done}/${total}] ${label} -> ${status} (${result.latencyMs.toFixed(0)}ms)`);
    },
  });

  console.log('');
  console.log(`[benchmark] run ${runId} complete.`);
  console.log(`[benchmark] JSON report: ${jsonPath}`);
  console.log(`[benchmark] Markdown report: ${markdownPath}`);
  console.log('');
  console.log('Summary:');
  for (const agg of aggregates) {
    const score = scores.find((s) => s.modelId === agg.modelId);
    console.log(`  ${agg.modelId}: score=${score?.overall ?? '-'} valid=${agg.successCount}/${agg.runs} avgLatency=${agg.avgLatencyMs.toFixed(0)}ms`);
  }
  if (regressions.length > 0) {
    console.log('');
    console.log(`⚠️  ${regressions.length} regression(s) detected — see the Markdown report for details.`);
  }
}

main().catch((err) => {
  console.error('[benchmark] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
