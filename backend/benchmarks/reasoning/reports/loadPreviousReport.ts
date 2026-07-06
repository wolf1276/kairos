// Finds the most recent previously-saved benchmark report (by filename timestamp) so the current
// run can be compared against it. Reports are never overwritten, so this simply means "the
// second-most-recent file after this run's own report is written" — but since we need it BEFORE
// writing the current report, this is "the most recent file that exists right now".
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { BenchmarkReport } from './writeReport.js';

export const REPORTS_DIR = join(import.meta.dirname, '.');

export function findPreviousReportPath(reportsDir: string = REPORTS_DIR): string | null {
  if (!existsSync(reportsDir)) return null;
  const jsonFiles = readdirSync(reportsDir)
    .filter((f) => f.endsWith('.json'))
    .sort(); // ISO-derived timestamps sort chronologically as strings
  if (jsonFiles.length === 0) return null;
  return join(reportsDir, jsonFiles[jsonFiles.length - 1]);
}

export function loadPreviousReport(reportsDir: string = REPORTS_DIR): BenchmarkReport | null {
  const path = findPreviousReportPath(reportsDir);
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as BenchmarkReport;
  } catch {
    return null;
  }
}
