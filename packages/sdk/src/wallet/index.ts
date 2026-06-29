import { Address, Keypair, Operation, rpc, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { KairosClient } from '../client';
import { Wallet } from '../types';

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
    
    // Deploy contract operation
    const deployOp = Operation.createCustomContract({
      wasmHash: Buffer.from(wasmHash, 'hex'),
      address: Address.fromString(owner.publicKey()),
    });

    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100000',
      networkPassphrase: this.client.networkPassphrase,
    })
      .addOperation(deployOp)
      .setTimeout(30)
      .build();

    // Sign and submit to deploy
    const result = await this.client.submitTransaction(tx, owner);
    if (result.status !== 'SUCCESS') {
      throw new Error(`Failed to deploy CustomAccount contract: ${result.error}`);
    }

    // Extract contract ID from result XDR or event
    // For Soroban, the contract ID can be computed or extracted.
    // In stellar-sdk, we can get the contract ID from the transaction result.
    const contractId = this.client.extractContractId(result.resultXdr!);
    if (!contractId) {
      throw new Error('Could not extract deployed contract ID from transaction result');
    }

    // 2. Initialize the contract
    await this.initializeWallet(contractId, owner);

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
      throw new Error(`Failed to initialize CustomAccount: ${result.error}`);
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
      throw new Error(`Could not retrieve owner for wallet: ${address}`);
    }
    // Convert ScVal Address to string
    return Address.fromScVal(result).toString();
  }

  /**
   * Returns the balance of a token (e.g. Stellar Asset Contract) for the wallet.
   */
  async balance(address: string, tokenAddress: string): Promise<bigint> {
    const sourceAccount = await this.client.getAccount(address);
    
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

    const simRes = (await this.client.simulateTx(tx)) as any;
    if (simRes.results?.[0]?.xdr) {
      const val = xdr.ScVal.fromXDR(Buffer.from(simRes.results[0].xdr, 'base64'));
      return val.i128().lo().toBigInt(); // or parse i128 correctly
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
  ): Promise<any> {
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
