// P0-3 regression: executeQuantTrade/executeLimitOrder used to sign and submit a classic
// Stellar path payment directly from the agent's own Turnkey-MPC account, entirely outside
// Smart Wallet / Delegation / Policy custody (see docs/security/MAINNET_AUDIT.md, P0-3). Both
// now throw before touching any dependency. This file locks that in at the tick.ts level
// (runQuantTick/runLimitTick), complementing roleTickProtocolExecution.test.ts's role-agent
// coverage.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentRow } from '../db.js';
import type { LimitStrategyConfig, QuantStrategyConfig } from '../types.js';

const recordTickMock = vi.fn();
const getActiveDelegationForAgentMock = vi.fn();
const stopAgentMock = vi.fn();
const getCandlesMock = vi.fn();
const getLatestPriceMock = vi.fn();
const executePaperQuantTradeMock = vi.fn();
const executePaperLimitOrderMock = vi.fn();
const recordCompletedTradeMock = vi.fn();

vi.mock('../agentService.js', () => ({
  getAgentSigner: vi.fn(),
  getActiveDelegationForAgent: getActiveDelegationForAgentMock,
  recordTick: recordTickMock,
  stopAgent: stopAgentMock,
  tradesToday: vi.fn(() => 0),
}));
vi.mock('../priceHistory.js', () => ({
  getCandles: getCandlesMock,
  getLatestPrice: getLatestPriceMock,
}));
vi.mock('../strategies/index.js', () => ({
  getStrategy: vi.fn(() => ({ name: 'test-strategy', evaluate: () => 'buy' })),
}));
vi.mock('../auditService.js', () => ({
  logEvent: vi.fn(),
}));
vi.mock('../paperExecutor.js', () => ({
  executePaperQuantTrade: executePaperQuantTradeMock,
  executePaperLimitOrder: executePaperLimitOrderMock,
}));
vi.mock('../executionEngine.js', () => ({
  recordCompletedTrade: recordCompletedTradeMock,
}));

const baseRow: AgentRow = {
  id: 'agent-1',
  owner: 'GOWNER',
  public_key: 'GPUBLICKEY',
  role: null,
  encrypted_secret: '',
  turnkey_private_key_id: 'key-1',
  status: 'running',
  delegator: 'GDELEGATOR',
  strategy: 'quant',
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

const quantStrategy = {
  strategyId: 'test-strategy',
  pair: 'XLM/USDC',
  intervalSeconds: 60,
  amountPerTrade: '10000000',
} as unknown as QuantStrategyConfig;

const limitStrategy = {
  pair: 'XLM/USDC',
  intervalSeconds: 60,
  triggerComparator: 'lte',
  triggerPrice: '1',
  side: 'buy',
  quantity: '10',
  asset: 'XLM',
} as unknown as LimitStrategyConfig;

describe('P0-3: legacy direct-custody trading is blocked, not routed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getActiveDelegationForAgentMock.mockReturnValue({ salt: '1', nonce: '1', caveats: [] });
    getCandlesMock.mockResolvedValue([{ close: 0.5 }, { close: 0.5 }]);
    getLatestPriceMock.mockResolvedValue(0.5);
  });

  it('executeQuantTrade rejects immediately with the custody error (no mocking needed — throws before any dependency)', async () => {
    const { executeQuantTrade } = await import('../tick.js');
    await expect(executeQuantTrade(baseRow, { pair: 'XLM/USDC', amountPerTrade: '1' }, 'buy', 0.5)).rejects.toThrow(/Smart Wallet custody/);
  });

  it('runQuantTick in live mode fails cleanly and never records a completed trade', async () => {
    const { runQuantTick } = await import('../tick.js');
    await runQuantTick(baseRow, quantStrategy);

    expect(recordCompletedTradeMock).not.toHaveBeenCalled();
    expect(recordTickMock).toHaveBeenCalledWith(baseRow.id, expect.objectContaining({ ok: false }));
  });

  it('runQuantTick in paper mode still executes normally (regression: legitimate path unaffected)', async () => {
    executePaperQuantTradeMock.mockResolvedValue('paper-tx-hash');
    recordCompletedTradeMock.mockReturnValue(undefined);
    const { runQuantTick } = await import('../tick.js');

    await runQuantTick({ ...baseRow, mode: 'paper' }, quantStrategy);

    expect(executePaperQuantTradeMock).toHaveBeenCalledTimes(1);
    expect(recordCompletedTradeMock).toHaveBeenCalledTimes(1);
  });

  it('runLimitTick in live mode fails cleanly and never records a completed trade', async () => {
    const { runLimitTick } = await import('../tick.js');
    await runLimitTick(baseRow, limitStrategy);

    expect(recordCompletedTradeMock).not.toHaveBeenCalled();
    expect(stopAgentMock).not.toHaveBeenCalled();
    expect(recordTickMock).toHaveBeenCalledWith(baseRow.id, expect.objectContaining({ ok: false }));
  });

  it('runLimitTick in paper mode still executes normally (regression: legitimate path unaffected)', async () => {
    executePaperLimitOrderMock.mockResolvedValue('paper-tx-hash');
    recordCompletedTradeMock.mockReturnValue(undefined);
    const { runLimitTick } = await import('../tick.js');

    await runLimitTick({ ...baseRow, mode: 'paper' }, limitStrategy);

    expect(executePaperLimitOrderMock).toHaveBeenCalledTimes(1);
    expect(recordCompletedTradeMock).toHaveBeenCalledTimes(1);
    expect(stopAgentMock).toHaveBeenCalledTimes(1);
  });
});
