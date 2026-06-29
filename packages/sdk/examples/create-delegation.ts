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

  console.log(`Creating delegation from ${delegatorSigner.publicKey()} to ${delegateAddress}`);

  // Create active policies/caveats
  const spendLimitPolicy = await client.policy.create({
    type: 'spend-limit',
    token: 'CCUSDC4I37T72D57P63OHEUXWUNEXN276UIP66GXZEXL4R6XUR3JWR4IP',
    spendLimit: 1000n * 10000000n,
    period: 86400n,
  });

  // Construct and sign delegation
  const delegation = await client.delegation.create({
    delegate: delegateAddress,
    delegator: delegatorSigner.publicKey(),
    caveats: [spendLimitPolicy],
    signer: delegatorSigner,
  });

  console.log('Delegation structure created successfully:');
  console.log(JSON.stringify(delegation, (key, value) => 
    typeof value === 'bigint' ? value.toString() : value, 2
  ));
  console.log(`Delegation Hash: ${client.delegation.getHash(delegation)}`);
}

if (require.main === module) {
  main();
}
