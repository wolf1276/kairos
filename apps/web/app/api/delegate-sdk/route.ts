import { NextResponse } from 'next/server';
import { Asset, Keypair } from '@stellar/stellar-sdk';
import KairosClient from '@wolf1276/kairos-sdk';
import type { Caveat, Delegation } from '@wolf1276/kairos-sdk';
import { ROOT_AUTHORITY } from '@wolf1276/kairos-sdk';
import { getContractConfig } from '../../lib/sdk';

// `Delegation.salt`/`.nonce` are bigint and `Caveat.terms` is a Uint8Array — neither survives
// `JSON.stringify` (bigint throws, Uint8Array serializes as a plain object). Convert to
// JSON-safe primitives on the way out and back to the SDK's shape on the way in.
type JsonSafeDelegation = Omit<Delegation, 'salt' | 'nonce' | 'caveats'> & {
  salt: string;
  nonce: string;
  caveats: { enforcer: string; terms: number[] }[];
};

function serializeDelegation(d: Delegation): JsonSafeDelegation {
  return {
    ...d,
    salt: d.salt.toString(),
    nonce: d.nonce.toString(),
    caveats: d.caveats.map((c) => ({ enforcer: c.enforcer, terms: Array.from(c.terms) })),
  };
}

function deserializeDelegation(d: JsonSafeDelegation): Delegation {
  return {
    ...d,
    salt: BigInt(d.salt),
    nonce: BigInt(d.nonce),
    caveats: d.caveats.map((c) => ({ enforcer: c.enforcer, terms: new Uint8Array(c.terms) })),
  };
}

const FUNDER_SECRET = process.env.FUNDER_SECRET_KEY;
const NETWORK = 'testnet';

function getFunder(): Keypair {
  if (FUNDER_SECRET) {
    return Keypair.fromSecret(FUNDER_SECRET);
  }
  throw new Error('FUNDER_SECRET_KEY not configured');
}

let sdkClient: KairosClient | null = null;

function getClient(): KairosClient {
  if (!sdkClient) {
    const config = getContractConfig();
    sdkClient = new KairosClient({
      network: NETWORK,
      contracts: {
        delegationManager: config.delegationManager,
        policyEngine: config.policyEngine,
        smartWallet: config.customAccount,
      },
    });
  }
  return sdkClient;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { action } = body;

    if (!action) {
      return NextResponse.json({ error: 'action is required' }, { status: 400 });
    }

    const client = getClient();
    const funder = getFunder();

    switch (action) {
      case 'PREPARE_WALLET_DEPLOY': {
        const ownerAddress: string = body.owner;
        if (!ownerAddress) {
          return NextResponse.json({ error: 'owner address is required' }, { status: 400 });
        }

        // Fund (and wait for Soroban RPC to see) the funder account before deploying —
        // a fresh funder or one that hasn't propagated yet would otherwise fail deploy
        // with an opaque "account not found" error.
        await client.ensureFundedTestnetAccount(funder.publicKey());

        // The funder pays all fees, but Soroban still requires the owner address embedded
        // in the CreateContract preimage to separately authorize it. This returns the
        // unsigned authorization entry for the browser to sign with Freighter — see
        // SUBMIT_WALLET_DEPLOY below.
        const prepared = await client.wallet.prepareSponsoredDeploy(
          funder.publicKey(),
          ownerAddress,
          getContractConfig().customAccountWasmHash
        );

        return NextResponse.json({ success: true, ...prepared });
      }

      case 'SUBMIT_WALLET_DEPLOY': {
        const ownerAddress: string = body.owner;
        const { saltHex, signedEntryXdr } = body;
        if (!ownerAddress || !saltHex || !signedEntryXdr) {
          return NextResponse.json(
            { error: 'owner, saltHex, and signedEntryXdr are required' },
            { status: 400 }
          );
        }

        const wallet = await client.wallet.submitSponsoredDeploy(
          funder,
          ownerAddress,
          getContractConfig().customAccountWasmHash,
          saltHex,
          signedEntryXdr
        );

        return NextResponse.json({ success: true, smartWalletAddress: wallet.address, owner: ownerAddress });
      }

      case 'PREPARE_DELEGATION': {
        // The delegator MUST be a smart-wallet contract, not a plain account — `redeem_delegations`
        // always calls `execute_from_executor` on the root delegator, which only exists on the
        // CustomAccount contract. A delegation with an EOA delegator can never be redeemed
        // ("not a contract address"). The smart wallet's owner (the connected Freighter user)
        // must authorize it via SEP-53 message signing — see SUBMIT_DELEGATION below — since the
        // server only holds FUNDER_SECRET_KEY, which is not the wallet's owner.
        const { delegate, delegator, policies } = body;
        if (!delegate || !delegator) {
          return NextResponse.json({ error: 'delegate and delegator addresses are required' }, { status: 400 });
        }

        const caveats: Caveat[] = policies
          ? await Promise.all(
              (policies as Array<Parameters<typeof client.policy.create>[0]>).map((p) => client.policy.create(p))
            )
          : [];

        const nonce = await client.delegation.getNonce(delegator);
        const salt = BigInt(Math.floor(Math.random() * 1_000_000));
        const unsigned: Omit<Delegation, 'signature'> = {
          delegate,
          delegator,
          authority: ROOT_AUTHORITY,
          caveats,
          salt,
          nonce,
        };
        const hashHex = client.delegation.getHash({ ...unsigned, signature: '' } as Delegation);

        return NextResponse.json({
          success: true,
          hashHex,
          unsignedDelegation: serializeDelegation({ ...unsigned, signature: '' } as Delegation),
        });
      }

      case 'SUBMIT_DELEGATION': {
        const { unsignedDelegation, signatureHex } = body;
        if (!unsignedDelegation || !signatureHex) {
          return NextResponse.json(
            { error: 'unsignedDelegation and signatureHex are required' },
            { status: 400 }
          );
        }

        const delegation: Delegation = {
          ...deserializeDelegation(unsignedDelegation),
          signature: signatureHex,
        };
        const hashStr = client.delegation.getHash(delegation);

        return NextResponse.json({
          success: true,
          hash: hashStr,
          delegator: delegation.delegator,
          delegation: serializeDelegation(delegation),
        });
      }

      case 'LIST_DELEGATIONS': {
        const { delegator } = body;
        if (!delegator) {
          return NextResponse.json({ error: 'delegator address is required' }, { status: 400 });
        }
        const hashes = await client.delegation.list(delegator);
        const delegations = await Promise.all(
          hashes.map(async (hash: string) => {
            const status = await client.delegation.get(hash);
            return { hash, disabled: status.disabled, delegator };
          })
        );
        return NextResponse.json({ success: true, delegations });
      }

      case 'PREPARE_REVOKE_DELEGATION':
      case 'PREPARE_ENABLE_DELEGATION': {
        // Sponsored, same pattern as PREPARE_WALLET_DEPLOY: the funder pays fees, but
        // disable_delegation/enable_delegation calls delegation.delegator.require_auth() —
        // for a smart-wallet delegator that means a separately-signed authorization entry
        // from the wallet's owner, not just the funder's transaction signature.
        const { delegation } = body;
        if (!delegation) {
          return NextResponse.json({ error: 'delegation struct is required' }, { status: 400 });
        }
        await client.ensureFundedTestnetAccount(funder.publicKey());
        const prepared =
          action === 'PREPARE_REVOKE_DELEGATION'
            ? await client.delegation.prepareSponsoredDisable(deserializeDelegation(delegation), funder.publicKey())
            : await client.delegation.prepareSponsoredEnable(deserializeDelegation(delegation), funder.publicKey());
        return NextResponse.json({ success: true, ...prepared });
      }

      case 'SUBMIT_REVOKE_DELEGATION':
      case 'SUBMIT_ENABLE_DELEGATION': {
        const { delegation, signedEntryXdr } = body;
        if (!delegation || !signedEntryXdr) {
          return NextResponse.json(
            { error: 'delegation and signedEntryXdr are required' },
            { status: 400 }
          );
        }
        const result =
          action === 'SUBMIT_REVOKE_DELEGATION'
            ? await client.delegation.submitSponsoredDisable(deserializeDelegation(delegation), funder, signedEntryXdr)
            : await client.delegation.submitSponsoredEnable(deserializeDelegation(delegation), funder, signedEntryXdr);
        return NextResponse.json({ success: true, txHash: result.hash });
      }

      case 'DELEGATION_STATUS': {
        const { hash: delegationHash } = body;
        if (!delegationHash) {
          return NextResponse.json({ error: 'hash is required' }, { status: 400 });
        }
        const status = await client.delegation.get(delegationHash);
        return NextResponse.json({ success: true, ...status });
      }

      case 'EXECUTE': {
        const { delegation, redeemer, target, function: funcName, args } = body;
        if (!delegation || !redeemer || !target) {
          return NextResponse.json({ error: 'delegation, redeemer, and target are required' }, { status: 400 });
        }

        const result = await client.execution.execute({
          redeemer: funder,
          delegationChains: [delegation],
          executions: [{
            target: target,
            function: funcName || 'transfer',
            args: args || [],
          }],
        });

        return NextResponse.json({ success: true, txHash: result.hash });
      }

      case 'BALANCE': {
        const { address, token } = body;
        if (!address) {
          return NextResponse.json({ error: 'address is required' }, { status: 400 });
        }
        // Default to the native XLM Stellar Asset Contract — the CustomAccount contract ID
        // is a smart wallet's own identity, not a token, so it can't be a balance default.
        const tokenAddress = token || Asset.native().contractId(client.networkPassphrase);
        const balance = await client.wallet.balance(address, tokenAddress);
        return NextResponse.json({ success: true, balance: balance.toString() });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    // stellar-sdk's JSON-RPC client throws the raw `{ code, message, data }` error object
    // from the RPC response (see `postObject` in @stellar/stellar-sdk/lib/rpc/jsonrpc.js),
    // not an `Error` instance — String(plainObject) would otherwise collapse to
    // "[object Object]" and hide the actual RPC failure reason.
    const msg = extractErrorMessage(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const m = (error as { message: unknown }).message;
    if (typeof m === 'string') return m;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
