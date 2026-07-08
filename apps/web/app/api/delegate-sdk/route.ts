import { NextResponse } from 'next/server';
import { Asset } from '@stellar/stellar-sdk';
import type { Caveat, Delegation } from '@wolf1276/kairos-sdk';
import { ROOT_AUTHORITY } from '@wolf1276/kairos-sdk';
import { getContractConfig, getKairosClient, getFunderKeypair } from '../../lib/sdk';
import { lookupRegistry } from '../../lib/sdk/registry';

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


export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { action } = body;

    if (!action) {
      return NextResponse.json({ error: 'action is required' }, { status: 400 });
    }

    const client = getKairosClient();
    const funder = getFunderKeypair();

    switch (action) {
      case 'PREPARE_WALLET_DEPLOY': {
        const ownerAddress: string = body.owner;
        if (!ownerAddress) {
          return NextResponse.json({ error: 'owner address is required' }, { status: 400 });
        }

        // Hard invariant: never deploy a second smart wallet for an owner that already has
        // one on-chain. The client's local/DB view can be stale or empty (cache cleared,
        // DB row lost on a redeploy — see useSmartWallets.ts) even though the registry still
        // has the mapping, so this is checked here against the registry directly rather than
        // trusted from the caller.
        const existing = await lookupRegistry(ownerAddress);
        if (existing) {
          return NextResponse.json({ success: true, alreadyExists: true, smartWalletAddress: existing });
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

        // Caveats reference policy storage via the `0xFE` marker (policy_id = array index)
        // instead of embedding terms inline — this is what lets a policy's limits/assets/
        // expiry be edited later via SET_POLICY/SEED_POLICIES without touching this
        // delegation's hash or signature. `pendingPolicies` must be seeded on-chain via
        // PREPARE_SEED_POLICIES/SUBMIT_SEED_POLICIES right after SUBMIT_DELEGATION +
        // PREPARE_REGISTER_DELEGATION, or the caveats resolve to empty terms.
        const indexed = (policies as Array<Parameters<typeof client.policy.create>[0]>)?.map((p, i) =>
          client.policy.createIndexed(BigInt(i), p)
        ) ?? [];
        const caveats: Caveat[] = indexed.map((x) => x.caveat);
        const pendingPolicies = indexed.map((x, i) => ({ policyId: i.toString(), terms: Array.from(x.terms) }));

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
          pendingPolicies,
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

      // Records this delegation as the active one for this (delegator, delegate) pair
      // (enforced on-chain via the WalletDelegation map — rejects if one is already active
      // for the same pair; other delegates funded by the same wallet are unaffected). Called
      // once right after SUBMIT_DELEGATION, before the delegation can be looked up via
      // GET_WALLET_DELEGATION.
      case 'PREPARE_REGISTER_DELEGATION': {
        const { delegation } = body;
        if (!delegation) {
          return NextResponse.json({ error: 'delegation struct is required' }, { status: 400 });
        }
        await client.ensureFundedTestnetAccount(funder.publicKey());
        const prepared = await client.delegation.prepareSponsoredRegister(deserializeDelegation(delegation), funder.publicKey());
        return NextResponse.json({ success: true, ...prepared });
      }

      case 'SUBMIT_REGISTER_DELEGATION': {
        const { delegation, signedEntryXdr } = body;
        if (!delegation || !signedEntryXdr) {
          return NextResponse.json({ error: 'delegation and signedEntryXdr are required' }, { status: 400 });
        }
        const result = await client.delegation.submitSponsoredRegister(deserializeDelegation(delegation), funder, signedEntryXdr);
        return NextResponse.json({ success: true, txHash: result.hash });
      }

      case 'GET_WALLET_DELEGATION': {
        const { delegator, delegate } = body;
        if (!delegator || !delegate) {
          return NextResponse.json({ error: 'delegator and delegate addresses are required' }, { status: 400 });
        }
        const hash = await client.delegation.getWalletDelegation(delegator, delegate);
        return NextResponse.json({ success: true, hash });
      }

      case 'PREPARE_REVOKE_BY_WALLET': {
        const { delegator, delegate } = body;
        if (!delegator || !delegate) {
          return NextResponse.json({ error: 'delegator and delegate addresses are required' }, { status: 400 });
        }
        await client.ensureFundedTestnetAccount(funder.publicKey());
        const prepared = await client.delegation.prepareSponsoredRevokeByWallet(delegator, delegate, funder.publicKey());
        return NextResponse.json({ success: true, ...prepared });
      }

      case 'SUBMIT_REVOKE_BY_WALLET': {
        const { delegator, delegate, signedEntryXdr } = body;
        if (!delegator || !delegate || !signedEntryXdr) {
          return NextResponse.json({ error: 'delegator, delegate, and signedEntryXdr are required' }, { status: 400 });
        }
        const result = await client.delegation.submitSponsoredRevokeByWallet(delegator, delegate, funder, signedEntryXdr);
        return NextResponse.json({ success: true, txHash: result.hash });
      }

      // Updates a policy's terms in place for (delegator, policyId) — no new delegation minted,
      // the delegation's hash/signature are untouched. `terms` is the raw policy-encoding bytes
      // (same format `client.policy.create` produces), sent as a plain number array over JSON.
      // `policy` is a structured PolicyCreateParams object (same shape PREPARE_DELEGATION's
      // `policies` array takes) — the server encodes it into terms bytes, same as it does
      // for a brand-new delegation's caveats, so the client never has to know the wire format.
      case 'PREPARE_SET_POLICY': {
        const { delegator, policyId, policy } = body;
        if (!delegator || policyId === undefined || !policy) {
          return NextResponse.json({ error: 'delegator, policyId, and policy are required' }, { status: 400 });
        }
        await client.ensureFundedTestnetAccount(funder.publicKey());
        const caveat = await client.policy.create(policy as Parameters<typeof client.policy.create>[0]);
        const prepared = await client.delegation.prepareSponsoredSetPolicy(
          delegator,
          BigInt(policyId),
          caveat.terms,
          funder.publicKey()
        );
        return NextResponse.json({ success: true, ...prepared });
      }

      case 'SUBMIT_SET_POLICY': {
        const { delegator, policyId, policy, signedEntryXdr } = body;
        if (!delegator || policyId === undefined || !policy || !signedEntryXdr) {
          return NextResponse.json(
            { error: 'delegator, policyId, policy, and signedEntryXdr are required' },
            { status: 400 }
          );
        }
        const caveat = await client.policy.create(policy as Parameters<typeof client.policy.create>[0]);
        const result = await client.delegation.submitSponsoredSetPolicy(
          delegator,
          BigInt(policyId),
          caveat.terms,
          funder,
          signedEntryXdr
        );
        return NextResponse.json({ success: true, txHash: result.hash });
      }

      // Seeds/updates several (policyId, terms) pairs in one signed call — used right after
      // registering a delegation whose caveats reference these ids (see PREPARE_DELEGATION's
      // `pendingPolicies`), and for the wizard's "update policy" path when multiple caveats
      // change together.
      case 'PREPARE_SEED_POLICIES': {
        const { delegator, policies: pendingPolicies } = body;
        if (!delegator || !Array.isArray(pendingPolicies) || pendingPolicies.length === 0) {
          return NextResponse.json({ error: 'delegator and a non-empty policies array are required' }, { status: 400 });
        }
        await client.ensureFundedTestnetAccount(funder.publicKey());
        const policyIds = pendingPolicies.map((p: { policyId: string }) => BigInt(p.policyId));
        const termsList = pendingPolicies.map((p: { terms: number[] }) => new Uint8Array(p.terms));
        const prepared = await client.delegation.prepareSponsoredSetPolicies(delegator, policyIds, termsList, funder.publicKey());
        return NextResponse.json({ success: true, ...prepared });
      }

      case 'SUBMIT_SEED_POLICIES': {
        const { delegator, policies: pendingPolicies, signedEntryXdr } = body;
        if (!delegator || !Array.isArray(pendingPolicies) || pendingPolicies.length === 0 || !signedEntryXdr) {
          return NextResponse.json(
            { error: 'delegator, a non-empty policies array, and signedEntryXdr are required' },
            { status: 400 }
          );
        }
        const policyIds = pendingPolicies.map((p: { policyId: string }) => BigInt(p.policyId));
        const termsList = pendingPolicies.map((p: { terms: number[] }) => new Uint8Array(p.terms));
        const result = await client.delegation.submitSponsoredSetPolicies(delegator, policyIds, termsList, funder, signedEntryXdr);
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
