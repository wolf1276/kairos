#!/usr/bin/env node
import { getAgentId } from '../config.js';
import { listAgentIds, loadOrCreateAgentSigner } from '../keystore.js';

const args = process.argv.slice(2);

if (args.includes('--list')) {
  const agents = listAgentIds();
  if (agents.length === 0) {
    console.log('No agent identities found yet. Run keygen (optionally with KAIROS_AGENT_ID set) to create one.');
  } else {
    for (const { agentId, turnkeyPrivateKeyId } of agents) {
      console.log(`${agentId}\t${turnkeyPrivateKeyId}`);
    }
  }
  process.exit(0);
}

// Accept the agent id as a positional arg too, so `keygen my-agent` works without exporting
// KAIROS_AGENT_ID first. Provisions a new Turnkey Ed25519 key on first run for this id.
const agentId = args[0] || getAgentId();
const signer = await loadOrCreateAgentSigner(agentId);

// Only the public key (and Turnkey's opaque privateKeyId) are printed — paste the public
// key into the dashboard's "Agent public key" field when creating a delegation for this
// specific agent. The private key material never leaves Turnkey's MPC cluster.
console.log(`${agentId}\t${signer.publicKey()}\t(turnkey key: ${signer.id})`);
