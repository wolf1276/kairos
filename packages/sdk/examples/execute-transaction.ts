import { Address, Keypair, xdr } from '@stellar/stellar-sdk';
import { KairosClient } from '../src';

async function main() {
  const client = new KairosClient({
    network: 'testnet',
    contracts: {
      delegationManager: 'CDWMR4I37T72D57P63OHEUXWUNEXN276UIP66GXZEXL4R6XUR3JWR4IP',
      policyEngine: 'CCPENGINE4I37T72D57P63OHEUXWUNEXN276UIP66GXZEXL4R6XUR3JWR4IP',
    },
  });

  const delegateSigner = Keypair.random();
  const delegatorSigner = Keypair.random();

  // Create a delegation
  const delegation = await client.delegation.create({
    delegate: delegateSigner.publicKey(),
    delegator: delegatorSigner.publicKey(),
    signer: delegatorSigner,
  });

  // Setup target execution: Transferring 10 USDC on Stellar Asset Contract (SAC)
  const tokenAddress = 'CCUSDC4I37T72D57P63OHEUXWUNEXN276UIP66GXZEXL4R6XUR3JWR4IP';
  const recipient = Keypair.random().publicKey();
  
  const execution = {
    target: tokenAddress,
    function: 'transfer',
    args: [
      Address.fromString(delegatorSigner.publicKey()).toScVal(), // from
      Address.fromString(recipient).toScVal(),                  // to
      xdr.ScVal.scvI128(new xdr.Int128Parts({
        hi: 0n,
        lo: 10n * 10000000n, // 10 USDC (7 decimals)
      })),
    ],
  };

  // Submit delegation execution transaction using delegate signature
  console.log(`Executing target contract call via delegation manager...`);
  try {
    const result = await client.execution.execute({
      redeemer: delegateSigner,
      delegationChains: [delegation],
      executions: execution,
    });
    console.log(`Transaction executed successfully! Result status: ${result.status}`);
  } catch (error: any) {
    console.error(`Execution failed: ${error.message}`);
  }
}

if (require.main === module) {
  main();
}
