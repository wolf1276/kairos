import { KairosClient } from '../src';

async function main() {
  const client = new KairosClient({
    network: 'testnet',
    contracts: {
      delegationManager: 'CDWMR4I37T72D57P63OHEUXWUNEXN276UIP66GXZEXL4R6XUR3JWR4IP',
      policyEngine: 'CCPENGINE4I37T72D57P63OHEUXWUNEXN276UIP66GXZEXL4R6XUR3JWR4IP',
    },
  });

  console.log('Starting Kairos real-time event listener...');

  // Subscribe to delegation-manager events
  client.events.subscribe(
    'kairos-dashboard',
    (event) => {
      console.log(`New Kairos Event Received [${event.type}]:`);
      console.log(JSON.stringify(event.data, null, 2));
    },
    { pollIntervalMs: 3000 }
  );

  console.log('Listening... Press Ctrl+C to stop.');
  
  // Keep process alive for 30 seconds for demonstration
  await new Promise((resolve) => setTimeout(resolve, 30000));
  
  // Unsubscribe and exit
  console.log('Stopping event listener.');
  client.events.unsubscribe('kairos-dashboard');
}

if (require.main === module) {
  main();
}
