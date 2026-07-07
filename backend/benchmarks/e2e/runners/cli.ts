// CLI dispatcher for the E2E production test harnesses. Usage:
//   tsx benchmarks/e2e/runners/cli.ts determinism [--iterations=500]
//   tsx benchmarks/e2e/runners/cli.ts concurrency
//   tsx benchmarks/e2e/runners/cli.ts reliability
//   tsx benchmarks/e2e/runners/cli.ts performance [--iterations=100]
//   tsx benchmarks/e2e/runners/cli.ts all
function iterationsFlag(defaultValue: number): number {
  const arg = process.argv.find((a) => a.startsWith('--iterations='));
  return arg ? Number(arg.split('=')[1]) : defaultValue;
}

async function runDeterminism(): Promise<boolean> {
  const { runDeterminismHarness, buildDeterminismMarkdown } = await import('./determinism.js');
  const { writeReport } = await import('../reportWriter.js');
  const iterations = iterationsFlag(500);
  console.log(`Running Determinism Harness: ${iterations} iterations...`);
  const report = await runDeterminismHarness(iterations);
  const path = writeReport('determinism', buildDeterminismMarkdown(report));
  console.log(`Report: ${path}`);
  console.log(`Overall: ${report.overallDeterministic ? 'DETERMINISTIC' : 'NON-DETERMINISTIC'}`);
  return report.overallDeterministic;
}

async function runConcurrency(): Promise<boolean> {
  const { runConcurrencyHarness, buildConcurrencyMarkdown } = await import('./concurrency.js');
  const { writeReport } = await import('../reportWriter.js');
  console.log('Running Concurrency Harness...');
  const results = await runConcurrencyHarness();
  const path = writeReport('concurrency', buildConcurrencyMarkdown(results));
  console.log(`Report: ${path}`);
  const ok = results.every((r) => r.errorCount === 0 && !r.crossContamination && r.dedupCorrect);
  console.log(`Overall: ${ok ? 'THREAD-SAFE' : 'ISSUES FOUND'}`);
  return ok;
}

async function runReliability(): Promise<boolean> {
  const { runReliabilityHarness, buildReliabilityMarkdown } = await import('./reliability.js');
  const { writeReport } = await import('../reportWriter.js');
  console.log('Running Reliability Harness...');
  const results = await runReliabilityHarness();
  const path = writeReport('reliability', buildReliabilityMarkdown(results));
  console.log(`Report: ${path}`);
  const ok = results.every((r) => r.passed);
  console.log(`Overall: ${results.filter((r) => r.passed).length}/${results.length} fail-closed as expected`);
  return ok;
}

async function runPerformance(): Promise<boolean> {
  const { runPerformanceHarness, buildPerformanceMarkdown } = await import('./performance.js');
  const { writeReport } = await import('../reportWriter.js');
  const iterations = iterationsFlag(100);
  console.log('Running Performance Harness...');
  const report = await runPerformanceHarness(iterations);
  const path = writeReport('performance', buildPerformanceMarkdown(report));
  console.log(`Report: ${path}`);
  return true;
}

async function main() {
  const command = process.argv[2];
  let ok = true;
  switch (command) {
    case 'determinism':
      ok = await runDeterminism();
      break;
    case 'concurrency':
      ok = await runConcurrency();
      break;
    case 'reliability':
      ok = await runReliability();
      break;
    case 'performance':
      ok = await runPerformance();
      break;
    case 'all':
      ok = (await runDeterminism()) && ok;
      ok = (await runConcurrency()) && ok;
      ok = (await runReliability()) && ok;
      await runPerformance();
      break;
    default:
      console.error('Usage: tsx benchmarks/e2e/runners/cli.ts <determinism|concurrency|reliability|performance|all> [--iterations=N]');
      process.exitCode = 1;
      return;
  }
  if (!ok) process.exitCode = 1;
}

main();
