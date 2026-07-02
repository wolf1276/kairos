import { NextResponse } from 'next/server';
import { Keypair, Address, Operation, TransactionBuilder, xdr, hash, StrKey } from '@stellar/stellar-sdk';
import KairosClient from '@wolf1276/kairos-sdk';
import * as crypto from 'crypto';
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
      case 'DEPLOY_WALLET': {
        const ownerAddress: string = body.owner;
        if (!ownerAddress) {
          return NextResponse.json({ error: 'owner address is required' }, { status: 400 });
        }

        const source = await client.getAccount(funder.publicKey());
        const salt = crypto.randomBytes(32);
        const preimage = xdr.ContractIdPreimage.contractIdPreimageFromAddress(
          new xdr.ContractIdPreimageFromAddress({
            address: Address.fromString(ownerAddress).toScAddress(),
            salt,
          })
        );
        const executable = xdr.ContractExecutable.contractExecutableWasm(
          Buffer.from(getContractConfig().customAccountWasmHash, 'hex')
        );
        const createContractArgs = new xdr.CreateContractArgs({
          contractIdPreimage: preimage,
          executable,
        });
        const func = xdr.HostFunction.hostFunctionTypeCreateContract(createContractArgs);
        const deployOp = Operation.invokeHostFunction({ func, auth: [] });

        const tx = new TransactionBuilder(source, {
          fee: '100000',
          networkPassphrase: client.networkPassphrase,
        })
          .addOperation(deployOp)
          .setTimeout(30)
          .build();

        const networkId = xdr.Hash.fromXDR(hash(Buffer.from(client.networkPassphrase)));
        const preimageContractId = new xdr.HashIdPreimageContractId({
          networkId,
          contractIdPreimage: preimage,
        });
        const hashIdPreimage = xdr.HashIdPreimage.envelopeTypeContractId(preimageContractId);
        const contractIdBytes = hash(hashIdPreimage.toXDR());
        const smartWalletAddress = StrKey.encodeContract(contractIdBytes);

        const deployResult = await client.submitTransaction(tx, funder);
        if (deployResult.status !== 'SUCCESS') {
          return NextResponse.json({ error: `Deploy failed: ${deployResult.error || deployResult.status}` }, { status: 500 });
        }

        let initialized = false;
        for (let attempt = 1; attempt <= 4; attempt++) {
          try {
            const initSource = await client.getAccount(funder.publicKey());
            const initOp = Operation.invokeContractFunction({
              contract: smartWalletAddress,
              function: 'init',
              args: [
                Address.fromString(ownerAddress).toScVal(),
                Address.fromString(client.contracts.delegationManager).toScVal(),
              ],
            });
            const initTx = new TransactionBuilder(initSource, {
              fee: '100000',
              networkPassphrase: client.networkPassphrase,
            })
              .addOperation(initOp)
              .setTimeout(30)
              .build();
            const initResult = await client.submitTransaction(initTx, funder);
            if (initResult.status === 'SUCCESS') {
              initialized = true;
              break;
            }
          } catch {
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        }

        if (!initialized) {
          return NextResponse.json({ error: 'Failed to initialize wallet after deployment' }, { status: 500 });
        }

        return NextResponse.json({ success: true, smartWalletAddress, owner: ownerAddress });
      }

      case 'CREATE_DELEGATION': {
        const { delegator, delegate, caveats } = body;
        if (!delegator || !delegate) {
          return NextResponse.json({ error: 'delegator and delegate addresses are required' }, { status: 400 });
        }

        const delegation = await client.delegation.create({
          delegate,
          delegator,
          caveats: caveats || [],
          signer: funder,
        });

        const hashStr = client.delegation.getHash(delegation);
        return NextResponse.json({ success: true, hash: hashStr, delegation });
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

      case 'LIST': {
        const delegatorAddress: string | undefined = body.delegator;
        const hashes = await client.delegation.list(delegatorAddress);
        return NextResponse.json({ success: true, hashes });
      }

      case 'BALANCE': {
        const { address, token } = body;
        if (!address) {
          return NextResponse.json({ error: 'address is required' }, { status: 400 });
        }
        const balance = await client.wallet.balance(address, token || getContractConfig().customAccount);
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
