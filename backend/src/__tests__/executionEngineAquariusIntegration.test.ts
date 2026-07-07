// Execution Engine + REAL Aquarius integration — hits the live Aquarius testnet router over the
// network, same opt-in gating as `aquariusIntegration.test.ts` (skipped unless
// AQUARIUS_INTEGRATION_TEST=true). Proves `executeRoute` produces a genuine, live-verified
// unsigned XDR + real resource estimate end to end — not just against mocked RPC responses (see
// `executionEngineRealXdr.test.ts` for the offline/mocked version of this same path). Run with:
//
//   AQUARIUS_INTEGRATION_TEST=true \
//   AQUARIUS_ROUTER_CONTRACT_ID_TESTNET=<real router contract id> \
//   AQUARIUS_SIMULATION_SOURCE_ACCOUNT=<a real, existing testnet account public key> \
//   npx vitest run src/__tests__/executionEngineAquariusIntegration.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createProductionAquariusAdapter, getAquariusRouterContractId, getSorobanRpcUrl, getAquariusBackendApiUrl, getAquariusSimulationSourceAccount, verifyUnsignedXdr } from '../protocolAdapters/aquarius/index.js';
import { ProtocolRegistry } from '../protocolAdapters/index.js';
import { computeRoute } from '../reasoning/routeEngine/index.js';
import { executeRoute, createAquariusRealTransactionProvider } from '../reasoning/routeExecutionEngine/index.js';
import type { ExecutionPlan } from '../reasoning/executionPlanner/index.js';

const RUN_INTEGRATION = process.env.AQUARIUS_INTEGRATION_TEST === 'true';
const d = RUN_INTEGRATION ? describe : describe.skip;

function makePlan(): ExecutionPlan {
  return {
    executionId: 'exec-live-1',
    planHash: 'plan-hash-live-1',
    version: '1.0.0',
    timestamp: 0,
    steps: [{ stepId: 'step-1', type: 'execute', action: 'SWAP', protocol: 'aquarius', asset: 'XLM', allocation: 0.000001, dependsOn: [] }],
    protocolRouting: {},
    assetRouting: {},
    dependencies: {},
    prerequisiteChecks: [],
    rollbackStrategy: [],
    simulationRequests: [],
    estimatedFees: [],
    estimatedSlippage: [],
    expectedBalanceChanges: [],
    expectedStateChanges: [],
    metadata: { plannerVersion: '1.0.0', planHash: 'plan-hash-live-1', decisionHash: 'd', verificationHash: 'v', stepCount: 1 },
  };
}

d('Execution Engine + real Aquarius integration (live testnet)', () => {
  let registry: ProtocolRegistry;

  beforeAll(() => {
    registry = new ProtocolRegistry();
    registry.register(createProductionAquariusAdapter({ supportedAssets: ['XLM', 'AQUA'], network: 'testnet' }));
  });

  it('executeRoute produces a real, live-verified unsigned XDR and real resource estimate for a live SWAP quote', async () => {
    const route = await computeRoute(
      { action: 'SWAP', asset: 'XLM', outputAsset: 'AQUA', amount: '1', network: 'testnet', adapterParams: { trustlineEstablished: true, deadline: Math.floor(Date.now() / 1000) + 3600, minOutput: '0.000001' } },
      registry,
    );
    expect(route.selectedProtocol).toBe('aquarius');

    const provider = createAquariusRealTransactionProvider({
      rpcUrl: getSorobanRpcUrl('testnet'),
      sourceAccountPublicKey: getAquariusSimulationSourceAccount(),
      backendApiBaseUrl: getAquariusBackendApiUrl('testnet'),
    });

    const result = await executeRoute(makePlan(), route, registry, { realTransactionProviders: { aquarius: provider } });

    expect(result.status).toBe('success');
    expect(result.metadata.dataSource).toBe('real');
    expect(result.transactionXDR).not.toBeNull();
    expect(result.resourceEstimate!.cpuInstructions).toBeGreaterThan(0);
    expect(Number(result.resourceEstimate!.resourceFeeStroops)).toBeGreaterThan(0);

    const verified = verifyUnsignedXdr(result.transactionXDR!, 'testnet', getAquariusRouterContractId('testnet'), 'swap_chained');
    expect(verified.ok).toBe(true);
  }, 60_000);

  // Note: NOT asserting executionHash equality across two live calls here — unlike the offline/
  // mocked suites (`executionEngineRealXdr.test.ts`, `executionEngineV2.test.ts`, both of which
  // do prove exact hash-determinism against a fixed simulation response), a live Soroban RPC
  // response's exact resource/fee numbers can vary slightly between two real network calls (ledger
  // state moves), so an exact-hash replay assertion against live data would be flaky by
  // construction, not a real regression signal. Determinism is a property of the engine given a
  // deterministic input, and is proven deterministically (not against live variance) elsewhere.
  it('two live calls both succeed and independently produce a verifiable real XDR', async () => {
    const route = await computeRoute(
      { action: 'SWAP', asset: 'XLM', outputAsset: 'AQUA', amount: '1', network: 'testnet', adapterParams: { trustlineEstablished: true, deadline: Math.floor(Date.now() / 1000) + 3600, minOutput: '0.000001' } },
      registry,
    );
    const provider = createAquariusRealTransactionProvider({
      rpcUrl: getSorobanRpcUrl('testnet'),
      sourceAccountPublicKey: getAquariusSimulationSourceAccount(),
      backendApiBaseUrl: getAquariusBackendApiUrl('testnet'),
    });
    const resultA = await executeRoute(makePlan(), route, registry, { realTransactionProviders: { aquarius: provider } });
    const resultB = await executeRoute(makePlan(), route, registry, { realTransactionProviders: { aquarius: provider } });
    for (const result of [resultA, resultB]) {
      expect(result.status).toBe('success');
      expect(verifyUnsignedXdr(result.transactionXDR!, 'testnet', getAquariusRouterContractId('testnet'), 'swap_chained').ok).toBe(true);
    }
  }, 60_000);
});
