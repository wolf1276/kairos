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

    // 4. Deploy delegation-manager
    console.log('Deploying DelegationManager...');
    const managerStdout = runCommand(
      `stellar contract deploy --wasm target/wasm32v1-none/release/delegation_manager.wasm --source ${DEPLOYER_ALIAS} --network ${NETWORK}`,
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

    // 6. Deploy a custom account instance for verification/general use
    console.log('Deploying CustomAccount Instance...');
    const accountStdout = runCommand(
      `stellar contract deploy --wasm target/wasm32v1-none/release/custom_account.wasm --source ${DEPLOYER_ALIAS} --network ${NETWORK}`,
      'contracts/soroban'
    );
    const accountMatch = accountStdout.match(/(C[A-Z0-9]{55})/);
    if (!accountMatch) {
      throw new Error(`Failed to parse CustomAccount contract ID: ${accountStdout}`);
    }
    const customAccountId = accountMatch[1];
    console.log(`CustomAccount Contract ID: ${customAccountId}`);

    // 7. Initialize DelegationManager
    console.log('Initializing DelegationManager...');
    runCommand(
      `stellar contract invoke --id ${delegationManagerId} --source ${DEPLOYER_ALIAS} --network ${NETWORK} -- init --owner ${deployerAddress}`
    );

    // 8. Initialize CustomAccount
    console.log('Initializing CustomAccount...');
    runCommand(
      `stellar contract invoke --id ${customAccountId} --source ${DEPLOYER_ALIAS} --network ${NETWORK} -- init --owner ${deployerAddress} --delegation_manager ${delegationManagerId}`
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
    };

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    console.log(`Successfully wrote contract configuration to ${CONFIG_FILE}`);

  } catch (error) {
    console.error('Deployment failed:', error);
    process.exit(1);
  }
}

main();
