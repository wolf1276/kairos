// SQLite-backed BenchmarkStore. Uses its OWN database file (separate from db.ts's `agents.db`
// and its migrations) — Benchmark Core must never touch the frozen agents schema, so it opens
// and owns a dedicated connection instead of extending `getDb()`. Append-only: the table has no
// UPDATE/DELETE statement anywhere in this file.
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import type { BenchmarkExecutionRecord, BenchmarkStore } from './types.js';

export function getBenchmarkDbPath(): string {
  return process.env.BENCHMARK_DB_PATH || './data/benchmark.db';
}

let db: Database.Database | undefined;

function ensureSchema(instance: Database.Database): void {
  instance.exec(`
    CREATE TABLE IF NOT EXISTS benchmark_executions (
      execution_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      recorded_at INTEGER NOT NULL,
      record_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_benchmark_executions_session ON benchmark_executions (session_id);
  `);
}

export function getBenchmarkDb(): Database.Database {
  if (db) return db;
  const dbPath = getBenchmarkDbPath();
  const dir = path.dirname(dbPath);
  if (dir && dir !== '.' && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  ensureSchema(db);
  return db;
}

/** Test-only: forces a fresh connection on next getBenchmarkDb() call (mirrors patterns used
 *  elsewhere in this codebase for isolating tests against a shared module-level singleton). */
export function resetBenchmarkDbForTests(): void {
  if (db) db.close();
  db = undefined;
}

export class SqliteBenchmarkStore implements BenchmarkStore {
  insert(record: BenchmarkExecutionRecord): void {
    getBenchmarkDb()
      .prepare(
        `INSERT INTO benchmark_executions (execution_id, session_id, timestamp, recorded_at, record_json)
         VALUES (@execution_id, @session_id, @timestamp, @recorded_at, @record_json)`
      )
      .run({
        execution_id: record.executionId,
        session_id: record.sessionId,
        timestamp: record.timestamp,
        recorded_at: record.recordedAt,
        record_json: JSON.stringify(record),
      });
  }

  listBySession(sessionId: string): BenchmarkExecutionRecord[] {
    const rows = getBenchmarkDb()
      .prepare('SELECT record_json FROM benchmark_executions WHERE session_id = ? ORDER BY timestamp ASC')
      .all(sessionId) as { record_json: string }[];
    return rows.map((r) => JSON.parse(r.record_json) as BenchmarkExecutionRecord);
  }

  listAll(): BenchmarkExecutionRecord[] {
    const rows = getBenchmarkDb()
      .prepare('SELECT record_json FROM benchmark_executions ORDER BY timestamp ASC')
      .all() as { record_json: string }[];
    return rows.map((r) => JSON.parse(r.record_json) as BenchmarkExecutionRecord);
  }
}

/** In-memory BenchmarkStore — no file I/O. Useful for tests and for embedding Benchmark Core in
 *  short-lived scripts that don't want a SQLite file as a side effect. */
export class InMemoryBenchmarkStore implements BenchmarkStore {
  private readonly records: BenchmarkExecutionRecord[] = [];

  insert(record: BenchmarkExecutionRecord): void {
    this.records.push(record);
  }

  listBySession(sessionId: string): BenchmarkExecutionRecord[] {
    return this.records.filter((r) => r.sessionId === sessionId);
  }

  listAll(): BenchmarkExecutionRecord[] {
    return [...this.records];
  }
}
