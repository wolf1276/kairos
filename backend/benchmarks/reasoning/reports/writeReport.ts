// Writes one benchmark run's full JSON report and a human-readable Markdown summary, both
// timestamped and never overwriting a previous run.
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { reportTimestamp } from '../utils/timestamp.js';
import { toMarkdownTable } from '../utils/table.js';
import { REPORTS_DIR } from './loadPreviousReport.js';
import { SCORE_WEIGHTS } from '../metrics/scoring.js';
import type { BenchmarkRunResult } from '../runners/executeScenario.js';
import type { ModelAggregate } from '../metrics/aggregate.js';
import type { ModelScore } from '../metrics/scoring.js';
import type { CalibrationFlag } from '../metrics/calibration.js';
import type { RegressionFinding } from '../metrics/regression.js';
import type { AlternativeQualityReport } from '../metrics/alternativeQuality.js';

export interface BenchmarkReport {
  runId: string;
  generatedAt: string;
  scenarioSetVersion: string;
  filters: { provider?: string; model?: string; scenario?: string };
  results: BenchmarkRunResult[];
  aggregates: ModelAggregate[];
  scores: ModelScore[];
  calibration: CalibrationFlag[];
  alternativeQuality: AlternativeQualityReport[];
  regressions: RegressionFinding[];
  comparedAgainst: string | null;
}

function fmt(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  return n.toFixed(digits);
}

function buildMarkdown(report: BenchmarkReport): string {
  const lines: string[] = [];
  lines.push(`# Reasoning Benchmark Report — ${report.runId}`);
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Scenario set version: ${report.scenarioSetVersion}`);
  lines.push(`Compared against: ${report.comparedAgainst ?? '(none — first run or no matching previous models)'}`);
  if (report.filters.provider || report.filters.model || report.filters.scenario) {
    lines.push(`Filters: ${JSON.stringify(report.filters)}`);
  }
  lines.push('');

  lines.push('## Summary Table');
  lines.push('');
  lines.push(
    toMarkdownTable(
      ['Model', 'Score', 'Runs', 'Valid %', 'Avg Latency (ms)', 'P95 (ms)', 'Avg Tokens', 'Avg Confidence', 'Avg Evidence'],
      report.aggregates.map((agg) => {
        const score = report.scores.find((s) => s.modelId === agg.modelId);
        return [
          agg.modelId,
          fmt(score?.overall),
          agg.runs,
          fmt((agg.successCount / Math.max(1, agg.runs)) * 100, 0),
          fmt(agg.avgLatencyMs, 0),
          fmt(agg.p95LatencyMs, 0),
          fmt(agg.avgTotalTokens, 0),
          fmt(agg.avgConfidence, 2),
          fmt(agg.avgEvidenceCount, 1),
        ];
      })
    )
  );
  lines.push('');

  lines.push('## Score Breakdown');
  lines.push('');
  lines.push(`Weights: ${Object.entries(SCORE_WEIGHTS).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  lines.push('');
  lines.push(
    toMarkdownTable(
      ['Model', 'Overall', 'JSON Quality', 'Validation Pass', 'Policy Compliance', 'Evidence Quality', 'Reasoning Quality', 'Latency', 'Token Efficiency'],
      report.scores.map((s) => [
        s.modelId, fmt(s.overall), fmt(s.components.jsonQuality), fmt(s.components.validationPassRate),
        fmt(s.components.policyCompliance), fmt(s.components.evidenceQuality), fmt(s.components.reasoningQuality),
        fmt(s.components.latency), fmt(s.components.tokenEfficiency),
      ])
    )
  );
  lines.push('');

  lines.push('## Decision Distribution');
  lines.push('');
  for (const agg of report.aggregates) {
    const total = Object.values(agg.actionDistribution).reduce((a, b) => a + b, 0);
    const dist = ['HOLD', 'DEPOSIT', 'WITHDRAW', 'SWAP', 'REBALANCE']
      .map((a) => `${a}: ${total > 0 ? fmt(((agg.actionDistribution[a] ?? 0) / total) * 100, 0) : '-'}%`)
      .join(', ');
    lines.push(`- **${agg.modelId}**: ${dist} (n=${total})`);
  }
  lines.push('');

  lines.push('## Confidence Calibration');
  lines.push('');
  for (const cal of report.calibration) {
    lines.push(`- **${cal.modelId}**: avg=${fmt(cal.avgConfidence, 2)}, stddev=${fmt(cal.confidenceStdDev, 3)}${cal.flags.length ? ' — ' + cal.flags.join('; ') : ' — no flags'}`);
  }
  lines.push('');

  lines.push('## Alternative Quality');
  lines.push('');
  lines.push(
    toMarkdownTable(
      ['Model', 'Decisions Checked', 'Duplicate Pairs', 'Primary Duplicated', 'Empty Tradeoffs', 'Avg Unique Actions'],
      report.alternativeQuality.map((a) => [a.modelId, a.decisionsChecked, a.duplicateAlternativePairs, a.primaryDuplicatedInAlternatives, a.emptyTradeoffsCount, fmt(a.avgUniqueActionsPerDecision, 2)])
    )
  );
  lines.push('');

  lines.push('## Regressions');
  lines.push('');
  if (report.regressions.length === 0) {
    lines.push('No regressions detected.');
  } else {
    for (const r of report.regressions) {
      lines.push(`- ⚠️ **${r.modelId}** [${r.kind}]: ${r.message}`);
    }
  }
  lines.push('');

  lines.push('## Error Kinds by Model');
  lines.push('');
  for (const agg of report.aggregates) {
    const kinds = Object.entries(agg.errorKindCounts);
    lines.push(`- **${agg.modelId}**: ${kinds.length ? kinds.map(([k, v]) => `${k}=${v}`).join(', ') : 'none'}`);
  }

  return lines.join('\n') + '\n';
}

export function writeReport(report: Omit<BenchmarkReport, 'runId' | 'generatedAt'>): { runId: string; jsonPath: string; markdownPath: string } {
  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });

  const now = new Date();
  const runId = reportTimestamp(now);
  const fullReport: BenchmarkReport = { ...report, runId, generatedAt: now.toISOString() };

  const jsonPath = join(REPORTS_DIR, `${runId}.json`);
  const markdownPath = join(REPORTS_DIR, `${runId}.md`);

  writeFileSync(jsonPath, JSON.stringify(fullReport, null, 2));
  writeFileSync(markdownPath, buildMarkdown(fullReport));

  return { runId, jsonPath, markdownPath };
}
