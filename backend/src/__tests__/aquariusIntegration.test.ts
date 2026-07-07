// Aquarius REAL integration tests — these hit the live Aquarius testnet router and the live
// Aquarius backend API over the network. Skipped unless AQUARIUS_INTEGRATION_TEST=true (and the
// required env vars are set), so the normal test suite / CI stays hermetic and offline. Run with:
//
//   AQUARIUS_INTEGRATION_TEST=true \
//   AQUARIUS_ROUTER_CONTRACT_ID_TESTNET=<real router contract id> \
//   AQUARIUS_SIMULATION_SOURCE_ACCOUNT=<a real, existing testnet account public key> \
//   npx vitest run src/__tests__/aquariusIntegration.test.ts
//
// The source account only needs to exist (fund it via https://friendbot.stellar.org) — no secret
// key is used anywhere, since simulation never signs or submits.
import { describe, it, expect, beforeAll } from 'vitest';
import { createProductionAquariusAdapter } from '../protocolAdapters/aquarius/index.js';
import type { ProtocolAdapter } from '../protocolAdapters/index.js';

const RUN_INTEGRATION = process.env.AQUARIUS_INTEGRATION_TEST === 'true';
const d = RUN_INTEGRATION ? describe : describe.skip;

d('Aquarius real integration (live testnet)', () => {
  // Constructed in beforeAll, NOT at describe-body scope: vitest still executes a describe.skip
  // block's synchronous body to collect its `it`s (only the hooks/tests themselves are skipped),
  // so building the adapter here directly previously threw ("Missing env var:
  // AQUARIUS_SIMULATION_SOURCE_ACCOUNT") even when this suite was meant to be a no-op — breaking
  // the "default suite stays hermetic/offline" guarantee this file exists to provide. Found by
  // running the full repo suite without integration env vars set.
  let adapter: ProtocolAdapter;
  beforeAll(() => {
    adapter = createProductionAquariusAdapter({ supportedAssets: ['XLM', 'AQUA'], network: 'testnet' });
  });
  // Discovered live against testnet during development — a real XLM/AQUA constant-product pool.
  // If this pool is retired on a future testnet reset, re-discover via POOL_DISCOVERY / the
  // backend API's /pools/ endpoint and update this constant.
  const KNOWN_POOL_ID = '9ac7a9cde23ac2ada11105eeaa42e43c2ea8332ca0aa8f41f58d7160274d718e';

  it('health() reports the real router as READY', async () => {
    expect(await adapter.health()).toBe('READY');
  }, 60_000);

  it('pool discovery: real backend API returns a nonzero pool count', async () => {
    const result = await adapter.simulate({ action: 'POOL_DISCOVERY', asset: 'XLM', network: 'testnet', amount: '0' });
    expect(result.success).toBe(true);
    expect(Number(result.estimatedOutputs.poolCount)).toBeGreaterThan(0);
  }, 60_000);

  it('quote(): real on-chain SWAP quote for XLM -> AQUA returns a positive output amount', async () => {
    const quote = await adapter.quote!({ action: 'SWAP', asset: 'XLM', network: 'testnet', amount: '1', params: { outputAsset: 'AQUA', trustlineEstablished: true } });
    expect(quote.source).toBe('on-chain');
    expect(Number(quote.outputAmount)).toBeGreaterThan(0);
  }, 60_000);

  it('simulate(): real SWAP simulation succeeds and reports a positive AQUA output', async () => {
    const result = await adapter.simulate({ action: 'SWAP', asset: 'XLM', network: 'testnet', amount: '1', params: { outputAsset: 'AQUA', trustlineEstablished: true } });
    expect(result.success).toBe(true);
    expect(Number(result.estimatedOutputs.AQUA)).toBeGreaterThan(0);
  }, 60_000);

  it('simulate(): real SWAP_CHAINED (explicit single-hop path) succeeds', async () => {
    const result = await adapter.simulate({ action: 'SWAP_CHAINED', asset: 'XLM', network: 'testnet', amount: '1', params: { path: ['XLM', 'AQUA'], trustlineEstablished: true } });
    expect(result.success).toBe(true);
    expect(Number(result.estimatedOutputs.AQUA)).toBeGreaterThan(0);
  }, 60_000);

  it('buildTransaction(): produces a real, deterministic, unsigned tx description routed through swap_chained', async () => {
    const tx = await adapter.buildTransaction!({ action: 'SWAP', asset: 'XLM', network: 'testnet', amount: '1', params: { outputAsset: 'AQUA', trustlineEstablished: true } });
    expect(tx.method).toBe('swap_chained');
    expect(tx.contractId.startsWith('C')).toBe(true);
  }, 60_000);

  it('simulate(): real WITHDRAW of 0 shares against a known real pool succeeds (structurally valid call)', async () => {
    const result = await adapter.simulate({ action: 'WITHDRAW', asset: 'XLM', network: 'testnet', amount: '0', params: { poolId: KNOWN_POOL_ID } });
    expect(result.success).toBe(true);
    expect(result.estimatedOutputs.assetA).toBeDefined();
    expect(result.estimatedOutputs.assetB).toBeDefined();
  }, 60_000);

  it('simulate(): real CLAIM_REWARDS against a known real pool succeeds (0 rewards, no LP position)', async () => {
    const result = await adapter.simulate({ action: 'CLAIM_REWARDS', asset: 'XLM', network: 'testnet', amount: '0', params: { poolId: KNOWN_POOL_ID } });
    expect(result.success).toBe(true);
    expect(result.estimatedOutputs.rewards).toBe('0.000000');
  }, 60_000);

  it('deterministic transaction generation: identical requests produce identical transactionHash even against the real client', async () => {
    const req = { action: 'SWAP' as const, asset: 'XLM', network: 'testnet' as const, amount: '1', params: { outputAsset: 'AQUA', trustlineEstablished: true } };
    const t1 = await adapter.buildTransaction!(req);
    const t2 = await adapter.buildTransaction!(req);
    expect(t1.transactionHash).toBe(t2.transactionHash);
  }, 60_000);

  it('router unavailable: a syntactically valid but nonexistent router contract fails closed rather than crashing unrecognizably', async () => {
    const originalContractId = process.env.AQUARIUS_ROUTER_CONTRACT_ID_TESTNET;
    const badAdapter = createProductionAquariusAdapter({ supportedAssets: ['XLM', 'AQUA'], network: 'testnet' });
    try {
      // A well-formed (valid checksum) contract strkey that certainly isn't deployed on testnet —
      // exercises the real "contract not found" simulation-failure path, not a local SDK-level
      // strkey validation error (which an all-'A' string would trigger instead, before any
      // network call — not a useful test of "router unavailable").
      process.env.AQUARIUS_ROUTER_CONTRACT_ID_TESTNET = 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526';
      await expect(badAdapter.simulate({ action: 'SWAP', asset: 'XLM', network: 'testnet', amount: '1', params: { outputAsset: 'AQUA', trustlineEstablished: true } })).resolves.toMatchObject({ success: false });
    } finally {
      process.env.AQUARIUS_ROUTER_CONTRACT_ID_TESTNET = originalContractId;
    }
  }, 60_000);
});
