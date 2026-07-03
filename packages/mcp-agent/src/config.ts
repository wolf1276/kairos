import * as os from 'os';
import * as path from 'path';

function readRequiredEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing env var: ${key}. Set it before starting kairos-mcp-agent.`);
  return val;
}

export function getContractConfig() {
  return {
    delegationManager: readRequiredEnv('DELEGATION_MANAGER_CONTRACT_ID'),
    policyEngine: readRequiredEnv('POLICY_CONTRACT_ID'),
    customAccount: process.env.CUSTOM_ACCOUNT_CONTRACT_ID,
  };
}

export function getNetwork(): 'testnet' | 'mainnet' {
  const network = process.env.STELLAR_NETWORK || 'testnet';
  if (network !== 'testnet' && network !== 'mainnet') {
    throw new Error(`Invalid STELLAR_NETWORK: ${network}. Expected "testnet" or "mainnet".`);
  }
  return network;
}

export function getDelegationsDir(): string {
  return process.env.KAIROS_DELEGATIONS_DIR || path.join(os.homedir(), '.kairos', 'delegations');
}

/**
 * Identifies which private key this process should use (see keystore.ts). Each agent
 * instance — e.g. each separate MCP client config — should set a distinct `KAIROS_AGENT_ID`
 * so they never share a key; processes that don't set it fall back to a single "default"
 * identity, preserving pre-multi-agent behavior for single-agent setups.
 */
export function getAgentId(): string {
  return process.env.KAIROS_AGENT_ID || 'default';
}
