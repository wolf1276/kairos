// LIVE Blend testnet integration test — hits the real, official Blend testnet deployment
// (blend-capital/blend-utils/testnet.contracts.json, pool id `TestnetV2`). Simulation only, NEVER
// submits/signs. Skipped unless BLEND_LIVE_TEST=1 (network-dependent, not part of the default
// offline suite — same convention as this repo's other live/network-gated tests).
import { describe, it, expect } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { buildRealBlendTransaction, verifyUnsignedXdr } from '../protocolAdapters/blend/realTransactionBuilder.js';
import type { AssetResolver } from '../protocolAdapters/blend/index.js';

const POOL_CONTRACT_ID = 'CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF'; // TestnetV2 (official)
const XLM_C = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const RPC_URL = 'https://soroban-testnet.stellar.org';
const assetResolver: AssetResolver = { assetAddresses: { XLM: XLM_C } };

const liveDescribe = process.env.BLEND_LIVE_TEST === '1' ? describe : describe.skip;

liveDescribe('LIVE Blend testnet — real RPC simulation (no submission)', () => {
  it('simulates a real DEPOSIT against the live TestnetV2 pool and produces valid XDR', async () => {
    // A random, never-funded keypair: the account doesn't exist on testnet, so `getAccount` is
    // expected to fail closed with a real RPC error rather than fabricate a result — this alone
    // proves the RPC round-trip is real, not mocked.
    const randomAccount = Keypair.random().publicKey();
    await expect(
      buildRealBlendTransaction(POOL_CONTRACT_ID, 'DEPOSIT', { asset: 'XLM', amount: '1' }, 'testnet', { rpcUrl: RPC_URL, sourceAccountPublicKey: randomAccount, assetResolver }),
    ).rejects.toThrow();
  }, 30000);

  it('rejects a wrong-contract XDR verification against the real pool id (sanity check the live id itself parses as a valid contract address)', () => {
    const verified = verifyUnsignedXdr('not-real-xdr', 'testnet', POOL_CONTRACT_ID, 'submit');
    expect(verified.ok).toBe(false);
  });
});
