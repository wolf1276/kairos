#!/usr/bin/env node
import type { Caveat } from '@wolf1276/kairos-sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getAgentId } from './config.js';
import { getKairosClient } from './client.js';
import { loadEligibleDelegations, type EligibleDelegation } from './delegations.js';
import { loadOrCreateAgentSigner } from './keystore.js';
import { executeActionHandler, executeActionSchema } from './tools/executeAction.js';
import { spendFundsHandler, spendFundsSchema } from './tools/spendFunds.js';

// Each MCP agent process is one identity, keyed by KAIROS_AGENT_ID (defaults to "default"
// for single-agent setups). Run multiple agents by starting this server multiple times with
// different KAIROS_AGENT_ID values — each gets its own MPC-backed (Turnkey) private key
// (keystore.ts) and must be granted its own delegation by the delegator. The private key
// material never exists in this process; every `sign()` is a round-trip to Turnkey.
const agentId = getAgentId();
const sessionSigner = await loadOrCreateAgentSigner(agentId);

const server = new McpServer({
  name: `kairos-agent:${agentId}`,
  version: '0.1.0',
});

server.tool(
  'get_agent_pubkey',
  'Returns this agent\'s id and Stellar public key. A delegator must create a Kairos ' +
    'delegation with this address as the `delegate` (with spend-limit/target-whitelist/' +
    'time-restriction caveats) before this agent can spend anything. Each agent identity ' +
    '(KAIROS_AGENT_ID) has its own MPC-backed private key and must be delegated to separately.',
  {},
  async () => ({
    content: [{ type: 'text' as const, text: JSON.stringify({ agentId, publicKey: sessionSigner.publicKey() }) }],
  })
);

server.tool(
  'list_my_delegations',
  'Lists the delegations currently granted to this agent (exported to the local ' +
    'delegations directory and not disabled on-chain), including their caveats.',
  {},
  async () => {
    const client = getKairosClient();
    const eligible = await loadEligibleDelegations(client, sessionSigner.publicKey());
    const described = eligible.map(({ hash, delegation }: EligibleDelegation) => ({
      hash,
      delegator: delegation.delegator,
      caveats: delegation.caveats.map((c: Caveat) => {
        try {
          return client.policy.decode(c);
        } catch {
          return { type: 'unknown' };
        }
      }),
    }));
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(described, null, 2) }],
    };
  }
);

server.tool(
  'spend_funds',
  'Transfers a SEP-41 token amount from the delegation wallet to a destination address, ' +
    'gated by this agent\'s spend-limit caveat for that token.',
  spendFundsSchema,
  async (input) => spendFundsHandler(input, sessionSigner)
);

server.tool(
  'execute_action',
  'Invokes an arbitrary contract function on behalf of the delegation wallet, gated by ' +
    'this agent\'s target-whitelist caveat. Prefer spend_funds for plain token transfers.',
  executeActionSchema,
  async (input) => executeActionHandler(input, sessionSigner)
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('kairos-mcp-agent failed to start:', error);
  process.exit(1);
});
