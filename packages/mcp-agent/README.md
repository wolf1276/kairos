# @wolf1276/kairos-mcp-agent

An MCP server that lets an AI agent (e.g. Claude via MCP) spend from a Kairos delegation
wallet, using its own scoped ephemeral session key — never the user's real wallet key.

## How it works

1. The agent generates (and locally keeps) its own ephemeral Stellar keypair.
2. The user creates a Kairos delegation in the dashboard with `delegate` = that agent's
   public key, and caveats (spend-limit / target-whitelist / time-restriction) that bound
   what it's allowed to do.
3. The signed delegation is exported and saved where the agent runs.
4. The agent's MCP tools (`spend_funds`, `execute_action`) redeem that delegation directly
   on-chain, using only its own ephemeral key — the delegation's caveats are enforced by the
   Kairos `policies` contract regardless of what the agent tries to do.

## Setup

```bash
pnpm --filter @wolf1276/kairos-mcp-agent build

# Prints the agent's public key (generates + persists an ephemeral keypair on first run,
# at ~/.kairos/agent-session.json unless KAIROS_AGENT_KEYSTORE_PATH is set).
node dist/cli/keygen.js
```

Paste that public key into the Kairos dashboard's delegation form (Delegate → "AI agent"),
attach the policies you want to grant, create the delegation, then use the "Export for
agent" panel to copy its JSON and save it as:

```
~/.kairos/delegations/<hash>.json
```

(or wherever `KAIROS_DELEGATIONS_DIR` points).

## Running the server

Requires these env vars:

- `STELLAR_NETWORK` (`testnet` or `mainnet`, default `testnet`)
- `DELEGATION_MANAGER_CONTRACT_ID`
- `POLICY_CONTRACT_ID`
- `CUSTOM_ACCOUNT_CONTRACT_ID` (optional)
- `KAIROS_DELEGATIONS_DIR` (optional, default `~/.kairos/delegations`)
- `KAIROS_AGENT_KEYSTORE_PATH` (optional, default `~/.kairos/agent-session.json`)
- `KAIROS_AGENT_SECRET_KEY` (optional escape hatch — use a pre-existing secret key instead
  of the local keystore file)

Register it as a stdio MCP server, e.g. in Claude Code's `.mcp.json`:

```json
{
  "mcpServers": {
    "kairos-agent": {
      "command": "node",
      "args": ["/absolute/path/to/packages/mcp-agent/dist/index.js"],
      "env": {
        "STELLAR_NETWORK": "testnet",
        "DELEGATION_MANAGER_CONTRACT_ID": "...",
        "POLICY_CONTRACT_ID": "...",
        "CUSTOM_ACCOUNT_CONTRACT_ID": "..."
      }
    }
  }
}
```

## Tools

- `get_agent_pubkey` — returns this agent's public key (same as the keygen CLI).
- `list_my_delegations` — lists delegations granted to this agent and their decoded caveats.
- `spend_funds({ token, to, amount })` — SEP-41 transfer from the delegation wallet, gated by
  a spend-limit caveat for `token`.
- `execute_action({ target, function, args })` — generic contract call, gated by a
  target-whitelist caveat for `target`.

## Verification

```bash
export FUNDER_SECRET_KEY=SC...
pnpm --filter @wolf1276/kairos-mcp-agent smoke-test
```

Deploys a smart wallet, funds it, creates a spend-limit delegation for a fresh ephemeral
agent key, and asserts a within-limit transfer succeeds while an over-limit one is rejected.
