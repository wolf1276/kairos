import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createTurnkeyClient, loadTurnkeyCredentials, TurnkeySigner, type TurnkeyCredentials } from '@wolf1276/kairos-turnkey-signer';

interface AgentKeyRecord {
  agentId: string;
  turnkeyPrivateKeyId: string;
}

const AGENT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function assertValidAgentId(agentId: string): void {
  if (!AGENT_ID_PATTERN.test(agentId)) {
    throw new Error(
      `Invalid KAIROS_AGENT_ID "${agentId}": only letters, digits, "-", and "_" are allowed.`
    );
  }
}

function registryDir(): string {
  return process.env.KAIROS_AGENT_KEYSTORE_DIR || path.join(os.homedir(), '.kairos', 'agents');
}

function registryPathFor(agentId: string): string {
  return path.join(registryDir(), `${agentId}.json`);
}

let cachedCreds: TurnkeyCredentials | null = null;
let cachedClient: ReturnType<typeof createTurnkeyClient> | null = null;

function getTurnkeyContext(): { client: ReturnType<typeof createTurnkeyClient>; organizationId: string } {
  if (!cachedCreds) cachedCreds = loadTurnkeyCredentials();
  if (!cachedClient) cachedClient = createTurnkeyClient(cachedCreds);
  return { client: cachedClient, organizationId: cachedCreds.organizationId };
}

/**
 * Resolves (or provisions) the MPC-backed signer for one agent identity. Every `agentId`
 * maps to its own Turnkey `privateKeyId` — the private key material is generated and held
 * as secret shares across Turnkey's signing cluster and is never assembled in this process.
 * The local registry file under `KAIROS_AGENT_KEYSTORE_DIR` only records that pointer
 * (agentId -> privateKeyId); it holds no secret and is safe to lose (the key itself lives in
 * Turnkey — losing the file just means re-fetching the privateKeyId from your Turnkey org).
 */
export async function loadOrCreateAgentSigner(agentId: string): Promise<TurnkeySigner> {
  assertValidAgentId(agentId);
  const { client, organizationId } = getTurnkeyContext();

  const registryPath = registryPathFor(agentId);
  if (fs.existsSync(registryPath)) {
    const raw = fs.readFileSync(registryPath, 'utf8');
    const parsed = JSON.parse(raw) as AgentKeyRecord;
    return TurnkeySigner.forExistingKey(client, organizationId, parsed.turnkeyPrivateKeyId);
  }

  // Pre-Turnkey installs kept a raw local secret at this path — that key was never provisioned
  // in Turnkey and can't be silently migrated (Turnkey key import requires a separate,
  // deliberately-run encrypted-bundle flow). Fail loudly instead of quietly minting a new,
  // undelegated identity that looks like it should work.
  const legacyPath = path.join(os.homedir(), '.kairos', 'agent-session.json');
  if (agentId === 'default' && fs.existsSync(legacyPath) && !process.env.KAIROS_AGENT_SECRET_KEY) {
    throw new Error(
      `Found a pre-Turnkey local key at ${legacyPath}, but agent keys are now MPC-backed via ` +
        'Turnkey and local secret files are no longer read automatically. Run the keygen CLI ' +
        'to provision a new Turnkey-backed identity for this agentId, then grant it a fresh ' +
        'delegation from the dashboard (the old local key\'s delegation cannot be reused).'
    );
  }

  const signer = await TurnkeySigner.forNewAgent(client, organizationId, agentId);
  fs.mkdirSync(registryDir(), { recursive: true });
  const record: AgentKeyRecord = { agentId, turnkeyPrivateKeyId: signer.id };
  fs.writeFileSync(registryPath, JSON.stringify(record, null, 2));
  return signer;
}

/** Lists every agent identity that has a Turnkey key pointer registered on this machine. */
export function listAgentIds(): { agentId: string; turnkeyPrivateKeyId: string }[] {
  const dir = registryDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as AgentKeyRecord);
}
