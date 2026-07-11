import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Mirrors scripts/deploy-testnet.ts, hardcoded to MAINNET. Deploys real, audited contracts
// with real funds — fails fast (throws) on any error instead of continuing, and refuses to
// overwrite an existing configs/contracts.mainnet.json unless --confirm/--force is passed.
const DEPLOYER_ALIAS = 'deployer';
const NETWORK = 'mainnet';
const CONFIG_DIR = path.join(__dirname, '../configs');
const CONFIG_FILE = path.join(CONFIG_DIR, 'contracts.mainnet.json');

const FORCE = process.argv.includes('--confirm') || process.argv.includes('--force');

// Max inclusion fee (stroops) bid per transaction. This is a CAP, not the amount charged —
// the network only deducts the actual required fee. Default 10_000_000 stroops (1 XLM) gives
// generous headroom over mainnet's minimum to avoid TxInsufficientFee. Override with STELLAR_FEE.
const FEE = process.env.STELLAR_FEE || '10000000';

function runCommand(cmd: string, cwd = '.'): string {
  console.log(`Running: ${cmd} in ${cwd}`);
  const stdout = execSync(cmd, { encoding: 'utf8', cwd });
  console.log(stdout);
  return stdout.trim();
}

function extractWasmHash(stdout: string, label: string): string {
  const match = stdout.match(/([a-f0-9]{64})/i);
  if (!match) {
    throw new Error(`Failed to parse ${label} Wasm hash from upload output: ${stdout}`);
  }
  return match[1];
}

function extractContractId(stdout: string, label: string): string {
  const match = stdout.match(/(C[A-Z0-9]{55})/);
  if (!match) {
    throw new Error(`Failed to parse ${label} contract ID from deploy output: ${stdout}`);
  }
  return match[1];
}

async function main() {
  if (fs.existsSync(CONFIG_FILE) && !FORCE) {
    throw new Error(
      `${CONFIG_FILE} already exists. Refusing to overwrite a mainnet deployment record. ` +
        `Re-run with --confirm (or --force) if you intend to redeploy and overwrite it.`
    );
  }

  // 1. Build the contracts (runs in contracts/soroban)
  console.log('Building Soroban contracts...');
  runCommand('stellar contract build', 'contracts/soroban');

  // 2. Get deployer address
  console.log('Retrieving deployer address...');
  const deployerAddress = runCommand(`stellar keys address ${DEPLOYER_ALIAS}`);

  // 3. Upload CustomAccount Wasm and get hash
  console.log('Uploading CustomAccount Wasm...');
  const customAccountUploadStdout = runCommand(
    `stellar contract upload --wasm target/wasm32v1-none/release/custom_account.wasm --source ${DEPLOYER_ALIAS} --network ${NETWORK} --fee ${FEE}`,
    'contracts/soroban'
  );
  const customAccountWasmHash = extractWasmHash(customAccountUploadStdout, 'CustomAccount');
  console.log(`CustomAccount Wasm Hash: ${customAccountWasmHash}`);

  // 4. Deploy DelegationManager (CreateContractV2: --owner is a constructor arg, atomic with
  // deploy — see docs/security/MAINNET_AUDIT.md, P0-1).
  console.log('Deploying DelegationManager...');
  const managerStdout = runCommand(
    `stellar contract deploy --wasm target/wasm32v1-none/release/delegation_manager.wasm --source ${DEPLOYER_ALIAS} --network ${NETWORK} --fee ${FEE} -- --owner ${deployerAddress}`,
    'contracts/soroban'
  );
  const delegationManagerId = extractContractId(managerStdout, 'DelegationManager');
  console.log(`DelegationManager Contract ID: ${delegationManagerId}`);

  // 5. Deploy Policies (CreateContractV2: --delegation_manager is a constructor arg — only this
  // DelegationManager may invoke the policy hooks).
  console.log('Deploying Policies...');
  const policiesStdout = runCommand(
    `stellar contract deploy --wasm target/wasm32v1-none/release/policies.wasm --source ${DEPLOYER_ALIAS} --network ${NETWORK} --fee ${FEE} -- --delegation_manager ${delegationManagerId}`,
    'contracts/soroban'
  );
  const policyEngineId = extractContractId(policiesStdout, 'Policies');
  console.log(`Policies Contract ID: ${policyEngineId}`);

  // 6. Deploy a CustomAccount instance (CreateContractV2: --owner / --delegation_manager are
  // constructor args, atomic with deploy).
  console.log('Deploying CustomAccount Instance...');
  const accountStdout = runCommand(
    `stellar contract deploy --wasm target/wasm32v1-none/release/custom_account.wasm --source ${DEPLOYER_ALIAS} --network ${NETWORK} --fee ${FEE} -- --owner ${deployerAddress} --delegation_manager ${delegationManagerId}`,
    'contracts/soroban'
  );
  const customAccountId = extractContractId(accountStdout, 'CustomAccount');
  console.log(`CustomAccount Contract ID: ${customAccountId}`);

  // 7. Deploy Registry (CreateContractV2: --admin is a constructor arg, atomic with deploy).
  console.log('Deploying Registry...');
  const registryStdout = runCommand(
    `stellar contract deploy --wasm target/wasm32v1-none/release/registry.wasm --source ${DEPLOYER_ALIAS} --network ${NETWORK} --fee ${FEE} -- --admin ${deployerAddress}`,
    'contracts/soroban'
  );
  const registryId = extractContractId(registryStdout, 'Registry');
  console.log(`Registry Contract ID: ${registryId}`);

  // DelegationManager, CustomAccount, and Registry were all constructed atomically at deploy
  // time above (steps 4, 6, 7) — no separate init transactions.

  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  const config = {
    delegationManager: delegationManagerId,
    policyEngine: policyEngineId,
    customAccount: customAccountId,
    customAccountWasmHash: customAccountWasmHash,
    registry: registryId,
  };

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  console.log(`Successfully wrote contract configuration to ${CONFIG_FILE}`);

  console.log('\n=== MAINNET DEPLOYMENT SUMMARY ===');
  console.log(`WASM hash uploaded — CustomAccount: ${customAccountWasmHash}`);
  console.log('Contract IDs deployed:');
  console.log(`  DelegationManager: ${delegationManagerId}`);
  console.log(`  Policies:          ${policyEngineId}`);
  console.log(`  CustomAccount:     ${customAccountId}`);
  console.log(`  Registry:          ${registryId}`);
  console.log(`Config written to: ${CONFIG_FILE}`);
  console.log('===================================\n');
}

main().catch((error) => {
  console.error('Mainnet deployment failed:', error);
  process.exit(1);
});
