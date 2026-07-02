/**
 * Kairos End-to-End Demo
 *
 * Runs the FULL flow from a funded testnet key:
 *   1. Parse a natural-language intent → TradingProfile
 *   2. Get live market data → DecisionEngine → policy-gated proposal
 *   3. Deploy a smart wallet (CustomAccount)
 *   4. Fund the wallet
 *   5. Create on-chain policies from the TradingProfile
 *   6. Create a signed delegation
 *   7. Execute a delegated trade on-chain
 *   8. Assert on-chain state changes
 *
 * Usage:
 *   export FUNDER_SECRET_KEY=SC…
 *   npx tsx scripts/demo-e2e.ts
 */

import { Address, Asset, Keypair, Operation, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { KairosClient } from '../packages/sdk/src';

// ── Config ──

const CONFIG_FILE = path.join(__dirname, '../configs/contracts.testnet.json');
const FUNDER_SECRET = process.env.FUNDER_SECRET_KEY;
const DEMO_INTENT = "I want to grow my portfolio steadily with moderate risk, focusing on Stellar ecosystem assets like XLM. Keep daily trade limit under 2000 XLM and max position size under 500 XLM worth. Stop loss at 3%, take profit at 8%.";

// ── Helpers ──

async function fundAccount(publicKey: string): Promise<void> {
  const url = `https://friendbot.stellar.org?addr=${publicKey}`;
  console.log(`  Funding ${publicKey} via Friendbot...`);
  await axios.get(url);
  console.log('  Funded.');
}

async function waitForAccount(client: KairosClient, address: string): Promise<void> {
  for (let i = 0; i < 15; i++) {
    try {
      const acct = await client.rpcProvider.getAccount(address);
      if (acct && acct.sequenceNumber() && BigInt(acct.sequenceNumber()) > 0n) return;
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`Account ${address} did not become ready`);
}

function printf(label: string, value: string): void {
  console.log(`  ${label}: ${value}`);
}

// ── Main ──

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║       Kairos End-to-End Demo                 ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  // ── 0. Validate config ──

  if (!fs.existsSync(CONFIG_FILE)) {
    console.error('✗ configs/contracts.testnet.json not found. Run scripts/deploy-testnet.ts first.');
    process.exit(1);
  }
  if (!FUNDER_SECRET) {
    console.error('✗ FUNDER_SECRET_KEY env var not set.');
    process.exit(1);
  }

  const contracts = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  console.log('✓ Contracts loaded:', contracts);
  console.log('');

  // ── 1. Intent Parsing (HF → fallback to regex) ──

  console.log('─── Step 1: Intent Parsing ───');
  console.log(`  Input: "${DEMO_INTENT}"`);

  let tradingProfile: Record<string, unknown> | undefined;

  try {
    const { parseIntentWithHf } = await import('../apps/web/lib/decision/hfIntentParser');
    const result = await parseIntentWithHf(DEMO_INTENT);
    if (result.status === 'COMPLETE' && result.profile) {
      tradingProfile = result.profile as unknown as Record<string, unknown>;
      console.log('  ✓ Parsed via Hugging Face API');
    } else {
      console.log('  ⚠ HF parser returned NEEDS_USER_INPUT, falling back to regex...');
    }
  } catch {
    console.log('  ⚠ HF parser unavailable, falling back to regex...');
  }

  if (!tradingProfile) {
    const { parseIntent } = await import('../apps/web/lib/decision/intentParser');
    const parsed = parseIntent({ text: DEMO_INTENT });
    tradingProfile = parsed.profile as unknown as Record<string, unknown> ?? parsed.extracted;
    printf('Goal', (tradingProfile.goal as string) || 'N/A');
    console.log('  ✓ Parsed via regex fallback');
  }

  printf('Goal', (tradingProfile.goal as string) || 'N/A');
  printf('Risk Tolerance', (tradingProfile.riskTolerance as string) || 'N/A');
  printf('Horizon', (tradingProfile.investmentHorizon as string) || 'N/A');
  printf('Assets', (tradingProfile.allowedAssets as string[])?.join(', ') || 'N/A');
  printf('Daily Limit', String(tradingProfile.dailyTradeLimit ?? 'N/A'));
  printf('Max Position', String(tradingProfile.maxPositionSize ?? 'N/A'));
  console.log('');

  // ── 2. Market Analysis & Decision Engine ──

  console.log('─── Step 2: Market Analysis & Decision ───');

  const { BinanceOracle } = await import('../apps/web/oracle/BinanceOracle');
  const oracle = new BinanceOracle('1h');
  const symbol = 'XLMUSDT';

  let marketSnapshot = await oracle.fetchSnapshot(symbol);
  printf('Symbol', symbol);
  printf('Price', `$${marketSnapshot.price.toFixed(4)}`);
  printf('RSI (14)', marketSnapshot.indicators.rsi.toFixed(2));
  printf('MACD Hist', marketSnapshot.indicators.macd.histogram.toFixed(6));
  printf('EMA 20/50', `${marketSnapshot.indicators.ema20.toFixed(4)} / ${marketSnapshot.indicators.ema50.toFixed(4)}`);
  console.log('');

  const { DecisionEngine } = await import('../apps/web/lib/decision/index');
  const engine = new DecisionEngine();

  const proposal = await engine.decide({
    marketSnapshot,
    walletContext: { balance: 10000 },
    delegationContext: {
      automationMode: 'AI_MANAGED',
      delegatedAmount: 5000,
      tradingProfile: tradingProfile as any,
    },
  });

  printf('Decision', `${proposal.action} (confidence: ${proposal.confidence.toFixed(2)})`);
  printf('Amount', `${proposal.amount.toFixed(4)} units`);
  printf('Reasoning', proposal.reasoning.slice(0, 120));
  if (proposal.stopLoss) printf('Stop Loss', `$${proposal.stopLoss.toFixed(4)}`);
  if (proposal.takeProfit) printf('Take Profit', `$${proposal.takeProfit.toFixed(4)}`);
  console.log('');

  // ── 3. Set up on-chain keys ──

  console.log('─── Step 3: On-Chain Setup ───');

  const funder = Keypair.fromSecret(FUNDER_SECRET);
  const delegate = Keypair.random();
  const owner = Keypair.random();

  const client = new KairosClient({
    network: 'testnet',
    contracts: {
      delegationManager: contracts.delegationManager,
      policyEngine: contracts.policyEngine,
      customAccount: contracts.customAccount,
    },
  });

  // Fund the new accounts
  await fundAccount(owner.publicKey());
  await fundAccount(delegate.publicKey());
  await waitForAccount(client, owner.publicKey());
  await waitForAccount(client, delegate.publicKey());
  printf('Owner', owner.publicKey());
  printf('Delegate', delegate.publicKey());
  console.log('');

  // ── 4. Deploy Smart Wallet ──

  console.log('─── Step 4: Deploy Smart Wallet ───');
  const wallet = await client.wallet.create(owner, contracts.customAccountWasmHash);
  printf('Wallet Address', wallet.address);
  printf('Wallet Owner', wallet.owner);
  console.log('');

  // ── 5. Fund Smart Wallet ──

  console.log('─── Step 5: Fund Smart Wallet ───');
  const nativeAssetId = Asset.native().contractId(client.networkPassphrase);
  const fundAmount = 500_000_000n; // 50 XLM

  const ownerAcc = await client.getAccount(owner.publicKey());
  const fundOp = Operation.invokeContractFunction({
    contract: nativeAssetId,
    function: 'transfer',
    args: [
      Address.fromString(owner.publicKey()).toScVal(),
      Address.fromString(wallet.address).toScVal(),
      xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: 0n, lo: fundAmount })),
    ],
  });

  const fundTx = new TransactionBuilder(ownerAcc, {
    fee: '100000',
    networkPassphrase: client.networkPassphrase,
  })
    .addOperation(fundOp)
    .setTimeout(30)
    .build();

  const fundResult = await client.submitTransaction(fundTx, owner);
  if (fundResult.status !== 'SUCCESS') {
    throw new Error(`Failed to fund wallet: ${fundResult.error}`);
  }
  printf('Funded', '50 XLM');

  const initialBalance = await client.wallet.balance(wallet.address, nativeAssetId);
  printf('Wallet Balance (initial)', `${initialBalance.toString()} stroops`);
  console.log('');

  // ── 6. Create on-chain policies from TradingProfile ──

  console.log('─── Step 6: Create Policies ───');

  const allowedAssets = (tradingProfile.allowedAssets as string[]) || [];
  const policies: any[] = [];

  // Target-whitelist policy for the native asset (XLM)
  const targetPolicy = await client.policy.create({
    type: 'target-whitelist',
    target: nativeAssetId,
  });
  policies.push(targetPolicy);
  printf('Policy 1', `target-whitelist (native asset ${nativeAssetId.slice(0, 8)}...)`);

  // Spend-limit policy from the daily trade limit
  if (tradingProfile.dailyTradeLimit) {
    const spendPolicy = await client.policy.create({
      type: 'spend-limit',
      token: nativeAssetId,
      spendLimit: BigInt(Math.floor(Number(tradingProfile.dailyTradeLimit) * 10_000_000)),
      period: 86400n, // daily
    });
    policies.push(spendPolicy);
    printf('Policy 2', `spend-limit (${tradingProfile.dailyTradeLimit} USD daily)`);
  }
  console.log('');

  // ── 7. Create signed delegation ──

  console.log('─── Step 7: Create Delegation ───');
  const delegation = await client.delegation.create({
    delegate: delegate.publicKey(),
    delegator: wallet.address,
    caveats: policies,
    signer: owner,
  });

  const delegationHash = client.delegation.getHash(delegation);
  printf('Delegation Hash', delegationHash);

  const status = await client.delegation.get(delegationHash);
  printf('Disabled?', String(status.disabled));
  console.log('');

  // ── 8. Execute delegated trade ──

  console.log('─── Step 8: Execute Delegated Trade ───');

  // Transfer a small amount (0.5 XLM) from wallet → delegate to prove on-chain execution
  const execAmount = 5_000_000n; // 0.5 XLM

  const execResult = await client.execution.execute({
    redeemer: delegate,
    delegationChains: [delegation],
    executions: {
      target: nativeAssetId,
      function: 'transfer',
      args: [
        Address.fromString(wallet.address).toScVal(),
        Address.fromString(delegate.publicKey()).toScVal(),
        xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: 0n, lo: execAmount })),
      ],
    },
  });

  if (execResult.status !== 'SUCCESS') {
    throw new Error(`Execution failed: ${JSON.stringify(execResult.error)}`);
  }
  printf('Tx Hash', execResult.hash || 'N/A');
  console.log('');

  // ── 9. Assert on-chain effect ──

  console.log('─── Step 9: Assert On-Chain Effect ───');

  const finalBalance = await client.wallet.balance(wallet.address, nativeAssetId);
  printf('Wallet Balance (final)', `${finalBalance.toString()} stroops`);
  printf('Expected', `${(initialBalance - execAmount).toString()} stroops`);

  if (finalBalance !== initialBalance - execAmount) {
    throw new Error(
      `Balance mismatch: expected ${initialBalance - execAmount}, got ${finalBalance}`
    );
  }

  const delegateBalance = await client.wallet.balance(delegate.publicKey(), nativeAssetId);
  printf('Delegate Balance', `${delegateBalance.toString()} stroops`);

  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║     ✅  Demo PASSED — Full flow verified    ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
  console.log('Flow summary:');
  console.log('  1. Intent → TradingProfile');
  console.log(`     "${(tradingProfile.goal as string)?.slice(0, 50)}..."`);
  console.log(`  2. Market → Decision → ${proposal.action} (${(proposal.confidence * 100).toFixed(0)}% confidence)`);
  console.log('  3. Wallet deployed');
  console.log(`  4. ${policies.length} policy caveats created (target-whitelist + spend-limit)`);
  console.log('  5. Delegation signed & verified on-chain');
  console.log(`  6. Transferred ${Number(execAmount) / 10_000_000} XLM via delegated execution`);
  console.log('  7. On-chain balance change verified');
}

main().catch(err => {
  console.error('');
  console.error('╔══════════════════════════════════════════════╗');
  console.error('║     ❌  Demo FAILED                         ║');
  console.error('╚══════════════════════════════════════════════╝');
  console.error(err.message || err);
  process.exit(1);
});
