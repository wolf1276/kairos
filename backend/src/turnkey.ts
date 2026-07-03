import { createTurnkeyClient, loadTurnkeyCredentials, type TurnkeyCredentials } from '@wolf1276/kairos-turnkey-signer';

let client: ReturnType<typeof createTurnkeyClient> | null = null;
let creds: TurnkeyCredentials | null = null;

function getCreds(): TurnkeyCredentials {
  if (!creds) creds = loadTurnkeyCredentials();
  return creds;
}

/** Shared Turnkey API client — every agent's key lives under one Turnkey organization,
 * distinguished from each other by their own `privateKeyId`, not by separate credentials. */
export function getTurnkeyClient() {
  if (!client) client = createTurnkeyClient(getCreds());
  return client;
}

export function getTurnkeyOrganizationId(): string {
  return getCreds().organizationId;
}
