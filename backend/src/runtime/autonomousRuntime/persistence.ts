import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { RuntimePersistenceProvider, RuntimeSnapshot } from './types.js';

/** Default provider: process memory only, lost on restart. Useful for tests / ephemeral runs. */
export class InMemoryRuntimePersistenceProvider implements RuntimePersistenceProvider {
  private snapshot: RuntimeSnapshot | null = null;

  load(): RuntimeSnapshot | null {
    return this.snapshot;
  }

  save(snapshot: RuntimeSnapshot): void {
    this.snapshot = snapshot;
  }
}

/** Writes the snapshot to a JSON file so the Runtime can recover its last known state after a
 *  process restart (crash, deploy, manual kill). Reads/writes are synchronous and best-effort:
 *  a corrupt or missing file is treated as "no prior snapshot" rather than a fatal error, since
 *  recovery must fail closed, not crash the process on boot. */
export class FileRuntimePersistenceProvider implements RuntimePersistenceProvider {
  constructor(private readonly filePath: string) {}

  load(): RuntimeSnapshot | null {
    try {
      if (!existsSync(this.filePath)) return null;
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed as RuntimeSnapshot;
    } catch {
      return null;
    }
  }

  save(snapshot: RuntimeSnapshot): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(snapshot, null, 2), 'utf-8');
    } catch {
      // Persistence is best-effort; a failed write must not crash the runtime (fail closed).
    }
  }
}
