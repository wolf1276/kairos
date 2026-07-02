import { Address, Asset, Keypair, Operation, rpc, TransactionBuilder, xdr, Account } from '@stellar/stellar-sdk';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { KairosClient } from '../packages/sdk/src';

const CONFIG_FILE = path.join(__dirname, '../configs/contracts.testnet.json');

async function fundAccount(publicKey: string): Promise<void> {
  const url = `https://friendbot.stellar.org?addr=${publicKey}`;
  console.log(`Funding account: ${publicKey} via Friendbot...`);
  await axios.get(url);
  console.log('Account funded successfully.');
}

async function waitForAccount(client: KairosClient, address: string): Promise<Account> {
  console.log(`Waiting for account ${address} to be available on Soroban RPC...`);
  for (let i = 0; i < 15; i++) {
    try {
      const acct = await client.rpcProvider.getAccount(address);
      if (acct && acct.sequenceNumber() && BigInt(acct.sequenceNumber()) > 0n) {
        console.log(`Account ${address} is ready (Sequence: ${acct.sequenceNumber()}).`);
        return acct;
      }
    } catch (e) {
      // not ready
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`Account ${address} did not become ready on Soroban RPC in time`);
}

async function main() {
  console.log('--- Starting Kairos SDK End-to-End Integration Test ---');

  if (!fs.existsSync(CONFIG_FILE)) {
    console.error('Config file configs/contracts.testnet.json not found! Run deployment first.');
    process.exit(1);
  }

  const contracts = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  console.log('Using deployed contracts:', contracts);

  // 1. Generate keys for owner, delegate, and redeemer
  const owner = Keypair.random();
  const delegate = Keypair.random();
  const redeemer = Keypair.random();

  console.log(`Owner public key: ${owner.publicKey()}`);
  console.log(`Delegate public key: ${delegate.publicKey()}`);
  console.log(`Redeemer public key: ${redeemer.publicKey()}`);

  // 2. Fund the accounts via Friendbot
  await fundAccount(owner.publicKey());
  await fundAccount(delegate.publicKey());
  await fundAccount(redeemer.publicKey());

  // 3. Initialize Kairos Client
  const client = new KairosClient({
    network: 'testnet',
    contracts: {
      delegationManager: contracts.delegationManager,
      policyEngine: contracts.policyEngine,
      customAccount: contracts.customAccount,
    },
  });

  console.log('KairosClient initialized.');

  // Wait for ingestion
  await waitForAccount(client, owner.publicKey());
  await waitForAccount(client, delegate.publicKey());
  await waitForAccount(client, redeemer.publicKey());

  // 4. Deploy CustomAccount (Smart Wallet) for Owner
  console.log('Deploying Smart CustomAccount...');
  const wallet = await client.wallet.create(owner, contracts.customAccountWasmHash);
  console.log(`Smart CustomAccount deployed successfully at: ${wallet.address}`);
  console.log(`Wallet owner: ${wallet.owner}`);

  // 5. Fund the Smart CustomAccount with some XLM from Owner
  console.log('Funding Smart CustomAccount with 50 XLM from Owner...');
  const nativeAssetContractId = Asset.native().contractId(client.networkPassphrase);
  const ownerAccount = await client.getAccount(owner.publicKey());
  const paymentOp = Operation.invokeContractFunction({
    contract: nativeAssetContractId,
    function: 'transfer',
    args: [
      Address.fromString(owner.publicKey()).toScVal(),
      Address.fromString(wallet.address).toScVal(),
      xdr.ScVal.scvI128(new xdr.Int128Parts({
        hi: 0n,
        lo: 50n * 10000000n,
      })),
    ],
  });

  const fundTx = new TransactionBuilder(ownerAccount, {
    fee: '100000',
    networkPassphrase: client.networkPassphrase,
  })
    .addOperation(paymentOp)
    .setTimeout(30)
    .build();

  const fundResult = await client.submitTransaction(fundTx, owner);
  if (fundResult.status !== 'SUCCESS') {
    throw new Error(`Failed to fund CustomAccount smart wallet: ${typeof fundResult.error === 'object' ? JSON.stringify(fundResult.error) : fundResult.error}`);
  }
  console.log('Smart CustomAccount funded.');

  // 6. Get the Native Asset Contract ID
  console.log(`Native Asset Contract ID: ${nativeAssetContractId}`);

  // Verify wallet balance
  const initialWalletBalance = await client.wallet.balance(wallet.address, nativeAssetContractId);
  console.log(`Initial wallet native balance: ${initialWalletBalance.toString()} stroops`);

  // 7. Create caveats/policies
  // We whitelist the native asset contract for target calls
  console.log('Creating Target Whitelist Policy caveat...');
  const targetPolicy = await client.policy.create({
    type: 'target-whitelist',
    target: nativeAssetContractId,
  });

  // 8. Create a signed delegation
  console.log('Creating signed delegation...');
  const delegation = await client.delegation.create({
    delegate: delegate.publicKey(),
    delegator: wallet.address,
    caveats: [targetPolicy],
    signer: owner,
  });

  console.log(`Delegation created with hash: ${client.delegation.getHash(delegation)}`);

  // Verify delegation is not disabled on-chain
  const delegationStatus = await client.delegation.get(client.delegation.getHash(delegation));
  console.log(`Is delegation disabled? ${delegationStatus.disabled}`);
  if (delegationStatus.disabled) {
    throw new Error('Newly created delegation should not be disabled');
  }

  // 9. Prepare Delegated Execution
  // Delegate will transfer 10 XLM (100_000_000 stroops) from wallet to delegate
  console.log('Preparing delegated execution: transfer 10 XLM...');
  const executionAmount = 100_000_000n; // 10 XLM in stroops (7 decimals)
  
  // Build transfer arguments: [from, to, amount]
  const fromSc = Address.fromString(wallet.address).toScVal();
  const toSc = Address.fromString(delegate.publicKey()).toScVal();
  const amountSc = xdr.ScVal.scvI128(new xdr.Int128Parts({
    hi: 0n,
    lo: executionAmount,
  }));

  const execution = {
    target: nativeAssetContractId,
    function: 'transfer',
    args: [fromSc, toSc, amountSc],
  };

  // 10. Redeem/Execute delegation on-chain
  console.log('Submitting delegated execution via redeemer...');
  const execResult = await client.execution.execute({
    redeemer: delegate,
    delegationChains: [delegation],
    executions: execution,
  });

  if (execResult.status !== 'SUCCESS') {
    throw new Error(`Delegated execution failed: ${typeof execResult.error === 'object' ? JSON.stringify(execResult.error) : execResult.error}`);
  }
  console.log(`Delegated execution succeeded in transaction: ${execResult.hash}`);

  // 11. Assert final balance changes
  const finalWalletBalance = await client.wallet.balance(wallet.address, nativeAssetContractId);
  console.log(`Final wallet native balance: ${finalWalletBalance.toString()} stroops`);
  
  const expectedBalance = initialWalletBalance - executionAmount;
  console.log(`Expected balance: ${expectedBalance.toString()} stroops`);

  if (finalWalletBalance !== expectedBalance) {
    throw new Error(`Balance mismatch! Expected ${expectedBalance}, got ${finalWalletBalance}`);
  }

  console.log('--- Kairos SDK End-to-End Integration Test PASSED ---');
}

main().catch(err => {
  console.error('Integration test failed:');
  console.dir(err, { depth: null });
  process.exit(1);
});
