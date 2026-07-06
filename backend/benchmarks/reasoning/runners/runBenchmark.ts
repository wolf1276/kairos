// Main benchmark orchestration: resolve configured models -> filter -> run every (model,
// scenario) pair sequentially -> aggregate -> score -> compare against the previous report ->
// write JSON + Markdown reports. Sequential by design: live testing (Phase 2B, Phase 3) found
// several providers (OpenRouter free tier, NVIDIA) rate-limit aggressively under concurrent or
// rapid back-to-back requests — this framework paces requests to get reliable data by default.
import { ALL_SCENARIOS, SCENARIO_SET_VERSION } from '../scenarios/index.js';
import { PROVIDER_REGISTRY, resolveConfiguredModels, toProviderConfig } from './providerRegistry.js';
import { executeScenario } from './executeScenario.js';
import { aggregateByModel } from '../metrics/aggregate.js';
import { scoreAllModels } from '../metrics/scoring.js';
import { checkAllCalibration } from '../metrics/calibration.js';
import { checkAllAlternativeQuality } from '../metrics/alternativeQuality.js';
import { compareReports } from '../metrics/regression.js';
import { loadPreviousReport, findPreviousReportPath } from '../reports/loadPreviousReport.js';
import { writeReport } from '../reports/writeReport.js';
import type { BenchmarkScenario } from '../scenarios/types.js';
import type { RegisteredModel } from './providerRegistry.js';
import type { BenchmarkRunResult } from './executeScenario.js';

export interface RunBenchmarkOptions {
  /** Substring match against RegisteredModel.id or .model. */
  model?: string;
  /** Exact match against RegisteredModel.provider. */
  provider?: string;
  /** Exact match against BenchmarkScenario.id or .category. */
  scenario?: string;
  /** Milliseconds to wait between requests to the SAME provider — default pacing to avoid the
   *  rate-limiting observed in prior live sessions. Set 0 to disable (not recommended for
   *  providers with free/low tiers). */
  paceMs?: number;
  registry?: RegisteredModel[];
  scenarios?: BenchmarkScenario[];
  onProgress?: (done: number, total: number, label: string, result: BenchmarkRunResult) => void;
}

const DEFAULT_PACE_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runBenchmark(options: RunBenchmarkOptions = {}) {
  const registry = options.registry ?? PROVIDER_REGISTRY;
  const resolved = resolveConfiguredModels(registry).filter((m) => {
    if (options.provider && m.provider !== options.provider) return false;
    if (options.model && !m.id.includes(options.model) && !m.model.includes(options.model)) return false;
    return true;
  });

  const scenarios = (options.scenarios ?? ALL_SCENARIOS).filter((s) => {
    if (!options.scenario) return true;
    return s.id === options.scenario || s.category === options.scenario;
  });

  if (resolved.length === 0) {
    throw new Error('No configured models matched the given filters (check API keys are set and --provider/--model filters are correct).');
  }
  if (scenarios.length === 0) {
    throw new Error('No scenarios matched the given --scenario filter.');
  }

  const paceMs = options.paceMs ?? DEFAULT_PACE_MS;
  const results: BenchmarkRunResult[] = [];
  const total = resolved.length * scenarios.length;
  let done = 0;

  for (const model of resolved) {
    const config = toProviderConfig(model);
    for (const scenario of scenarios) {
      const result = await executeScenario(model, config, scenario);
      results.push(result);
      done += 1;
      options.onProgress?.(done, total, `${model.id}/${scenario.id}`, result);
      if (paceMs > 0 && done < total) await sleep(paceMs);
    }
  }

  const aggregates = aggregateByModel(results);
  const scores = scoreAllModels(aggregates);
  const calibration = checkAllCalibration(aggregates);

  const byModel = new Map<string, BenchmarkRunResult[]>();
  for (const r of results) byModel.set(r.modelId, [...(byModel.get(r.modelId) ?? []), r]);
  const alternativeQuality = checkAllAlternativeQuality(byModel);

  const previousReport = loadPreviousReport();
  const previousPath = findPreviousReportPath();
  const regressions = previousReport ? compareReports(aggregates, previousReport.aggregates) : [];
  if (previousReport && previousReport.scenarioSetVersion !== SCENARIO_SET_VERSION) {
    console.warn(
      `[benchmark] previous report used scenario set v${previousReport.scenarioSetVersion}, this run uses v${SCENARIO_SET_VERSION} — regression comparison may not be apples-to-apples.`
    );
  }

  const written = writeReport({
    scenarioSetVersion: SCENARIO_SET_VERSION,
    filters: { provider: options.provider, model: options.model, scenario: options.scenario },
    results,
    aggregates,
    scores,
    calibration,
    alternativeQuality,
    regressions,
    comparedAgainst: previousPath,
  });

  return { results, aggregates, scores, calibration, alternativeQuality, regressions, ...written };
}
