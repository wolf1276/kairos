import { KairosClient } from '@wolf1276/kairos-sdk';
import { getContractConfig, getNetwork } from './config.js';

let client: KairosClient | null = null;

export function getKairosClient(): KairosClient {
  if (!client) {
    const config = getContractConfig();
    client = new KairosClient({
      network: getNetwork(),
      contracts: {
        delegationManager: config.delegationManager,
        policyEngine: config.policyEngine,
        smartWallet: config.customAccount,
      },
    });
  }
  return client;
}
