import { KairosClient } from '@wolf1276/kairos-sdk';
import { getContractConfig, getNetwork } from './config.js';

let sdkClient: KairosClient | null = null;

export function getKairosClient(): KairosClient {
  if (!sdkClient) {
    const config = getContractConfig();
    sdkClient = new KairosClient({
      network: getNetwork(),
      contracts: {
        delegationManager: config.delegationManager,
        policyEngine: config.policyEngine,
        smartWallet: config.customAccount,
      },
    });
  }
  return sdkClient;
}
