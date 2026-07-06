// Persisted per-protocol position snapshot (Blend deposits, Soroswap LP, ...) — analogous to
// positionService.ts's classic-pair positions, but for actions reached via the delegation/
// redemption execution path (see protocolExecutionService.ts) instead of the legacy direct-
// custody trading loop. Applied as a running signed delta after every protocol execution (a
// deposit/swap-in adds, a withdraw subtracts) rather than overwritten — overwriting with just
// the latest action's amount previously meant two sequential deposits left the recorded
// position at the second deposit's amount instead of their sum.
import { randomUUID } from 'crypto';
import { getDb, type ProtocolPositionRow, type ProtocolId, type ProtocolPositionKind } from './db.js';

/** Applies a signed delta to an (agent, protocol, asset) position, clamped at 0 — a position
 *  can't be tracked as negative locally (a withdraw larger than this table's recorded balance
 *  means our local bookkeeping has drifted from the real on-chain balance, e.g. interest accrual
 *  Blend pays out that this table doesn't model; clamping avoids compounding that drift into a
 *  nonsensical negative display rather than silently going negative). */
export function applyProtocolPositionDelta(input: {
  agentId: string;
  owner: string;
  protocolId: ProtocolId;
  kind: ProtocolPositionKind;
  asset: string;
  delta: bigint;
}): ProtocolPositionRow {
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM protocol_positions WHERE agent_id = ? AND protocol_id = ? AND asset = ?')
    .get(input.agentId, input.protocolId, input.asset) as ProtocolPositionRow | undefined;
  const current = existing ? BigInt(existing.amount) : 0n;
  const next = current + input.delta;
  const amount = (next < 0n ? 0n : next).toString();
  const now = Date.now();
  db.prepare(
    `INSERT INTO protocol_positions (id, agent_id, owner, protocol_id, kind, asset, amount, updated_at, created_at)
     VALUES (@id, @agentId, @owner, @protocolId, @kind, @asset, @amount, @now, @now)
     ON CONFLICT(agent_id, protocol_id, asset) DO UPDATE SET kind = @kind, amount = @amount, updated_at = @now`
  ).run({ id: randomUUID(), agentId: input.agentId, owner: input.owner, protocolId: input.protocolId, kind: input.kind, asset: input.asset, amount, now });
  return db
    .prepare('SELECT * FROM protocol_positions WHERE agent_id = ? AND protocol_id = ? AND asset = ?')
    .get(input.agentId, input.protocolId, input.asset) as ProtocolPositionRow;
}

export function listProtocolPositionsForAgent(agentId: string): ProtocolPositionRow[] {
  return getDb().prepare('SELECT * FROM protocol_positions WHERE agent_id = ?').all(agentId) as ProtocolPositionRow[];
}

export function listProtocolPositionsForOwner(owner: string): ProtocolPositionRow[] {
  return getDb().prepare('SELECT * FROM protocol_positions WHERE owner = ?').all(owner) as ProtocolPositionRow[];
}
