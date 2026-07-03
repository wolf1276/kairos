/**
 * Smoke test: proves the agent session-key spend path end-to-end on testnet without
 * spinning up the MCP stdio transport — it calls the same handler the MCP tool uses.
 *
 * Usage:
 *   export FUNDER_SECRET_KEY=SC...
 *   npx tsx scripts/smoke-test.ts
 */
import { Address, Keypair, Operation, TransactionBuilder, xdr, Asset } from '@stellar/stellar-sdk';
import { KairosClient } from '@wolf1276/kairos-sdk';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { spendFundsHandler } from '../src/tools/spendFunds.js';

// The smart wallet's `is_valid_signature` verifies a SEP-53-wrapped signature (what a real
// browser wallet's `signMessage` produces), not a raw signature over the bare hash — see
// contracts/soroban/contracts/custom-account/src/lib.rs. Mirrors apps/web's
// `signDelegationHashWithFreighter`, using a real Keypair in place of Freighter.
function sep53Sign(signingKey: Keypair, hashHex: string): Buffer {
  const payload = Buffer.concat([Buffer.from('Stellar Signed Message:\n'), Buffer.from(hashHex, 'utf8')]);
  const messageHash = crypto.createHash('sha256').update(payload).digest();
  return signingKey.sign(messageHash);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(__dirname, '../../../configs/contracts.testnet.json');
const FUNDER_SECRET = process.env.FUNDER_SECRET_KEY;

async function main() {
  if (!FUNDER_SECRET) throw new Error('FUNDER_SECRET_KEY env var not set.');
  const contracts = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

  const funder = Keypair.fromSecret(FUNDER_SECRET);
  const agent = Keypair.random();
  console.log('Agent (ephemeral) pubkey:', agent.publicKey());

  const client = new KairosClient({
    network: 'testnet',
    contracts: {
      delegationManager: contracts.delegationManager,
      policyEngine: contracts.policyEngine,
      smartWallet: contracts.customAccount,
    },
  });

  await client.ensureFundedTestnetAccount(funder.publicKey());
  await client.ensureFundedTestnetAccount(agent.publicKey());

  console.log('\n--- Deploying smart wallet (delegator) owned by funder ---');
  const wallet = await client.wallet.create(funder, contracts.customAccountWasmHash);
  console.log('Smart wallet address:', wallet.address);

  const nativeAssetId = Asset.native().contractId(client.networkPassphrase);
  const fundAmount = 100_000_000n; // 10 XLM
  const spendLimit = 10_000_000n; // 1 XLM per day
  const transferAmount = 5_000_000n; // 0.5 XLM — within limit
  const overLimitAmount = 20_000_000n; // 2 XLM — exceeds limit

  console.log('\n--- Funding smart wallet with 10 XLM ---');
  const funderAcc = await client.getAccount(funder.publicKey());
  const fundOp = Operation.invokeContractFunction({
    contract: nativeAssetId,
    function: 'transfer',
    args: [
      Address.fromString(funder.publicKey()).toScVal(),
      Address.fromString(wallet.address).toScVal(),
      xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: xdr.Int64.fromString('0'), lo: xdr.Uint64.fromString(fundAmount.toString()) })),
    ],
  });
  const fundTx = new TransactionBuilder(funderAcc, { fee: '100000', networkPassphrase: client.networkPassphrase })
    .addOperation(fundOp)
    .setTimeout(30)
    .build();
  const fundResult = await client.submitTransaction(fundTx, funder);
  if (fundResult.status !== 'SUCCESS') throw new Error(`Failed to fund wallet: ${fundResult.error}`);

  console.log('\n--- Creating delegation: delegate = agent pubkey, delegator = smart wallet, spend-limit = 1 XLM/day ---');
  const spendLimitPolicy = await client.policy.create({
    type: 'spend-limit',
    token: nativeAssetId,
    spendLimit,
    period: 86400n,
  });

  const delegation = await client.delegation.create({
    delegate: agent.publicKey(),
    delegator: wallet.address,
    caveats: [spendLimitPolicy],
    // Reusable (nonce == u64::MAX) — this delegation is redeemed twice below (once within
    // the spend limit, once over it), which a single-use nonce wouldn't allow.
    nonce: (1n << 64n) - 1n,
    signer: (hash: Buffer) => sep53Sign(funder, hash.toString('hex')),
  });
  const hash = client.delegation.getHash(delegation);
  console.log('Delegation hash:', hash);

  // Export the delegation JSON exactly as the dashboard's "Export for agent" panel would,
  // into a temp delegations dir the smoke test points KAIROS_DELEGATIONS_DIR at.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairos-agent-smoke-'));
  const jsonSafe = {
    ...delegation,
    salt: delegation.salt.toString(),
    nonce: delegation.nonce.toString(),
    caveats: delegation.caveats.map((c) => ({ enforcer: c.enforcer, terms: Array.from(c.terms) })),
  };
  fs.writeFileSync(path.join(tmpDir, `${hash}.json`), JSON.stringify(jsonSafe, null, 2));
  process.env.KAIROS_DELEGATIONS_DIR = tmpDir;
  process.env.DELEGATION_MANAGER_CONTRACT_ID = contracts.delegationManager;
  process.env.POLICY_CONTRACT_ID = contracts.policyEngine;
  process.env.CUSTOM_ACCOUNT_CONTRACT_ID = contracts.customAccount;

  console.log('\n--- Within-limit transfer (0.5 XLM) ---');
  const okResult = await spendFundsHandler(
    { token: nativeAssetId, to: funder.publicKey(), amount: transferAmount.toString() },
    agent
  );
  console.log(JSON.stringify(okResult, null, 2));
  if (okResult.isError) throw new Error('Expected within-limit transfer to succeed');

  console.log('\n--- Over-limit transfer (2 XLM, exceeds 1 XLM/day limit) ---');
  const failResult = await spendFundsHandler(
    { token: nativeAssetId, to: funder.publicKey(), amount: overLimitAmount.toString() },
    agent
  );
  console.log(JSON.stringify(failResult, null, 2));
  if (!failResult.isError) throw new Error('Expected over-limit transfer to fail');

  console.log('\n✓ Smoke test passed: agent spent within its delegation limit and was blocked over it.');
}

main().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
