// Blend Protocol Adapter — exhaustive test suite. All chain interaction is through deterministic
// in-memory test doubles (testDoubles.ts) — no real Soroban/Blend network call is made anywhere
// in this file.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createBlendAdapter,
  createDeterministicBlendPoolClient,
  createDeterministicSorobanRpcClient,
  BlendExecutionNotImplementedError,
  getBlendPoolContractId,
} from '../protocolAdapters/blend/index.js';
import { ProtocolRegistry, MalformedAdapterError } from '../protocolAdapters/index.js';
import type { BlendAdapterOptions } from '../protocolAdapters/blend/index.js';
import type { AdapterActionRequest } from '../protocolAdapters/index.js';

const SUPPORTED_ASSETS = ['XLM', 'USDC', 'BLND'];
const OWNER = 'GABCDEOWNERADDRESS';

beforeEach(() => {
  process.env.BLEND_POOL_CONTRACT_ID_TESTNET = 'CONTRACT-TESTNET-BLEND-POOL';
  process.env.BLEND_POOL_CONTRACT_ID_MAINNET = 'CONTRACT-MAINNET-BLEND-POOL';
});

afterEach(() => {
  delete process.env.BLEND_POOL_CONTRACT_ID_TESTNET;
  delete process.env.BLEND_POOL_CONTRACT_ID_MAINNET;
  delete process.env.BLEND_MIN_HEALTH_FACTOR;
});

function makeAdapter(overrides: Partial<BlendAdapterOptions> = {}) {
  return createBlendAdapter({
    supportedAssets: SUPPORTED_ASSETS,
    poolClient: createDeterministicBlendPoolClient(),
    sorobanRpcClient: createDeterministicSorobanRpcClient(),
    ...overrides,
  });
}

const depositReq: AdapterActionRequest = { action: 'DEPOSIT', asset: 'USDC', network: 'testnet', amount: '100.000000', params: { owner: OWNER, trustlineEstablished: true } };
const withdrawReq: AdapterActionRequest = { action: 'WITHDRAW', asset: 'USDC', network: 'testnet', amount: '50.000000', params: { owner: OWNER, trustlineEstablished: true } };
const borrowReq: AdapterActionRequest = { action: 'BORROW', asset: 'USDC', network: 'testnet', amount: '20.000000', params: { owner: OWNER, trustlineEstablished: true } };
const repayReq: AdapterActionRequest = { action: 'REPAY', asset: 'USDC', network: 'testnet', amount: '10.000000', params: { owner: OWNER, trustlineEstablished: true } };

// ── Registration ──────────────────────────────────────────────────────────────────────────────

describe('registration', () => {
  it('registers cleanly against the shared ProtocolRegistry, using the existing interface unchanged', () => {
    const registry = new ProtocolRegistry();
    const metadata = registry.register(makeAdapter());
    expect(metadata.protocol).toBe('blend');
  });

  it('rejects malformed metadata: empty supportedAssets', () => {
    const registry = new ProtocolRegistry();
    const adapter = makeAdapter({ supportedAssets: [] });
    expect(() => registry.register(adapter)).toThrow(MalformedAdapterError);
  });
});

// ── Capabilities ──────────────────────────────────────────────────────────────────────────────

describe('capabilities', () => {
  it('declares deposit/withdraw/borrow/repay, no quote (pure lending pool)', () => {
    const adapter = makeAdapter();
    const caps = adapter.capabilities();
    expect(caps.supportedActions).toEqual(expect.arrayContaining(['DEPOSIT', 'WITHDRAW', 'BORROW', 'REPAY']));
    expect(caps.batchingSupport).toBe(true);
    expect(caps.supportedNetworks).toEqual(['testnet', 'mainnet']);
    expect(adapter.quote).toBeUndefined();
  });
});

// ── Deposit / withdraw ───────────────────────────────────────────────────────────────────────

describe('deposit and withdraw', () => {
  it('simulate() succeeds for a valid DEPOSIT and reports minted bTokens', async () => {
    const adapter = makeAdapter();
    const result = await adapter.simulate(depositReq);
    expect(result.success).toBe(true);
    expect(result.estimatedOutputs.bTokensMinted).toBeDefined();
  });

  it('simulate() succeeds for a valid WITHDRAW and reports underlying returned', async () => {
    const adapter = makeAdapter();
    const result = await adapter.simulate(withdrawReq);
    expect(result.success).toBe(true);
    expect(result.estimatedOutputs.underlyingReturned).toBeDefined();
  });

  it('buildTransaction() targets the pool contract via the "submit" method', async () => {
    const adapter = makeAdapter();
    const tx = await adapter.buildTransaction!(depositReq);
    expect(tx.method).toBe('submit');
    expect(tx.contractId).toBe(getBlendPoolContractId('testnet'));
    expect(tx.args.requestType).toBe('DEPOSIT');
  });
});

// ── Borrow / repay and health-factor safety ─────────────────────────────────────────────────

describe('borrow, repay, and health-factor safety', () => {
  it('simulate() succeeds for a valid BORROW when the projected health factor is safe', async () => {
    const adapter = makeAdapter({ poolClient: createDeterministicBlendPoolClient({ projectedHealthFactor: 2.0 }) });
    const result = await adapter.simulate(borrowReq);
    expect(result.success).toBe(true);
    expect(result.estimatedOutputs.debtTokensMinted).toBeDefined();
    expect(result.warnings.some((w) => w.includes('liquidation'))).toBe(true);
  });

  it('BORROW is rejected outright (not just warned) when it would leave the position below the minimum health factor', async () => {
    const adapter = makeAdapter({ poolClient: createDeterministicBlendPoolClient({ projectedHealthFactor: 1.0 }) });
    const result = await adapter.validate(borrowReq);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('health factor'))).toBe(true);
  });

  it('WITHDRAW is rejected when it would leave the position below the minimum health factor', async () => {
    const adapter = makeAdapter({ poolClient: createDeterministicBlendPoolClient({ projectedHealthFactor: 0.9 }) });
    const result = await adapter.validate(withdrawReq);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('health factor'))).toBe(true);
  });

  it('a custom, stricter minHealthFactor is honored', async () => {
    const adapter = makeAdapter({ minHealthFactor: 3.0, poolClient: createDeterministicBlendPoolClient({ projectedHealthFactor: 2.0 }) });
    const result = await adapter.validate(borrowReq);
    expect(result.ok).toBe(false);
  });

  it('DEPOSIT and REPAY are never gated on health factor (they can only improve it)', async () => {
    const adapter = makeAdapter({ poolClient: createDeterministicBlendPoolClient({ projectedHealthFactor: 0.1 }) });
    expect((await adapter.validate(depositReq)).ok).toBe(true);
    expect((await adapter.validate(repayReq)).ok).toBe(true);
  });

  it('simulate() succeeds for a valid REPAY', async () => {
    const adapter = makeAdapter();
    const result = await adapter.simulate(repayReq);
    expect(result.success).toBe(true);
    expect(result.estimatedOutputs.debtRemaining).toBeDefined();
  });

  // Regression-style check: a pool client returning a malformed (non-finite) projected health
  // factor must degrade to a validation error, never propagate as an uncaught rejection or a
  // silently-accepted borrow.
  it('a malformed (non-finite) projected health factor from the pool client is rejected, not silently accepted', async () => {
    const badPool = createDeterministicBlendPoolClient();
    (badPool as { projectHealthFactor: unknown }).projectHealthFactor = async () => NaN;
    const adapter = makeAdapter({ poolClient: badPool });
    const result = await adapter.validate(borrowReq);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('malformed'))).toBe(true);
  });

  it('a pool client that throws while projecting health factor degrades to a graceful validation failure, not a crash', async () => {
    const badPool = createDeterministicBlendPoolClient();
    (badPool as { projectHealthFactor: unknown }).projectHealthFactor = async () => { throw new Error('pool unreachable'); };
    const adapter = makeAdapter({ poolClient: badPool });
    const result = await adapter.validate(borrowReq);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('pool unreachable'))).toBe(true);
  });
});

// ── Validation ────────────────────────────────────────────────────────────────────────────────

describe('validation', () => {
  it('rejects an unsupported asset', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...depositReq, asset: 'DOGE' });
    expect(result.ok).toBe(false);
  });

  it('rejects an unsupported action', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...depositReq, action: 'FLASHLOAN' });
    expect(result.ok).toBe(false);
  });

  it('rejects a request missing params.owner', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...depositReq, params: { trustlineEstablished: true } });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('owner'))).toBe(true);
  });

  it('trustline requirement: a non-native asset without trustlineEstablished is rejected', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...depositReq, params: { owner: OWNER } });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('trustline'))).toBe(true);
  });

  it.each(['abc', '-50', 'Infinity', 'NaN', '', '0', '-0.0001'])('invalid amount %j is rejected by validate() and degrades simulate() to failure, never producing a NaN/Infinity/negative fee', async (amount) => {
    const adapter = makeAdapter();
    const validation = await adapter.validate({ ...depositReq, amount });
    expect(validation.ok).toBe(false);
    const result = await adapter.simulate({ ...depositReq, amount });
    expect(result.success).toBe(false);
    expect(result.estimatedFees).toBe('0.000000');
  });

  it('amount with more than 7 decimal places is rejected', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...depositReq, amount: '10.12345678' });
    expect(result.ok).toBe(false);
  });

  it('pool unavailable: health() reporting UNAVAILABLE rejects every request, fail-closed', async () => {
    const adapter = makeAdapter({ onHealth: () => 'UNAVAILABLE' });
    const result = await adapter.validate(depositReq);
    expect(result.ok).toBe(false);
  });

  it('a throwing onHealth is treated as UNAVAILABLE, never an uncaught rejection', async () => {
    const adapter = makeAdapter({ onHealth: () => { throw new Error('health check RPC unreachable'); } });
    const validation = await adapter.validate(depositReq);
    expect(validation.ok).toBe(false);
    const result = await adapter.simulate(depositReq);
    expect(result.success).toBe(false);
  });
});

// ── Malformed responses ──────────────────────────────────────────────────────────────────────

describe('malformed responses', () => {
  it('a pool client returning a malformed deposit result (undefined bTokensMinted) is rejected, not silently accepted', async () => {
    const badPool = createDeterministicBlendPoolClient();
    (badPool as { simulateDeposit: unknown }).simulateDeposit = async () => ({ bTokensMinted: undefined });
    const adapter = makeAdapter({ poolClient: badPool });
    const result = await adapter.simulate(depositReq);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/Malformed response/);
  });

  it('missing pool contract env var degrades simulate() to a graceful failure with a clear config error, not a thrown rejection', async () => {
    delete process.env.BLEND_POOL_CONTRACT_ID_TESTNET;
    const adapter = makeAdapter();
    const result = await adapter.simulate(depositReq);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/Missing env var/);
  });

  it('buildTransaction() still throws for the same missing env var — only simulate() degrades', async () => {
    delete process.env.BLEND_POOL_CONTRACT_ID_TESTNET;
    const adapter = makeAdapter();
    await expect(adapter.buildTransaction!(depositReq)).rejects.toThrow(/Missing env var/);
  });

  it('Soroban RPC reporting failure surfaces as a failed simulation, not a thrown exception', async () => {
    const adapter = makeAdapter({ sorobanRpcClient: createDeterministicSorobanRpcClient({ success: false, errors: ['simulation reverted'] }) });
    const result = await adapter.simulate(depositReq);
    expect(result.success).toBe(false);
    expect(result.errors).toContain('simulation reverted');
  });
});

// ── Deterministic hashes / replay ────────────────────────────────────────────────────────────

describe('deterministic hashes and replay', () => {
  it('identical requests produce identical transactionHash', async () => {
    const adapter = makeAdapter();
    const t1 = await adapter.buildTransaction!(depositReq);
    const t2 = await adapter.buildTransaction!(depositReq);
    expect(t1.transactionHash).toBe(t2.transactionHash);
  });

  it('different requests produce different transactionHash', async () => {
    const adapter = makeAdapter();
    const t1 = await adapter.buildTransaction!(depositReq);
    const t2 = await adapter.buildTransaction!({ ...depositReq, amount: '999.000000' });
    expect(t1.transactionHash).not.toBe(t2.transactionHash);
  });

  it('replay: 500 identical simulate() calls produce identical simulationHash', async () => {
    const adapter = makeAdapter();
    const hashes = new Set<string>();
    for (let i = 0; i < 500; i++) hashes.add((await adapter.simulate(depositReq)).simulationHash);
    expect(hashes.size).toBe(1);
  });
});

// ── Execution scope ──────────────────────────────────────────────────────────────────────────

describe('execution is explicitly out of scope', () => {
  it('execute() always throws BlendExecutionNotImplementedError — no transaction is ever submitted', async () => {
    const adapter = makeAdapter();
    await expect(adapter.execute(depositReq)).rejects.toThrow(BlendExecutionNotImplementedError);
  });
});

// ── Concurrency / stress ─────────────────────────────────────────────────────────────────────

describe('concurrency stress', () => {
  it.each([10, 50, 100, 250])('%i parallel simulate() calls all produce the same deterministic simulationHash', async (n) => {
    const adapter = makeAdapter();
    const results = await Promise.all(Array.from({ length: n }, () => adapter.simulate(depositReq)));
    expect(results.every((r) => r.success)).toBe(true);
    expect(new Set(results.map((r) => r.simulationHash)).size).toBe(1);
  });

  it('registering 100 independent Blend adapter instances (one per registry) concurrently is race-free', async () => {
    const registries = await Promise.all(
      Array.from({ length: 100 }, async () => {
        const registry = new ProtocolRegistry();
        registry.register(makeAdapter());
        return registry;
      })
    );
    expect(registries.every((r) => r.has('blend'))).toBe(true);
  });
});
