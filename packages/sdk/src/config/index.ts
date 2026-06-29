import { DEFAULT_TESTNET_PASSPHRASE, DEFAULT_TESTNET_RPC } from '../constants';
import { NetworkConfig } from '../types';

export const NETWORKS: Record<'testnet' | 'mainnet', NetworkConfig> = {
  testnet: {
    rpcUrl: DEFAULT_TESTNET_RPC,
    networkPassphrase: DEFAULT_TESTNET_PASSPHRASE,
  },
  mainnet: {
    rpcUrl: 'https://soroban-rpc.stellar.org', // standard mainnet RPC
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
  },
};
