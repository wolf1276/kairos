// Verifies the yield role's reallocation routes through the real protocol-execution path
// (Blend deposit via executeProtocolAction) instead of the legacy spot-buy path, when
// ENABLE_PROTOCOL_EXECUTION is on and the agent is live — see roleTick.ts's useProtocolExecution
// branch. Every collaborator is mocked so this only exercises the dispatch decision itself, not
// the full oracle/LLM/DB pipeline (those are covered elsewhere).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentRow } from '../db.js';
import type { RoleStrategyConfig } from '../types.js';

const executeProtocolActionMock = vi.fn();
const executeQuantTradeMock = vi.fn();
const executePaperQuantTradeMock = vi.fn();
const recordCompletedTradeMock = vi.fn();

vi.mock('../protocolExecutionService.js', () => ({
  executeProtocolAction: executeProtocolActionMock,
}));
vi.mock('../tick.js', () => ({
  executeQuantTrade: executeQuantTradeMock,
}));
vi.mock('../paperExecutor.js', () => ({
  executePaperQuantTrade: executePaperQuantTradeMock,
}));
vi.mock('../executionEngine.js', () => ({
  recordCompletedTrade: recordCompletedTradeMock,
}));
vi.mock('../executionJournal.js', () => ({
  openExecution: vi.fn(() => ({ id: 'journal-1' })),
  markBroadcast: vi.fn(),
  markRecorded: vi.fn(),
}));
vi.mock('../agentService.js', () => ({
  recordTick: vi.fn(),
}));
vi.mock('../validation.js', () => ({
  riskChecks: vi.fn(() => ({ ok: true })),
  validateDelegation: vi.fn(() => ({ ok: true })),
  validatePolicy: vi.fn(() => ({ ok: true })),
}));
vi.mock('../pnl.js', () => ({
  computePnlSummary: vi.fn(() => ({ realizedPnl: 0, unrealizedPnl: 0 })),
}));
vi.mock('../positionService.js', () => ({
  getPosition: vi.fn(() => null),
}));
vi.mock('../portfolioService.js', () => ({
  computeAllocation: vi.fn(() => ({ idleUsd: 500, xlmPct: 50, usdcPct: 50 })),
  getTargets: vi.fn(() => ({ xlmPct: 50, usdcPct: 50, driftThresholdPct: 10 })),
}));
vi.mock('../performanceService.js', () => ({
  snapshotPerformance: vi.fn(),
}));
vi.mock('../decisionService.js', () => ({
  recordDecision: vi.fn(),
}));
vi.mock('../auditService.js', () => ({
  logEvent: vi.fn(),
}));
vi.mock('../decisionEngine.js', () => ({
  buildMarketContext: vi.fn(async () => ({
    price: 0.12,
    change24h: 1,
    volume24h: 1000,
    candles: [],
    indicators: { rsi: 50 },
    regime: { regime: 'ranging', volatilityPct: 5, trendStrength: 10 },
  })),
  decideYield: vi.fn(async () => ({
    action: 'reallocate',
    confidence: 0.8,
    reasoning: 'test',
    yieldVenue: 'usdc-lend',
    llmModel: null,
  })),
  decideStrategic: vi.fn(),
  decideBalancer: vi.fn(),
}));

const baseConfig: RoleStrategyConfig = {
  role: 'yield',
  pair: 'XLM/USDC',
  intervalSeconds: 60,
  amountPerTrade: '1000000000',
} as unknown as RoleStrategyConfig;

const baseRow: AgentRow = {
  id: 'agent-1',
  owner: 'GOWNER',
  public_key: 'GPUBLICKEY',
  role: 'yield',
  encrypted_secret: '',
  turnkey_private_key_id: 'key-1',
  status: 'running',
  delegator: 'GDELEGATOR',
  strategy: 'role',
  strategy_config_json: null,
  last_tick_at: null,
  last_result: null,
  last_error: null,
  created_at: Date.now(),
  mode: 'live',
  capital: '1000',
  risk_level: null,
  started_at: Date.now(),
  lock_token: null,
  lock_expires_at: null,
} as AgentRow;

describe('roleTick yield reallocation dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeProtocolActionMock.mockResolvedValue({ ok: true, txHash: 'deadbeef' });
  });

  it('routes a live yield reallocation through executeProtocolAction when protocol execution is enabled', async () => {
    process.env.ENABLE_PROTOCOL_EXECUTION = 'true';
    const { runRoleTick } = await import('../roleTick.js');

    await runRoleTick(baseRow, baseConfig);

    expect(executeProtocolActionMock).toHaveBeenCalledTimes(1);
    expect(executeProtocolActionMock).toHaveBeenCalledWith(
      baseRow,
      expect.objectContaining({ protocolId: 'blend', action: 'deposit', amount: BigInt(baseConfig.amountPerTrade) })
    );
    expect(executeQuantTradeMock).not.toHaveBeenCalled();
    expect(recordCompletedTradeMock).not.toHaveBeenCalled();
  });

  // P0-3: a live agent with no Smart-Wallet-custodied execution route (any role but
  // yield-with-protocol-execution) must be blocked, not silently routed through the legacy
  // direct-custody path (tick.ts's executeQuantTrade, signed by the agent's own Turnkey key
  // against Horizon directly — no on-chain Delegation validation, no on-chain Policy
  // enforcement). See docs/security/MAINNET_AUDIT.md.
  it('blocks a live reallocation instead of falling back to the legacy spot-trade path when protocol execution is disabled', async () => {
    delete process.env.ENABLE_PROTOCOL_EXECUTION;
    const { runRoleTick } = await import('../roleTick.js');

    await runRoleTick(baseRow, baseConfig);

    expect(executeProtocolActionMock).not.toHaveBeenCalled();
    expect(executeQuantTradeMock).not.toHaveBeenCalled();
    expect(recordCompletedTradeMock).not.toHaveBeenCalled();
  });

  it('never routes a paper-mode agent through executeProtocolAction, even when the flag is on', async () => {
    process.env.ENABLE_PROTOCOL_EXECUTION = 'true';
    executePaperQuantTradeMock.mockResolvedValue('paper-tx-hash');
    recordCompletedTradeMock.mockReturnValue({ tradeId: 'trade-2', position: null, pnl: { realizedPnl: 0, unrealizedPnl: 0 } });
    const { runRoleTick } = await import('../roleTick.js');

    await runRoleTick({ ...baseRow, mode: 'paper' }, baseConfig);

    expect(executeProtocolActionMock).not.toHaveBeenCalled();
    expect(executePaperQuantTradeMock).toHaveBeenCalledTimes(1);
  });

  // P0-3: the strategic/balancer roles have no protocol-execution route at all (useProtocolExecution
  // only ever applies to role === 'yield'), so a live strategic/balancer agent must always be
  // blocked, regardless of the ENABLE_PROTOCOL_EXECUTION flag — it must never fall back to signing
  // real trades from the agent's own Turnkey account outside Smart Wallet custody.
  it('blocks a live strategic-role trade even when protocol execution is enabled (no route exists for this role)', async () => {
    process.env.ENABLE_PROTOCOL_EXECUTION = 'true';
    const { decideStrategic } = await import('../decisionEngine.js');
    vi.mocked(decideStrategic).mockResolvedValue({
      action: 'buy',
      confidence: 0.9,
      reasoning: 'test',
      llmModel: null,
    } as Awaited<ReturnType<typeof decideStrategic>>);
    const { runRoleTick } = await import('../roleTick.js');

    await runRoleTick({ ...baseRow, role: 'strategic' }, { ...baseConfig, role: 'strategic' });

    expect(executeProtocolActionMock).not.toHaveBeenCalled();
    expect(executeQuantTradeMock).not.toHaveBeenCalled();
    expect(recordCompletedTradeMock).not.toHaveBeenCalled();
  });

  it('still executes a paper-mode strategic-role trade normally (regression: simulated trading unaffected)', async () => {
    delete process.env.ENABLE_PROTOCOL_EXECUTION;
    const { decideStrategic } = await import('../decisionEngine.js');
    vi.mocked(decideStrategic).mockResolvedValue({
      action: 'buy',
      confidence: 0.9,
      reasoning: 'test',
      llmModel: null,
    } as Awaited<ReturnType<typeof decideStrategic>>);
    executePaperQuantTradeMock.mockResolvedValue('paper-tx-hash');
    recordCompletedTradeMock.mockReturnValue({ tradeId: 'trade-3', position: null, pnl: { realizedPnl: 0, unrealizedPnl: 0 } });
    const { runRoleTick } = await import('../roleTick.js');

    await runRoleTick({ ...baseRow, role: 'strategic', mode: 'paper' }, { ...baseConfig, role: 'strategic' });

    expect(executePaperQuantTradeMock).toHaveBeenCalledTimes(1);
    expect(executeQuantTradeMock).not.toHaveBeenCalled();
    expect(recordCompletedTradeMock).toHaveBeenCalledTimes(1);
  });
});
