import { Keypair } from '@stellar/stellar-sdk';
import { KairosClient } from '../src';

async function main() {
  const client = new KairosClient({
    network: 'testnet',
    contracts: {
      delegationManager: 'CDWMR4I37T72D57P63OHEUXWUNEXN276UIP66GXZEXL4R6XUR3JWR4IP',
      policyEngine: 'CCPENGINE4I37T72D57P63OHEUXWUNEXN276UIP66GXZEXL4R6XUR3JWR4IP',
    },
  });

  const delegatorSigner = Keypair.random();
  const delegateAddress = Keypair.random().publicKey();

  // Create a delegation
  const delegation = await client.delegation.create({
    delegate: delegateAddress,
    delegator: delegatorSigner.publicKey(),
    signer: delegatorSigner,
  });

  const hash = client.delegation.getHash(delegation);
  console.log(`Delegation Hash: ${hash}`);

  // Revoke (disable) delegation on-chain
  console.log(`Submitting revocation on-chain...`);
  try {
    const res = await client.delegation.revoke(delegation, delegatorSigner);
    console.log(`Delegation revocation submitted! Result status: ${res.status}`);
    
    // Query disabled status
    const status = await client.delegation.get(hash);
    console.log(`Delegation disabled status: ${status.disabled}`);
  } catch (error: any) {
    console.error(`Revocation failed: ${error.message}`);
  }
}

if (require.main === module) {
  main();
}
