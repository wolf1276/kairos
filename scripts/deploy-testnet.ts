import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const DEPLOYER_ALIAS = 'deployer';
const NETWORK = 'testnet';
const CONFIG_DIR = path.join(__dirname, '../configs');
const CONFIG_FILE = path.join(CONFIG_DIR, 'contracts.testnet.json');

function runCommand(cmd: string, cwd = '.'): string {
  console.log(`Running: ${cmd} in ${cwd}`);
  const stdout = execSync(cmd, { encoding: 'utf8', cwd });
  console.log(stdout);
  return stdout.trim();
}

async function main() {
  try {
    // 1. Build the contracts (runs in contracts/soroban)
    console.log('Building Soroban contracts...');
    runCommand('stellar contract build', 'contracts/soroban');

    // 2. Get deployer address
    console.log('Retrieving deployer address...');
    const deployerAddress = runCommand(`stellar keys address ${DEPLOYER_ALIAS}`);

    // 3. Upload custom account Wasm and get hash
    console.log('Uploading CustomAccount Wasm...');
    const uploadStdout = runCommand(
      `stellar contract upload --wasm target/wasm32v1-none/release/custom_account.wasm --source ${DEPLOYER_ALIAS} --network ${NETWORK}`,
      'contracts/soroban'
    );
    // Wasm hash is a 64-character hex string
    const wasmHashMatch = uploadStdout.match(/([a-f0-9]{64})/i);
    if (!wasmHashMatch) {
      throw new Error(`Failed to parse Wasm hash from upload output: ${uploadStdout}`);
    }
    const customAccountWasmHash = wasmHashMatch[1];
    console.log(`CustomAccount Wasm Hash: ${customAccountWasmHash}`);

    // 4. Deploy delegation-manager. `--owner` is a constructor argument here, not a
    // separate `init` call: the contract's `__constructor` runs atomically inside this
    // same CreateContractV2 deploy operation (see docs/security/MAINNET_AUDIT.md, P0-1),
    // so there is no on-chain window where the manager exists uninitialized.
    console.log('Deploying DelegationManager...');
    const managerStdout = runCommand(
      `stellar contract deploy --wasm target/wasm32v1-none/release/delegation_manager.wasm --source ${DEPLOYER_ALIAS} --network ${NETWORK} -- --owner ${deployerAddress}`,
      'contracts/soroban'
    );
    const managerMatch = managerStdout.match(/(C[A-Z0-9]{55})/);
    if (!managerMatch) {
      throw new Error(`Failed to parse DelegationManager contract ID: ${managerStdout}`);
    }
    const delegationManagerId = managerMatch[1];
    console.log(`DelegationManager Contract ID: ${delegationManagerId}`);

    // 5. Deploy policies
    console.log('Deploying Policies...');
    const policiesStdout = runCommand(
      `stellar contract deploy --wasm target/wasm32v1-none/release/policies.wasm --source ${DEPLOYER_ALIAS} --network ${NETWORK}`,
      'contracts/soroban'
    );
    const policiesMatch = policiesStdout.match(/(C[A-Z0-9]{55})/);
    if (!policiesMatch) {
      throw new Error(`Failed to parse Policies contract ID: ${policiesStdout}`);
    }
    const policyEngineId = policiesMatch[1];
    console.log(`Policies Contract ID: ${policyEngineId}`);

    // 6. Deploy a custom account instance for verification/general use. Same atomic
    // deploy+constructor pattern as DelegationManager above — `--owner` and
    // `--delegation_manager` are constructor args, not a follow-up `init` transaction.
    console.log('Deploying CustomAccount Instance...');
    const accountStdout = runCommand(
      `stellar contract deploy --wasm target/wasm32v1-none/release/custom_account.wasm --source ${DEPLOYER_ALIAS} --network ${NETWORK} -- --owner ${deployerAddress} --delegation_manager ${delegationManagerId}`,
      'contracts/soroban'
    );
    const accountMatch = accountStdout.match(/(C[A-Z0-9]{55})/);
    if (!accountMatch) {
      throw new Error(`Failed to parse CustomAccount contract ID: ${accountStdout}`);
    }
    const customAccountId = accountMatch[1];
    console.log(`CustomAccount Contract ID: ${customAccountId}`);

    // 6b. Deploy Registry
    console.log('Deploying Registry...');
    const registryStdout = runCommand(
      `stellar contract deploy --wasm target/wasm32v1-none/release/registry.wasm --source ${DEPLOYER_ALIAS} --network ${NETWORK}`,
      'contracts/soroban'
    );
    const registryMatch = registryStdout.match(/(C[A-Z0-9]{55})/);
    if (!registryMatch) {
      throw new Error(`Failed to parse Registry contract ID: ${registryStdout}`);
    }
    const registryId = registryMatch[1];
    console.log(`Registry Contract ID: ${registryId}`);

    // DelegationManager and CustomAccount no longer have separate init steps — both were
    // constructed atomically at deploy time above (steps 4 and 6).

    // 8b. Initialize Registry
    console.log('Initializing Registry...');
    runCommand(
      `stellar contract invoke --id ${registryId} --source ${DEPLOYER_ALIAS} --network ${NETWORK} -- init --admin ${deployerAddress}`
    );

    // 9. Write IDs to config file
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

  } catch (error) {
    console.error('Deployment failed:', error);
    process.exit(1);
  }
}

main();
