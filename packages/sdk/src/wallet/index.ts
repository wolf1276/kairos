import * as crypto from 'crypto';
import { Address, Keypair, Operation, rpc, TransactionBuilder, xdr, StrKey, hash } from '@stellar/stellar-sdk';
import { KairosClient } from '../client';
import { Wallet, TransactionResult } from '../types';
import { scValToBigInt } from '../utils';
import { ExecutionFailedError, RpcError } from '../errors';

export class WalletModule {
  constructor(private client: KairosClient) {}

  /**
   * Deploys a new CustomAccount (smart wallet) instance and initializes it.
   * @param owner The Keypair of the owner standard account.
   * @param wasmHash The hex string of the uploaded CustomAccount WASM hash.
   * @returns The deployed Wallet details.
   */
  async create(owner: Keypair, wasmHash: string): Promise<Wallet> {
    // 1. Build contract deployment transaction
    const sourceAccount = await this.client.getAccount(owner.publicKey());
    
    // Deploy contract operation (using CreateContract V1 to match network support)
    const salt = crypto.randomBytes(32);
    const preimage = xdr.ContractIdPreimage.contractIdPreimageFromAddress(
      new xdr.ContractIdPreimageFromAddress({
        address: Address.fromString(owner.publicKey()).toScAddress(),
        salt,
      })
    );
    const executable = xdr.ContractExecutable.contractExecutableWasm(
      Buffer.from(wasmHash, 'hex')
    );
    const createContractArgs = new xdr.CreateContractArgs({
      contractIdPreimage: preimage,
      executable,
    });
    const func = xdr.HostFunction.hostFunctionTypeCreateContract(createContractArgs);
    const deployOp = Operation.invokeHostFunction({
      func,
      auth: [],
    });

    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100000',
      networkPassphrase: this.client.networkPassphrase,
    })
      .addOperation(deployOp)
      .setTimeout(30)
      .build();

    // Compute contract ID locally and deterministically
    const networkId = xdr.Hash.fromXDR(hash(Buffer.from(this.client.networkPassphrase)));
    const preimageContractId = new xdr.HashIdPreimageContractId({
      networkId,
      contractIdPreimage: preimage,
    });
    const hashIdPreimage = xdr.HashIdPreimage.envelopeTypeContractId(preimageContractId);
    const contractIdBytes = hash(hashIdPreimage.toXDR());
    const contractId = StrKey.encodeContract(contractIdBytes);

    // Sign and submit to deploy
    const result = await this.client.submitTransaction(tx, owner);
    if (result.status !== 'SUCCESS') {
      const errMsg = typeof result.error === 'object' ? JSON.stringify(result.error) : (result.error || `status=${result.status} hash=${result.hash}`);
      throw new ExecutionFailedError(`Failed to deploy CustomAccount contract: ${errMsg}`);
    }

    let initialized = false;
    let lastError: string | undefined;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        await this.initializeWallet(contractId, owner);
        initialized = true;
        break;
      } catch (e) {
        lastError = e instanceof Error ? e.message : 'Unknown error';
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    if (!initialized) {
      throw new ExecutionFailedError(`Failed to initialize CustomAccount: ${lastError || 'Unknown error'}`);
    }

    return {
      address: contractId,
      owner: owner.publicKey(),
      delegationManager: this.client.contracts.delegationManager,
    };
  }

  /**
   * Initializes the wallet with owner and delegation manager.
   */
  private async initializeWallet(contractId: string, owner: Keypair): Promise<void> {
    const sourceAccount = await this.client.getAccount(owner.publicKey());
    
    const initOp = Operation.invokeContractFunction({
      contract: contractId,
      function: 'init',
      args: [
        Address.fromString(owner.publicKey()).toScVal(),
        Address.fromString(this.client.contracts.delegationManager).toScVal(),
      ],
    });

    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100000',
      networkPassphrase: this.client.networkPassphrase,
    })
      .addOperation(initOp)
      .setTimeout(30)
      .build();

    const result = await this.client.submitTransaction(tx, owner);
    if (result.status !== 'SUCCESS') {
      throw new ExecutionFailedError(`Failed to initialize CustomAccount: ${result.error}`);
    }
  }

  /**
   * Loads an existing wallet's details by reading its owner from storage.
   */
  async load(address: string): Promise<Wallet> {
    const owner = await this.owner(address);
    return {
      address,
      owner,
      delegationManager: this.client.contracts.delegationManager,
    };
  }

  /**
   * Gets the owner address of the Smart Custom Account.
   */
  async owner(address: string): Promise<string> {
    const result = await this.client.readInstanceStorage(address, 'Owner');
    if (!result) {
      throw new RpcError(`Could not retrieve owner for wallet: ${address}`);
    }
    return Address.fromScVal(result).toString();
  }

  /**
   * Returns the balance of a token (e.g. Stellar Asset Contract) for the wallet.
   */
  async balance(address: string, tokenAddress: string): Promise<bigint> {
    const sourceAccount = await this.client.getAccount('GBKKNVTF24OKM2V7YRRQHLQIH6PTWDYRFMZPD6AUKB4RXAPSCRKB3XMO');
    
    const balanceOp = Operation.invokeContractFunction({
      contract: tokenAddress,
      function: 'balance',
      args: [Address.fromString(address).toScVal()],
    });

    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100000',
      networkPassphrase: this.client.networkPassphrase,
    })
      .addOperation(balanceOp)
      .setTimeout(30)
      .build();

    const simRes = await this.client.simulateTx(tx);
    if (rpc.Api.isSimulationSuccess(simRes) && simRes.result) {
      return scValToBigInt(simRes.result.retval);
    }
    return 0n;
  }

  /**
   * Directly executes a target contract function from the wallet (owner invocation).
   */
  async execute(
    walletAddress: string,
    owner: Keypair,
    target: string,
    functionName: string,
    args: xdr.ScVal[]
  ): Promise<TransactionResult> {
    const sourceAccount = await this.client.getAccount(owner.publicKey());
    
    const execOp = Operation.invokeContractFunction({
      contract: walletAddress,
      function: 'execute',
      args: [
        Address.fromString(target).toScVal(),
        xdr.ScVal.scvSymbol(functionName),
        xdr.ScVal.scvVec(args),
      ],
    });

    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100000',
      networkPassphrase: this.client.networkPassphrase,
    })
      .addOperation(execOp)
      .setTimeout(30)
      .build();

    return this.client.submitTransaction(tx, owner);
  }
}
