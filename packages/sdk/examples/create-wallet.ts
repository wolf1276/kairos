import { Keypair } from '@stellar/stellar-sdk';
import { KairosClient } from '../src';

async function main() {
  // Initialize SDK Client
  const client = new KairosClient({
    network: 'testnet',
    contracts: {
      delegationManager: 'CDWMR4I37T72D57P63OHEUXWUNEXN276UIP66GXZEXL4R6XUR3JWR4IP',
      policyEngine: 'CCPENGINE4I37T72D57P63OHEUXWUNEXN276UIP66GXZEXL4R6XUR3JWR4IP',
    },
  });

  // Owner Keypair
  const owner = Keypair.random();
  console.log(`Creating smart wallet for owner: ${owner.publicKey()}`);

  // WASM hash of uploaded CustomAccount contract
  const wasmHash = '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff';

  try {
    const wallet = await client.wallet.create(owner, wasmHash);
    console.log(`Smart Wallet deployed & initialized successfully!`);
    console.log(`Smart Wallet Address: ${wallet.address}`);
  } catch (error: any) {
    console.error(`Failed to deploy wallet: ${error.message}`);
  }
}

if (require.main === module) {
  main();
}
