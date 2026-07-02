import { NextResponse } from 'next/server';
import { Asset, Keypair } from '@stellar/stellar-sdk';
import KairosClient from '@wolf1276/kairos-sdk';
import { getContractConfig } from '../../lib/sdk';

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

      case 'CREATE_DELEGATION': {
        const { delegate, policies } = body;
        if (!delegate) {
          return NextResponse.json({ error: 'delegate address is required' }, { status: 400 });
        }

        // The delegation signature is verified on-chain against the delegator's own
        // ed25519 key (see DelegationManager.redeem_delegations). The only private key
        // this server holds is FUNDER_SECRET_KEY, so the funder must be the delegator —
        // signing on behalf of any other address would produce a signature that fails
        // is_valid_signature/ed25519_verify at redemption time.
        const delegator = funder.publicKey();

        const caveats = policies
          ? await Promise.all(
              (policies as Array<Parameters<typeof client.policy.create>[0]>).map((p) => client.policy.create(p))
            )
          : [];

        const delegation = await client.delegation.create({
          delegate,
          delegator,
          caveats,
          signer: funder,
        });

        const hashStr = client.delegation.getHash(delegation);
        return NextResponse.json({ success: true, hash: hashStr, delegator, delegation });
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
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
