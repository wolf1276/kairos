// Manual, one-off script to verify the real Aquarius integration end-to-end against live
// testnet. Not part of the automated test suite (requires network + a funded testnet account) —
// run manually with `AQUARIUS_ROUTER_CONTRACT_ID_TESTNET=... AQUARIUS_SIMULATION_SOURCE_ACCOUNT=... npx tsx scripts/verifyAquariusLive.ts`.
import { createProductionAquariusAdapter } from '../src/protocolAdapters/aquarius/index.js';

async function main() {
  const adapter = createProductionAquariusAdapter({ supportedAssets: ['XLM', 'AQUA'], network: 'testnet' });

  console.log('--- health() ---');
  console.log(await adapter.health());

  console.log('--- POOL_DISCOVERY simulate() (real backend API) ---');
  const poolDiscovery = await adapter.simulate({ action: 'POOL_DISCOVERY', asset: 'XLM', network: 'testnet', amount: '0' });
  console.log(JSON.stringify(poolDiscovery, null, 2));

  console.log('--- quote() for SWAP XLM -> AQUA (real on-chain simulate) ---');
  const quote = await adapter.quote!({ action: 'SWAP', asset: 'XLM', network: 'testnet', amount: '1', params: { outputAsset: 'AQUA', trustlineEstablished: true } });
  console.log(JSON.stringify(quote, null, 2));

  console.log('--- simulate() for SWAP XLM -> AQUA (real Soroban RPC simulateTransaction) ---');
  const simSwap = await adapter.simulate({ action: 'SWAP', asset: 'XLM', network: 'testnet', amount: '1', params: { outputAsset: 'AQUA', trustlineEstablished: true } });
  console.log(JSON.stringify(simSwap, null, 2));

  console.log('--- buildTransaction() for SWAP (unsigned, not submitted) ---');
  const tx = await adapter.buildTransaction!({ action: 'SWAP', asset: 'XLM', network: 'testnet', amount: '1', params: { outputAsset: 'AQUA', trustlineEstablished: true } });
  console.log(JSON.stringify(tx, null, 2));

  const poolId = '9ac7a9cde23ac2ada11105eeaa42e43c2ea8332ca0aa8f41f58d7160274d718e'; // real XLM/AQUA pool, discovered live above

  console.log('--- simulate() for CLAIM_REWARDS (real, on real XLM/AQUA pool) ---');
  const simClaim = await adapter.simulate({ action: 'CLAIM_REWARDS', asset: 'XLM', network: 'testnet', amount: '0', params: { poolId } });
  console.log(JSON.stringify(simClaim, null, 2));

  console.log('--- simulate() for WITHDRAW (real, 0 shares — no real LP position) ---');
  const simWithdraw = await adapter.simulate({ action: 'WITHDRAW', asset: 'XLM', network: 'testnet', amount: '0', params: { poolId } });
  console.log(JSON.stringify(simWithdraw, null, 2));

  console.log('--- simulate() for SWAP_CHAINED (real, single hop via explicit path) ---');
  const simChained = await adapter.simulate({ action: 'SWAP_CHAINED', asset: 'XLM', network: 'testnet', amount: '1', params: { path: ['XLM', 'AQUA'], trustlineEstablished: true } });
  console.log(JSON.stringify(simChained, null, 2));

  console.log('--- simulate() for DEPOSIT (real — expected to fail: source account has no AQUA balance) ---');
  const simDeposit = await adapter.simulate({ action: 'DEPOSIT', asset: 'XLM', network: 'testnet', amount: '1', params: { assetB: 'AQUA', trustlineEstablished: true } });
  console.log(JSON.stringify(simDeposit, null, 2));
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
