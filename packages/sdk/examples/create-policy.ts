import { KairosClient } from '../src';

async function main() {
  const client = new KairosClient({
    network: 'testnet',
    contracts: {
      delegationManager: 'CDWMR4I37T72D57P63OHEUXWUNEXN276UIP66GXZEXL4R6XUR3JWR4IP',
      policyEngine: 'CCPENGINE4I37T72D57P63OHEUXWUNEXN276UIP66GXZEXL4R6XUR3JWR4IP',
    },
  });

  console.log('Constructing Policy Caveats...');

  // 1. Create a Spend Limit policy for USDC token
  const spendLimitPolicy = await client.policy.create({
    type: 'spend-limit',
    token: 'CCUSDC4I37T72D57P63OHEUXWUNEXN276UIP66GXZEXL4R6XUR3JWR4IP',
    spendLimit: 1000n * 10000000n, // 1000 USDC with 7 decimal precision
    period: 86400n, // 24 hours in seconds
  });
  console.log('Spend Limit Caveat terms encoded:', Buffer.from(spendLimitPolicy.terms).toString('hex'));

  // 2. Create a Time Restriction policy (valid for next 24 hours)
  const now = BigInt(Math.floor(Date.now() / 1000));
  const oneDay = 86400n;
  const timeRestrictionPolicy = await client.policy.create({
    type: 'time-restriction',
    start: now,
    expiry: now + oneDay,
  });
  console.log('Time Restriction Caveat terms encoded:', Buffer.from(timeRestrictionPolicy.terms).toString('hex'));
}

if (require.main === module) {
  main();
}
